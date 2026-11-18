/** Every place of the state that holds ids moves to the dormant bucket of a missing pack and comes back; the table of places is complete. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, createState, deserialize, dispatch, serialize } from '../src/index.ts';
import { PLACES, STATE_IDS, branchOf } from '../src/dormant-places.ts';
import { restoreDormant, stashMissing } from '../src/pack-data.ts';
import type { ContentDb } from '@shinobi/content';
import type { DormantPack } from '../src/state.ts';
import {
  HOUR,
  modContent,
  modGenin,
  modRules,
  plainContent,
  plainRules,
  setSkill,
} from './packs-helpers.ts';

type Raw = Record<string, unknown>;

describe('the table of places', () => {
  const keys = Object.keys(createState(1, content));

  it('names every branch of the state', () => {
    expect(keys.sort()).toEqual(Object.keys(STATE_IDS).sort());
  });

  it('agrees with the places: a branch of rule place is a place, a branch of rule places has some, no other has any', () => {
    const branches = new Set(PLACES.map((p) => branchOf(p.path)));
    for (const [branch, rule] of Object.entries(STATE_IDS)) {
      if (rule === 'place')
        expect(
          PLACES.some((p) => p.path === branch),
          branch,
        ).toBe(true);
      else if (rule === 'places') expect(branches.has(branch), branch).toBe(true);
      else expect(branches.has(branch), branch).toBe(false);
    }
    for (const branch of branches) expect(keys, branch).toContain(branch);
  });

  it('has a place for every id-keyed branch the state holds today (a new one fails the first test)', () => {
    const state = createState(1, content);
    // Every record branch of the state with entries keyed by ids is a place or is derived.
    for (const [branch, value] of Object.entries(state)) {
      if (STATE_IDS[branch as keyof typeof STATE_IDS] !== 'none') continue;
      expect([
        'v',
        'packs',
        'rankOrder',
        'dormant',
        'now',
        'rng',
        'stats',
        'wounds',
        'fatigue',
        'events',
      ]).toContain(branch);
      void value;
    }
  });
});

/** A fake content that has the given packs: all the dormant code reads of it. */
const withPacks = (ids: string[]): ContentDb =>
  ({
    ...plainContent,
    packs: ids.map((id) => ({ id, version: '1', dependsOn: [], loadAfter: [] })),
  }) as ContentDb;

