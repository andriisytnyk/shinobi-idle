/**
 * Typed pouch slots (docs: правки зрізу, розділ 3, рядок 10): every slot has a kind that takes only the items of its uses,
 * carries the kind's per-fight amount into a fight, and is filled up from the Bank (a clone's bag) before every fight,
 * never inside one. A pack can add a kind.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  asPerformer,
  deserialize,
  dispatch,
  ensurePouch,
  growSlots,
  perFight,
  pouchLayout,
  refillPouch,
  serialize,
  STATE_VERSION,
} from '../src/index.ts';
import { player } from './missions-helpers.ts';
import { modContent, modGenin, modRules } from './packs-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, run, startFight, startOperation, stock, unlock } from './prep-state.ts';
/** A genin at level 50 who knows the clone technique, with the second slot open. */ function cloner(): ReturnType<
  typeof player
> {
  const state = player({
    seed: 1,
    natures: ['katon'],
    levels: { nin: 50, med: 40, cc: 40, katon: 20 },
    known: ['core:shadow_clone'],
  });
  growSlots(state, content);
  return state;
}

const FOOD = perFight(content, 'core:pk_food');
const COMBAT = perFight(content, 'core:pk_combat');
const CURE = perFight(content, 'core:pk_cure');

describe('the kinds of slot', () => {
  it('have the per-fight amounts of the data', () => {
    expect([FOOD, COMBAT, CURE]).toEqual([4, 4, 3]);
  });

  it('take only the items whose use the kind has', () => {
    const state = fighter(1, 36);
    stock(state, { [ids.heal]: 5, [ids.kunai]: 5, [ids.antidote]: 5 });
    const set = (slot: number, item: string) =>
      dispatch(state, { type: 'pouch.set', slot, item }, content);
    // Food and medicine in the food slot, tools in the combat slot, cures in the cure slot.
    expect(set(0, ids.heal).ok).toBe(true);
    expect(set(1, ids.kunai).ok).toBe(true);
    expect(set(3, ids.antidote).ok).toBe(true);
    // Each item in a slot of another kind is refused, and the slot is left as it was.
    for (const [slot, item] of [
      [0, ids.kunai],
      [0, ids.antidote],
      [1, ids.heal],
      [1, ids.antidote],
      [3, ids.heal],
      [3, ids.kunai],
    ] as const) {
      expect(set(slot, item), `${item} in slot ${slot}`).toEqual({
        ok: false,
        reason: 'error.wrongSlotKind',
      });
    }
    expect(state.pouch.slots.map((s) => s.id)).toEqual([ids.heal, ids.kunai, '', ids.antidote]);
  });
});

