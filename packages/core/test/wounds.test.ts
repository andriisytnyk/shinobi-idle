/** A7: Wounds: how they are gained, what they cost, how they heal. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addWounds,
  advance,
  advanceOffline,
  createFight,
  createState,
  deserialize,
  dispatch,
  serialize,
  shortenWounds,
  woundFactor,
  woundFloorMs,
  woundIntervalMs,
} from '../src/index.ts';
import { K, enemyAt, playerFor, scripted, rules } from './fight-helpers.ts';
import { genin, setLevel } from './helpers.ts';
import { fighter, ids, run, startFight, stock } from './prep-state.ts';

const MINUTE = 60_000;

describe('gaining stacks', () => {
  it('caps the stacks at the balance maximum', () => {
    const state = genin();
    addWounds(state, 2, content);
    expect(state.wounds.stacks).toBe(2);
    addWounds(state, 10, content);
    expect(state.wounds.stacks).toBe(K.wound.max);
    expect(state.wounds.left).toBe(woundIntervalMs(content));
  });

  it('costs one stack for a defeat, and ends the action', () => {
    const state = fighter(1, 3);
    startFight(state, 'core:zone_tiger');
    for (let i = 0; i < 600 && state.slots[0]?.action; i++) advance(state, 1000, content);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(state.wounds.stacks).toBe(1);
    expect(state.combat).toBeNull();
  });

  it('costs one stack when health fell under the threshold in a fight that was won, and none otherwise', () => {
    const wounded = (low: boolean): number => {
      const state = fighter(2, 40);
      startFight(state, 'core:zone_dummy');
      const fight = state.combat?.fight;
      if (!fight) throw new Error('no fight');
      if (low) fight.player.hp = fight.player.maxHp * K.woundHp * 0.5;
      // The enemy falls at once; the dip below the threshold is noted when health is lost.
      for (const e of fight.enemies) e.hp = 1;
      if (low) {
        fight.player.data.low = 1;
      }
      advance(state, 20_000, content);
      expect(state.counters['kills.core:dummy'] ?? 0).toBeGreaterThan(0);
      return state.wounds.stacks;
    };
    expect(wounded(false)).toBe(0);
    expect(wounded(true)).toBe(1);
  });

  it('notes the dip in the fight itself when a hit takes health below the threshold', () => {
    const fight = createFight(scripted(['core:leaf_whirlwind']), enemyAt(10), 1, content, rules);
    expect(fight.player.data.low).toBeUndefined();
    fight.player.hp = fight.player.maxHp * (K.woundHp + 0.01);
    for (let seed = 1; seed < 50 && fight.player.data.low !== 1; seed++) {
      const f = createFight(scripted(['core:leaf_whirlwind']), enemyAt(30), seed, content, rules);
      f.player.hp = f.player.maxHp * (K.woundHp + 0.02);
      for (let i = 0; i < 40 && f.result === 'ongoing'; i++) {
        advanceFight(f);
      }
      if (f.player.data.low === 1) fight.player.data.low = 1;
    }
    expect(fight.player.data.low).toBe(1);
  });

  it('costs the Wounds of the stances used, win or lose', () => {
    const state = fighter(3, 40);
    startFight(state, 'core:zone_dummy');
    const fight = state.combat?.fight;
    if (!fight) throw new Error('no fight');
    fight.tally.wounds = 2;
    for (const e of fight.enemies) e.hp = 1;
    advance(state, 20_000, content);
    expect(state.wounds.stacks).toBe(2);
  });
});

import { fightAdvance, workOf } from '../src/index.ts';
function advanceFight(f: ReturnType<typeof createFight>): void {
  fightAdvance(f, workOf(2000), content, rules);
}

describe('what a stack costs', () => {
  it('cuts the combat stats by the balance share per stack', () => {
    const level = playerFor(30, 'katon');
    const base = createFight(level, enemyAt(30), 1, content, rules);
    for (const stacks of [1, 2, K.wound.max]) {
      const hurt = createFight({ ...level, wounds: stacks }, enemyAt(30), 1, content, rules);
      const f = 1 - K.wound.stat * stacks;
      expect(woundFactor(stacks, content)).toBeCloseTo(f, 9);
      expect(hurt.player.maxHp).toBeCloseTo(base.player.maxHp * f, 6);
      expect(hurt.player.damage).toBeCloseTo(base.player.damage * f, 6);
      expect(hurt.player.accuracy).toBeCloseTo(base.player.accuracy * f, 6);
      expect(hurt.player.evasion).toBeCloseTo(base.player.evasion * f, 6);
      const a = base.kit.techniques[0];
      const b = hurt.kit.techniques[0];
      expect(b?.damage).toBeCloseTo((a?.damage ?? 0) * f, 6);
      expect(b?.accuracy).toBeCloseTo((a?.accuracy ?? 0) * f, 6);
    }
  });

  it('reaches the fight through the snapshot of the state', () => {
    const state = fighter(4, 30);
    addWounds(state, 2, content);
    startFight(state, 'core:zone_bandit');
    const clean = fighter(4, 30);
    startFight(clean, 'core:zone_bandit');
    const ratio = (state.combat?.fight.player.maxHp ?? 0) / (clean.combat?.fight.player.maxHp ?? 1);
    expect(ratio).toBeCloseTo(1 - 2 * K.wound.stat, 9);
  });
});

describe('healing', () => {
  it('heals one stack per interval, and the next stack starts its own interval', () => {
    const state = genin();
    addWounds(state, 3, content);
    const interval = woundIntervalMs(content);
    expect(interval).toBe(K.wound.healMin * MINUTE);
    advance(state, interval - 1, content);
    expect(state.wounds.stacks).toBe(3);
    advance(state, 1, content);
    expect(state.wounds).toEqual({ stacks: 2, left: interval });
    advance(state, 2 * interval, content);
    expect(state.wounds).toEqual({ stacks: 0, left: 0 });
  });

  it('proceeds during any activity: idle, a drill and a fight alike', () => {
    for (const activity of ['idle', 'drill', 'fight']) {
      const state = fighter(5, 30);
      if (activity === 'drill') {
        run(state, { type: 'action.start', slot: 0, kind: 'drill', id: 'core:lystok_na_lobi' });
      }
      if (activity === 'fight') startFight(state, 'core:zone_dummy');
      addWounds(state, 1, content);
      advance(state, woundIntervalMs(content), content);
      expect(state.wounds.stacks, activity).toBe(0);
    }
  });

  it('proceeds while the game is closed', () => {
    const state = genin();
    addWounds(state, 2, content);
    advanceOffline(state, 2 * woundIntervalMs(content), content);
    expect(state.wounds.stacks).toBe(0);
  });

  it('is saved and loaded', () => {
    const state = fighter(7, 10);
    addWounds(state, 2, content);
    advance(state, 3 * MINUTE, content);
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.wounds).toEqual(state.wounds);
    advance(state, 20 * MINUTE, content);
    advance(loaded, 20 * MINUTE, content);
    expect(serialize(loaded, 0)).toBe(serialize(state, 0));
  });

  it('is shortened by healing aids, but never below the floor', () => {
    const state = genin();
    addWounds(state, 1, content);
    const floor = woundFloorMs(content);
    expect(floor).toBe(K.wound.healFloorMin * MINUTE);
    expect(shortenWounds(state, 3, content)).toBe(true);
    expect(state.wounds.left).toBe(woundIntervalMs(content) - 3 * MINUTE);
    for (let i = 0; i < 20; i++) shortenWounds(state, 1, content);
    expect(state.wounds.left).toBe(floor);
    // A stack already under the floor is left alone, and no stack means nothing to shorten.
    state.wounds.left = floor - 1000;
    shortenWounds(state, 1, content);
    expect(state.wounds.left).toBe(floor - 1000);
    expect(shortenWounds(createState(1, content), 1, content)).toBe(false);
  });

  it('is shortened by an ointment from the bank, which needs a Wound to treat', () => {
    const state = genin();
    stock(state, { [ids.ointment]: 2, [ids.bloodPill]: 2 });
    expect(dispatch(state, { type: 'item.use', id: ids.ointment }, content)).toEqual({
      ok: false,
      reason: 'error.noWounds',
    });
    addWounds(state, 1, content);
    run(state, { type: 'item.use', id: ids.ointment });
    expect(state.wounds.left).toBe(woundIntervalMs(content) - MINUTE);
    expect(state.bank[ids.ointment]).toBe(1);
    run(state, { type: 'item.use', id: ids.bloodPill });
    expect(state.wounds.left).toBe(woundIntervalMs(content) - 2 * MINUTE);
  });

  it('is shortened by a blood-making pill used in a fight, once the fight is over', () => {
    const state = fighter(6, 40);
    addWounds(state, 1, content);
    stock(state, { [ids.bloodPill]: 2 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.bloodPill });
    startFight(state, 'core:zone_dummy');
    run(state, { type: 'pouch.use', slot: 0 });
    expect(state.combat?.fight.tally.woundMin).toBe(1);
    const before = state.wounds.left;
    for (const e of state.combat?.fight.enemies ?? []) e.hp = 1;
    advance(state, 10_000, content);
    expect(state.counters['kills.core:dummy']).toBeGreaterThan(0);
    expect(state.wounds.left).toBeLessThan(before - MINUTE + 1);
  });
});

void setLevel;