describe('one round trip per place', () => {
  const ghost = (slug: string) => `ghost:${slug}`;
  const base = (): Raw => ({
    skills: { tai: { xp: 5 }, [ghost('s')]: { xp: 9 } },
    pools: { [ghost('s')]: { xp: 1 } },
    mastery: { [ghost('t')]: { xp: 2 }, 'core:clone': { xp: 3 } },
    bank: { [ghost('item')]: 4, 'core:bun': 2 },
    currencies: { ryo: 7, [ghost('coin')]: 3 },
    known: { [ghost('t')]: true },
    flags: { [`poi.${ghost('p')}`]: true, firstFight: true },
    counters: { [`kills.${ghost('e')}`]: 6 },
    quests: { [ghost('q')]: { step: 1, base: 0, done: false } },
    gear: { [ghost('g')]: 2 },
    bushes: { [ghost('h')]: { stock: 1, size: 2, carry: 0 } },
    meditation: { [ghost('m')]: { insight: 1, enlight: 0, bought: {} } },
    buffs: { [ghost('b')]: { skill: 'tai', charges: 2 } },
    bingo: { [ghost('e')]: { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 0, bounty: 0 } },
    report: { [ghost('e')]: { fights: 1 } },
    shown: { [ghost('e')]: true },
    course: { '1': 'core:obstacle', '2': ghost('o') },
    world: {
      location: 'core:cell',
      explores: { [ghost('c')]: 3, 'core:cell': 1 },
      pois: { [ghost('p')]: true },
      claimed: { [ghost('p')]: true },
      stock: { [ghost('p')]: { left: 1, at: 5 } },
    },
    village: {
      levels: { [ghost('hut')]: 2, 'core:academy': 1 },
      res: { [ghost('wood')]: 5, 'core:plots': 1 },
      shinobi: { [ghost('chakra')]: 2 },
      raids: {
        [ghost('raid')]: {
          phase: 'over',
          ticks: 0,
          repelled: 1,
          byVillage: 0,
          breached: 0,
          damaged: [],
          ryo: 0,
          rep: 0,
        },
      },
      damage: { [ghost('hut')]: 3 },
    },
    missions: { pending: { [ghost('wood')]: 3 } },
    loadouts: {
      active: ['core:a', ghost('x'), 'core:b', ghost('y')],
      signature: ghost('x'),
      cloneRole: ghost('role'),
      saved: { main: { techniques: ['core:a', ghost('x')], signature: null } },
    },
    pouch: {
      slots: [
        { id: 'core:bun', n: 2 },
        { id: ghost('pill'), n: 4 },
        { id: '', n: 0 },
      ],
      medic: null,
    },
    goal: { kind: 'item', id: ghost('item') },
  });

  it('empties every place of the pack and keeps the rest', () => {
    const dormant: Record<string, DormantPack> = {};
    const out = stashMissing(
      base(),
      withPacks(['core']),
      dormant,
      new Map([['ghost', '1']]),
    ) as Raw;
    expect(JSON.stringify(out)).not.toContain('ghost');
    expect(Object.keys(dormant)).toEqual(['ghost']);
    // Every place of the table kept something in the bucket.
    for (const place of PLACES) {
      expect(Object.keys(dormant.ghost?.data[place.path] ?? {}).length, place.path).toBeGreaterThan(
        0,
      );
    }
    expect((out.skills as Raw).tai).toEqual({ xp: 5 });
    expect(out.bank).toEqual({ 'core:bun': 2 });
    expect((out.loadouts as Raw).active).toEqual(['core:a', 'core:b']);
    expect((out.pouch as { slots: unknown[] }).slots[1]).toEqual({ id: '', n: 0 });
    expect(out.goal).toBeNull();
    expect((out.loadouts as Raw).signature).toBeNull();
    expect((out.loadouts as Raw).cloneRole).toBeNull();
  });

  it('gives every place back as it was', () => {
    const dormant: Record<string, DormantPack> = {};
    const away = stashMissing(base(), withPacks(['core']), dormant, new Map());
    const back = restoreDormant(away, withPacks(['core', 'ghost']), dormant);
    expect(back.raw).toEqual(base());
    expect(dormant).toEqual({});
  });

  it('puts the units of a pouch slot back into the bank when the slot has been taken', () => {
    const dormant: Record<string, DormantPack> = {};
    const away = stashMissing(base(), withPacks(['core']), dormant, new Map());
    const taken = JSON.parse(JSON.stringify(away)) as {
      pouch: { slots: { id: string; n: number }[] };
      bank: Record<string, number>;
    };
    taken.pouch.slots[1] = { id: 'core:bun', n: 1 };
    const back = restoreDormant(taken, withPacks(['core', 'ghost']), dormant).raw as typeof taken;
    expect(back.pouch.slots[1]).toEqual({ id: 'core:bun', n: 1 });
    expect(back.bank['ghost:pill']).toBe(4);
  });

  it('restores only ids of the namespace of the returning pack, and never over what the state has', () => {
    const dormant: Record<string, DormantPack> = {
      ghost: {
        version: '1',
        rank: 'chunin',
        natures: ['katon', 'ghost:n'],
        data: {
          skills: { tai: { xp: 999 }, 'ghost:s': { xp: 1 }, 'other:s': { xp: 5 } },
          bank: { 'core:bun': 999, 'ghost:item': 1 },
          course: { '1': 'core:obstacle', '3': 'ghost:o' },
          goal: { '0': { kind: 'item', id: 'core:bun' } },
          'loadouts.active': { '0': 'core:a', '1': 'ghost:x' },
          pouch: { '0': { id: 'core:bun', n: 50 } },
        },
      },
    };
    const raw: Raw = {
      skills: { tai: { xp: 1 } },
      bank: { 'core:bun': 1 },
      course: {},
      goal: null,
      loadouts: { active: [] },
      pouch: { slots: [{ id: '', n: 0 }] },
    };
    const back = restoreDormant(raw, withPacks(['core', 'ghost']), dormant).raw as Raw;
    expect(back.skills).toEqual({ tai: { xp: 1 }, 'ghost:s': { xp: 1 } });
    expect(back.bank).toEqual({ 'core:bun': 1, 'ghost:item': 1 });
    expect(back.course).toEqual({ '3': 'ghost:o' });
    expect(back.goal).toBeNull();
    expect((back.loadouts as Raw).active).toEqual(['ghost:x']);
    expect((back.pouch as { slots: unknown[] }).slots[0]).toEqual({ id: '', n: 0 });
  });
});

describe('the pouch of a player who loses a pack', () => {
  it('keeps the units packed from the bank: 10 elixirs, 4 in the pouch, still 10 after the round trip', () => {
    const state = modGenin();
    state.bank['testmod:elixir'] = 10;
    expect(
      dispatch(state, { type: 'pouch.set', slot: 0, item: 'testmod:elixir' }, modContent, modRules)
        .ok,
    ).toBe(true);
    const packed = state.pouch.slots[0]?.n ?? 0;
    expect(packed).toBeGreaterThan(0);
    expect((state.bank['testmod:elixir'] ?? 0) + packed).toBe(10);
    const core = deserialize(serialize(state), plainContent, plainRules);
    expect(core.pouch.slots.every((s) => !s.id.startsWith('testmod:'))).toBe(true);
    advance(core, HOUR, plainContent, plainRules);
    const back = deserialize(serialize(core), modContent, modRules);
    const units =
      (back.bank['testmod:elixir'] ?? 0) +
      back.pouch.slots.filter((s) => s.id === 'testmod:elixir').reduce((n, s) => n + s.n, 0);
    expect(units).toBe(10);
    expect(back.pouch.slots[0]?.id).toBe('testmod:elixir');
    void setSkill;
  });
});