describe('the amount per fight', () => {
  it('is all a slot takes from a bank that has plenty', () => {
    const state = fighter(1, 36);
    stock(state, { [ids.heal]: 240, [ids.kunai]: 50, [ids.antidote]: 9 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    run(state, { type: 'pouch.set', slot: 1, item: ids.kunai });
    run(state, { type: 'pouch.set', slot: 3, item: ids.antidote });
    expect(state.pouch.slots.map((s) => s.n)).toEqual([FOOD, COMBAT, 0, CURE]);
    expect(state.bank[ids.heal]).toBe(240 - FOOD);
    expect(state.bank[ids.kunai]).toBe(50 - COMBAT);
    expect(state.bank[ids.antidote]).toBe(9 - CURE);
  });

  it('is what the bank has when the bank has less', () => {
    const state = fighter(1, 36);
    stock(state, { [ids.heal]: 3 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    expect(state.pouch.slots[0]?.n).toBe(3);
    expect(state.bank[ids.heal]).toBeUndefined();
    // The shortfall stays: a fight begins with what there is, and the bank is not overdrawn.
    expect(startFight(state, 'core:zone_dummy')).toEqual({ ok: true });
    expect(state.combat?.fight.pouch[0]).toEqual({ id: ids.heal, n: 3 });
    expect(state.bank[ids.heal]).toBeUndefined();
    // Once the bank gets more, the next fight takes it, up to the amount.
    state.pouch.slots[0] = { kind: 'core:pk_food', id: ids.heal, n: 0 };
    stock(state, { [ids.heal]: 4 });
    refillPouch(state, content);
    expect(state.pouch.slots[0]?.n).toBe(4);
  });
});

describe('the refill', () => {
  it('happens before every fight of a zone, not only after a defeat', () => {
    const state = fighter(2, 40);
    stock(state, { [ids.heal]: 100 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    expect(startFight(state, 'core:zone_dummy')).toEqual({ ok: true });
    for (let fights = 1; fights <= 3; fights++) {
      // Spend the whole slot inside this fight: nothing refills it until the fight is over.
      const fight = state.combat?.fight;
      if (!fight) throw new Error('no fight');
      fight.pouch[0] = { id: ids.heal, n: 0 };
      const bank = state.bank[ids.heal] ?? 0;
      const kills = state.counters['kills.core:dummy'] ?? 0;
      const at = fight.t;
      for (let i = 0; i < 50 && state.combat?.fight === fight && fight.t === at; i++)
        advance(state, 100, content);
      if (state.combat?.fight === fight && fight.result === 'ongoing') {
        expect(fight.t).toBeGreaterThan(at);
        expect(fight.pouch[0]?.n).toBe(0);
        expect(state.bank[ids.heal] ?? 0).toBe(bank);
      }
      // The fight is won; the next one begins with the slot filled up from the bank.
      for (
        let i = 0;
        i < 2000 &&
        ((state.counters['kills.core:dummy'] ?? 0) === kills || state.combat?.phase !== 'fight');
        i++
      ) {
        advance(state, 100, content);
      }
      expect(state.counters['kills.core:dummy'] ?? 0).toBe(kills + 1);
      expect(state.combat?.phase).toBe('fight');
      expect(state.combat?.fight).not.toBe(fight);
      expect(state.combat?.fight.pouch[0]?.n ?? 0).toBeGreaterThanOrEqual(FOOD - 1);
      expect(bank - (state.bank[ids.heal] ?? 0)).toBe(FOOD);
    }
  });

  it('is the same in one long advance (as offline) and in small steps, and the bank pays for it', () => {
    const play = (step: number) => {
      const state = fighter(3, 20);
      for (const skill of ['tai', 'nin', 'katon', 'vit'] as const) setLevel(state, skill, 8);
      stock(state, { [ids.heal]: 400 });
      run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
      run(state, { type: 'pouch.medic', slot: 0 });
      expect(startFight(state, 'core:zone_heavy')).toEqual({ ok: true });
      for (let t = 0; t < 20 * 60_000; t += step) advance(state, step, content);
      return state;
    };
    const whole = play(20 * 60_000);
    // A weak player in a pack zone eats a lot: more than one fill went through the slot.
    const eaten = 400 - (whole.bank[ids.heal] ?? 0) - (whole.pouch.slots[0]?.n ?? 0);
    expect(eaten).toBeGreaterThan(FOOD);
    expect(whole.pouch.slots[0]?.n ?? 0).toBeLessThanOrEqual(FOOD);
    expect(serialize(play(1000), 0)).toBe(serialize(whole, 0));
  });

  it('happens before every stage of an operation', () => {
    const state = fighter(3, 50);
    unlock(state, 'op.hideout.unlocked');
    stock(state, { [ids.heal]: 60 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    expect(startOperation(state, 'core:op_hideout')).toEqual({ ok: true });
    // The slot is spent as the first stage ends; the second stage begins with it filled up from the bank.
    const first = state.combat?.run?.step ?? -1;
    const fight = state.combat?.fight;
    if (!fight) throw new Error('no fight');
    fight.pouch[0] = { id: ids.heal, n: 1 };
    const bank = state.bank[ids.heal] ?? 0;
    for (let i = 0; i < 2000 && state.combat?.run?.step === first; i++)
      advance(state, 100, content);
    expect(state.combat?.run?.step).toBe(first + 1);
    for (let i = 0; i < 400 && state.combat?.phase !== 'fight'; i++) advance(state, 100, content);
    expect(state.combat?.phase).toBe('fight');
    expect(state.combat?.fight).not.toBe(fight);
    expect(bank - (state.bank[ids.heal] ?? 0)).toBe(FOOD - 1);
    expect(state.combat?.fight.pouch[0]?.n).toBe(FOOD);
  });
});

describe('the pouch of a clone', () => {
  it('takes its stock at creation and is filled up from its own bag, never from the Bank', () => {
    const state = cloner();
    ensurePouch(state, content);
    stock(state, { [ids.heal]: 100 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    expect(
      dispatch(state, { type: 'clone.create', items: { [ids.heal]: FOOD + 2 } }, content),
    ).toEqual({
      ok: true,
    });
    const body = state.clones[1];
    expect(body?.pouch.slots[0]).toEqual({ kind: 'core:pk_food', id: ids.heal, n: FOOD });
    expect(body?.bag[ids.heal]).toBe(2);
    const bank = { ...state.bank };
    // The slot is spent; the next fight fills it from what is left in the bag.
    if (body) body.pouch.slots[0] = { kind: 'core:pk_food', id: ids.heal, n: 0 };
    asPerformer(state, 1, () => refillPouch(state, content));
    expect(state.clones[1]?.pouch.slots[0]?.n).toBe(2);
    expect(state.clones[1]?.bag[ids.heal]).toBeUndefined();
    // With the bag empty there is nothing to take, and the Bank, however full, is not touched.
    if (state.clones[1])
      state.clones[1].pouch.slots[0] = { kind: 'core:pk_food', id: ids.heal, n: 0 };
    asPerformer(state, 1, () => refillPouch(state, content));
    expect(state.clones[1]?.pouch.slots[0]?.n).toBe(0);
    expect(state.bank).toEqual(bank);
  });
});

describe('saves', () => {
  /** A save of the version before the typed slots: slots with an item and a count, no kind. */
  function oldSave(
    slots: { id: string; n: number }[],
    medic: number | null,
  ): { text: string; bank: Record<string, number> } {
    const state = fighter(7, 36);
    stock(state, { [ids.heal]: 2, [ids.tag]: 1 });
    const raw = JSON.parse(serialize(state, 0)) as {
      v: number;
      state: Record<string, unknown>;
    };
    raw.v = 23;
    raw.state.v = 23;
    raw.state.pouch = { slots, medic };
    return { text: JSON.stringify(raw), bank: { ...state.bank } };
  }

  it('move the old slots to the kinds that take their items; what fits no kind goes back to the Bank', () => {
    const { text, bank } = oldSave(
      [
        { id: ids.heal, n: 4 },
        { id: ids.bigHeal, n: 3 },
        { id: ids.kunai, n: 4 },
        { id: ids.tag, n: 2 },
        { id: 'core:rice', n: 6 },
      ],
      0,
    );
    const loaded = deserialize(text, content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(loaded.pouch.slots.map((s) => [s.kind, s.id, s.n])).toEqual([
      ['core:pk_food', ids.heal, 4],
      ['core:pk_combat', ids.kunai, 4],
      ['core:pk_combat', ids.tag, 2],
      ['core:pk_cure', '', 0],
    ]);
    expect(loaded.pouch.medic).toBe(0);
    // The second food (the one food slot is taken) and the thing that is no pouch item are in the Bank again.
    expect(loaded.bank[ids.bigHeal]).toBe(3);
    expect(loaded.bank[ids.tag]).toBe(bank[ids.tag]);
    expect(loaded.bank['core:rice']).toBe((bank['core:rice'] ?? 0) + 6);
    expect(loaded.bank[ids.heal]).toBe(bank[ids.heal]);
  });

  it('keep an item over the per-fight amount in the Bank and carry the same counts into a fight in progress', () => {
    const state = fighter(8, 40);
    stock(state, { [ids.heal]: 30 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    startFight(state, 'core:zone_dummy');
    advance(state, 1000, content);
    const raw = JSON.parse(serialize(state, 0)) as {
      v: number;
      state: Record<string, unknown>;
    };
    // The old pouch: the food in the first slot, two slots of tools before it would have moved the slot.
    raw.v = 23;
    raw.state.v = 23;
    raw.state.pouch = {
      slots: [
        { id: ids.kunai, n: 2 },
        { id: ids.heal, n: 40 },
      ],
      medic: 1,
    };
    const combat = raw.state.combat as { fight: { pouch: unknown[]; medic: number | null } };
    combat.fight.pouch = [
      { id: ids.kunai, n: 1 },
      { id: ids.heal, n: 3 },
    ];
    combat.fight.medic = 1;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.pouch.slots.map((s) => [s.id, s.n])).toEqual([
      [ids.heal, FOOD],
      [ids.kunai, 2],
      ['', 0],
      ['', 0],
    ]);
    expect(loaded.pouch.medic).toBe(0);
    expect(loaded.bank[ids.heal]).toBe((state.bank[ids.heal] ?? 0) + 40 - FOOD);
    // The fight in progress counts the slots in the new order, so the game goes on.
    expect(loaded.combat?.fight.pouch.map((s) => [s.id, s.n])).toEqual([
      [ids.heal, 3],
      [ids.kunai, 1],
      ['', 0],
      ['', 0],
    ]);
    expect(loaded.combat?.fight.medic).toBe(0);
    advance(loaded, 5000, content);
  });

  it('round-trip the typed slots exactly', () => {
    const state = fighter(9, 36);
    stock(state, { [ids.heal]: 30, [ids.kunai]: 9 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    run(state, { type: 'pouch.set', slot: 1, item: ids.kunai });
    expect(serialize(deserialize(serialize(state, 0), content), 0)).toBe(serialize(state, 0));
  });
});

describe('a kind that a pack adds', () => {
  it('is one more slot, takes the items of its uses and carries its own amount', () => {
    const state = modGenin();
    expect(pouchLayout(state, modContent)).toEqual([
      'core:pk_food',
      'core:pk_combat',
      'core:pk_combat',
      'core:pk_cure',
      'testmod:pk_phials',
    ]);
    ensurePouch(state, modContent);
    state.bank['testmod:elixir'] = 10;
    state.bank[ids.kunai] = 5;
    const set = (slot: number, item: string) =>
      dispatch(state, { type: 'pouch.set', slot, item }, modContent, modRules);
    expect(set(4, ids.kunai)).toEqual({ ok: false, reason: 'error.wrongSlotKind' });
    expect(set(4, 'testmod:elixir').ok).toBe(true);
    expect(state.pouch.slots[4]).toEqual({ kind: 'testmod:pk_phials', id: 'testmod:elixir', n: 2 });
    expect(state.bank['testmod:elixir']).toBe(8);
    // The save keeps the kind with the slot.
    const back = deserialize(serialize(state, 0), modContent, modRules);
    expect(back.pouch.slots[4]).toEqual(state.pouch.slots[4]);
  });
});
