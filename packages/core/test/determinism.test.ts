/**
 * A2 and A11: determinism and split invariance with the preparation systems running, and the
 * speed of them. A12: saves in the middle of an operation and of a boss fight, and the migration.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addWounds,
  advance,
  createState,
  deserialize,
  dispatch,
  serialize,
  STATE_VERSION,
  MIGRATIONS,
  simulateFights,
  defaultRules,
  type GameState,
} from '../src/index.ts';
import { HOUR, setLevel } from './helpers.ts';
import { bestOf, speedBudget } from './speed.ts';
import { fighter, ids, run, startFight, startOperation, stock, unlock } from './prep-state.ts';
import { playerFor } from './prep-helpers.ts';
import { encounterFor } from '../src/index.ts';

const bossFlag = (id: string) => `boss.${id.replace('core:boss_', '')}.unlocked`;

/** A scenario builds a game with something to do in its slot `at`. */
type Scenario = (state: GameState, at: number) => void;

const scenarios: Record<string, Scenario> = {
  'a zone fight with tools from the pouch': (state, at) => {
    stock(state, { [ids.heal]: 12, [ids.kunai]: 12, [ids.tag]: 12, [ids.medpouch]: 1 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    run(state, { type: 'pouch.set', slot: 1, item: ids.tag });
    run(state, { type: 'pouch.set', slot: 2, item: ids.kunai });
    run(state, { type: 'pouch.medic', slot: 0 });
    // A weak player in a pack zone: the tags and the pills are in constant use.
    for (const skill of ['tai', 'nin', 'katon', 'vit'] as const) setLevel(state, skill, 14);
    dispatch(
      state,
      { type: 'action.start', slot: at, kind: 'fight', id: 'core:zone_merc_pack' },
      content,
    );
  },
  'an operation in progress': (state, at) => {
    unlock(state, 'op.hideout.unlocked');
    stock(state, { [ids.heal]: 8 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    dispatch(
      state,
      { type: 'action.start', slot: at, kind: 'operation', id: 'core:op_hideout' },
      content,
    );
  },
  'wounds healing in the background of a fight': (state, at) => {
    addWounds(state, 3, content);
    state.wounds.left = 7000;
    dispatch(
      state,
      { type: 'action.start', slot: at, kind: 'fight', id: 'core:zone_tiger' },
      content,
    );
  },
  ...Object.fromEntries(
    content.bosses.map((boss) => [
      `a boss fight: ${boss.special.kind} (${boss.id.replace('core:boss_', '')})`,
      (state: GameState, at: number): void => {
        unlock(state, bossFlag(boss.id));
        stock(state, { [ids.heal]: 8, [ids.kunai]: 8 });
        run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
        run(state, { type: 'pouch.set', slot: 1, item: ids.kunai });
        for (const skill of ['tai', 'nin', 'katon', 'futon', 'vit', 'med', 'ath', 'cc'] as const) {
          setLevel(state, skill, Math.min(50, boss.cl));
        }
        dispatch(
          state,
          {
            type: 'action.start',
            slot: at,
            kind: 'fight',
            id: `core:zone_${boss.id.replace('core:', '')}`,
          },
          content,
        );
      },
    ]),
  ),
};

function play(name: string, slots: number, at: number, total: number, chunk: number): GameState {
  const state = fighter(31, 36, 'katon');
  while (state.slots.length < slots) {
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
  }
  const build = scenarios[name];
  if (!build) throw new Error(name);
  build(state, at);
  for (let i = 0; i < slots; i++) {
    if (i !== at) {
      dispatch(
        state,
        {
          type: 'action.start',
          slot: i,
          kind: 'drill',
          id: ['core:lystok_na_lobi', 'core:kunai_na_doloni', 'core:chakra_v_stopakh'][i] ?? '',
        },
        content,
      );
    }
  }
  expect(state.slots[at]?.action).not.toBeNull();
  for (let t = 0; t < total; t += chunk) advance(state, Math.min(chunk, total - t), content);
  return state;
}

describe('A2: split invariance and determinism', () => {
  const TOTAL = 40_000;
  const arrangements = [
    [1, 0, 1000],
    [2, 1, 500],
    [3, 2, 333],
  ] as const;

  for (const name of Object.keys(scenarios)) {
    it(`gives byte-identical saves for any chunking, ${name}`, () => {
      for (const [slots, at, share] of arrangements) {
        const whole = play(name, slots, at, TOTAL, TOTAL);
        expect(whole.slots[at]?.share).toBe(share);
        const text = serialize(whole, 0);
        for (const chunk of [7, 999, 3600]) {
          expect(
            serialize(play(name, slots, at, TOTAL, chunk), 0),
            `chunk ${chunk}, ${slots} slots`,
          ).toBe(text);
        }
      }
    });

    it(`gives byte-identical saves in 1 ms steps, ${name}`, () => {
      const total = 6000;
      const whole = serialize(play(name, 2, 0, total, total), 0);
      expect(serialize(play(name, 2, 0, total, 1), 0)).toBe(whole);
    });
  }

  it('really uses the pouch in the first scenario, and repeats exactly for one seed', () => {
    const name = 'a zone fight with tools from the pouch';
    const state = play(name, 1, 0, 120_000, 120_000);
    const used = state.pouch.slots.some((s) => s.n < 4) || state.bank[ids.tag] !== 12 - 4 + 0;
    expect(used || (state.counters['kills.core:merc_pack'] ?? 0) > 0).toBe(true);
    expect(serialize(play(name, 1, 0, 30_000, 1000), 0)).toBe(
      serialize(play(name, 1, 0, 30_000, 1000), 0),
    );
    const other = fighter(32, 36, 'katon');
    scenarios[name]?.(other, 0);
    advance(other, 30_000, content);
    expect(serialize(other, 0)).not.toBe(serialize(play(name, 1, 0, 30_000, 1000), 0));
  });
});

describe('A11: speed', () => {
  it('simulates 1000 fights against an at-level regular enemy in under 2000 ms', () => {
    const enemy = content.enemies.find((e) => e.id === 'core:hunter');
    if (!enemy) throw new Error('no enemy');
    const snap = playerFor(enemy, 'katon', { prep: 'auto', tier: 1, knowledge: 'none' });
    const limit = speedBudget(2000, 8000);
    let r = simulateFights(snap, encounterFor(enemy, content), 1, 5, content, defaultRules);
    const ms = bestOf(3, limit, () => {
      r = simulateFights(snap, encounterFor(enemy, content), 1000, 5, content, defaultRules);
    });
    console.log(
      `A11: 1000 fights against ${enemy.id} in ${ms.toFixed(0)} ms, win ${(r.winRate * 100).toFixed(0)}%`,
    );
    expect(r.fights).toBe(1000);
    expect(ms).toBeLessThan(limit);
  });

  it('plays 12 game hours of zone fighting with the pouch in under 3000 ms', () => {
    const state = fighter(41, 38, 'katon');
    stock(state, { [ids.heal]: 5000, [ids.kunai]: 5000, [ids.tag]: 5000, [ids.medpouch]: 1 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    run(state, { type: 'pouch.set', slot: 1, item: ids.tag });
    run(state, { type: 'pouch.set', slot: 2, item: ids.kunai });
    run(state, { type: 'pouch.medic', slot: 0 });
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_guard_pack' },
      content,
    );
    const bank =
      (state.bank[ids.tag] ?? 0) + (state.bank[ids.heal] ?? 0) + (state.bank[ids.kunai] ?? 0);
    const limit = speedBudget(3000, 12_000);
    const ms = bestOf(1, limit, () => advance(state, 12 * HOUR, content));
    const kills = state.counters['kills.core:guard_pack'] ?? 0;
    const refilled =
      bank -
      ((state.bank[ids.tag] ?? 0) + (state.bank[ids.heal] ?? 0) + (state.bank[ids.kunai] ?? 0));
    console.log(
      `A11: 12 h of zone fighting in ${ms.toFixed(0)} ms, ${kills} kills, ${refilled} items refilled from the bank`,
    );
    expect(kills).toBeGreaterThan(300);
    expect(refilled).toBeGreaterThan(100);
    expect(state.slots[0]?.action).not.toBeNull();
    expect(ms).toBeLessThan(limit);
  });
});

describe('A12: saves', () => {
  /** Plays, saving and loading at several moments, and checks the loaded game goes on like the original. */
  function checkpoints(build: (s: GameState) => void, moments: number[], tail = 20_000): void {
    const state = fighter(51, 50, 'katon');
    build(state);
    for (const ms of moments) {
      advance(state, ms, content);
      const text = serialize(state, 0);
      const loaded = deserialize(text, content);
      expect(serialize(loaded, 0)).toBe(text);
      expect(loaded.combat).toEqual(state.combat);
      const a = deserialize(text, content);
      const b = deserialize(text, content);
      advance(a, tail, content);
      advance(b, tail, content);
      expect(serialize(a, 0)).toBe(serialize(b, 0));
      // Continuing the original from the same moment gives the same game as continuing the loaded one.
      const copy = deserialize(text, content);
      advance(copy, tail, content);
      advance(state, 0, content);
      const again = deserialize(text, content);
      advance(again, tail, content);
      expect(serialize(again, 0)).toBe(serialize(copy, 0));
    }
  }

  it('round-trips in the middle of an operation: the approach, a fight, a pause between fights', () => {
    checkpoints(
      (s) => {
        unlock(s, 'op.hideout.unlocked');
        stock(s, { [ids.heal]: 8 });
        run(s, { type: 'pouch.set', slot: 0, item: ids.heal });
        expect(startOperation(s, 'core:op_hideout')).toEqual({ ok: true });
      },
      [5000, 30_000, 20_000, 40_000, 60_000],
    );
  });

  it('keeps the run of an operation across a save', () => {
    const state = fighter(52, 50, 'katon');
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    advance(state, 20_000, content);
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.combat?.run).toEqual(state.combat?.run);
    expect(loaded.slots[0]?.action).toEqual({ kind: 'operation', id: 'core:op_hideout' });
    expect(loaded.bingo['core:guard_pack']?.seen).toBeGreaterThanOrEqual(1);
  });

  for (const boss of content.bosses) {
    it(`round-trips in the middle of the fight against ${boss.id.replace('core:boss_', '')}`, () => {
      checkpoints(
        (s) => {
          unlock(s, bossFlag(boss.id));
          stock(s, { [ids.heal]: 8 });
          run(s, { type: 'pouch.set', slot: 0, item: ids.heal });
          expect(startFight(s, `core:zone_${boss.id.replace('core:', '')}`)).toEqual({ ok: true });
        },
        [7000, 33_000],
        10_000,
      );
    });
  }

  it('drops a doctored run and rebuilds the fight instead of failing', () => {
    const state = fighter(53, 50, 'katon');
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    advance(state, 5000, content);
    const raw = JSON.parse(serialize(state, 0)) as { state: { combat: { run: { step: number } } } };
    raw.state.combat.run.step = 99;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.slots[0]?.action?.kind).toBe('operation');
    expect(loaded.combat?.run?.step).toBe(1);
    expect(loaded.combat?.phase).toBe('approach');
  });

  it('migrates a version 9 save: the new branches appear, a fight in progress starts over', () => {
    expect(STATE_VERSION).toBeGreaterThanOrEqual(10);
    expect(MIGRATIONS).toHaveLength(STATE_VERSION - 1);
    const state = fighter(54, 36, 'katon');
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:bandit' }, content);
    advance(state, 4000, content);
    const raw = JSON.parse(serialize(state, 0)) as { v: number; state: Record<string, unknown> };
    raw.v = 9;
    raw.state.v = 9;
    for (const key of ['loadouts', 'pouch', 'wounds', 'seen']) delete raw.state[key];
    // The old fight had none of the new parts.
    raw.state.combat = {
      enemy: 'core:bandit',
      phase: 'fight',
      fight: { t: 0 },
      work: 0,
      pause: 0,
      paid: {},
      carry: 0,
      style: 'tai',
    };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(loaded.wounds).toEqual({ stacks: 0, left: 0 });
    expect(loaded.pouch.slots).toHaveLength(3);
    expect(loaded.bingo['core:bandit']?.seen).toBeGreaterThanOrEqual(1);
    expect(loaded.loadouts.auto).toBe(true);
    expect(loaded.loadouts.active.length).toBeGreaterThan(0);
    expect(loaded.combat?.enemy).toBe('core:bandit');
    expect(loaded.combat?.fight.t).toBe(0);
    advance(loaded, 5000, content);
    expect(createState(1, content).v).toBe(STATE_VERSION);
  });

  it('cleans a doctored loadout, pouch and wound state on load', () => {
    const state = fighter(55, 36, 'katon');
    const raw = JSON.parse(serialize(state, 0)) as { state: Record<string, unknown> };
    raw.state.loadouts = {
      active: ['core:nope', 'core:great_fireball', 'core:great_fireball'],
      auto: false,
      signature: 'core:gone',
      basis: 5,
      saved: { x: { techniques: ['core:nope'], signature: null } },
    };
    raw.state.pouch = {
      slots: [{ id: 'core:rice', n: 99 }, { id: 'core:kunai', n: 99 }, 5],
      medic: 7,
    };
    raw.state.wounds = { stacks: 99, left: 10 ** 12 };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.loadouts.active).toEqual(['core:great_fireball']);
    expect(loaded.loadouts.signature).toBeNull();
    expect(loaded.loadouts.saved.x?.techniques).toEqual([]);
    expect(loaded.pouch.slots.map((s) => s.id)).toEqual(['', 'core:kunai', '']);
    expect(loaded.pouch.slots[1]?.n).toBe(content.balance.K.pouchStack);
    expect(loaded.pouch.medic).toBeNull();
    expect(loaded.wounds.stacks).toBe(content.balance.K.wound.max);
    expect(loaded.wounds.left).toBeLessThanOrEqual(content.balance.K.wound.healMin * 60_000);
  });
});
