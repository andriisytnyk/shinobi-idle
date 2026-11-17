import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  deserialize,
  dispatch,
  poolCapacity,
  serialize,
  SHARE_FULL,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { HOUR, genin, setLevel } from './helpers.ts';

const K = content.balance.K;
const SCROLL = 'core:graduate_scroll';
const EXAM = 'core:genin_exam';

function meetChecklist(state: GameState): void {
  for (const skill of ['tai', 'nin', 'cc'] as const) setLevel(state, skill, 10);
}

describe('the sensei test cannot be farmed', () => {
  it('refuses a direct action.start as a genin', () => {
    const state = genin(1);
    meetChecklist(state);
    expect(
      dispatch(state, { type: 'action.start', slot: 0, kind: 'senseiTest', id: EXAM }, content),
    ).toEqual({ ok: false, reason: 'error.requirementsNotMet' });
    expect(state.slots[0]?.action).toBeNull();
  });

  it('refuses it without the checklist as a student', () => {
    const state = genin(1);
    state.player.rank = 'student';
    expect(
      dispatch(state, { type: 'action.start', slot: 0, kind: 'senseiTest', id: EXAM }, content).ok,
    ).toBe(false);
  });

  it('never pays a second scroll, goal or event even if the action completes again', () => {
    const state = genin(2);
    state.player.rank = 'student';
    meetChecklist(state);
    dispatch(state, { type: 'exam.genin.start' }, content);
    advance(state, 300_000, content);
    expect(state.bank[SCROLL]).toBe(1);
    state.goal = null;
    state.events = [];
    const kind = defaultRules.actionKinds['senseiTest'];
    kind?.complete(state, EXAM, content, defaultRules);
    expect(state.bank[SCROLL]).toBe(1);
    expect(state.goal).toBeNull();
    expect(state.events).toEqual([]);
  });
});

describe('mastery from combat and items feeds the pool', () => {
  it('pays about masteryPerHour in an hour of fighting, and the pool share of it', () => {
    const state = genin(3);
    setLevel(state, 'vit', 40);
    setLevel(state, 'cc', 10);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' }, content);
    advance(state, HOUR, content);
    // Every technique the player knows shares the XP; the total is what the balance fixes.
    const mastery = Object.values(state.mastery).reduce((sum, m) => sum + m.xp, 0);
    expect(mastery / K.masteryPerHour).toBeGreaterThan(0.95);
    expect(mastery / K.masteryPerHour).toBeLessThan(1.05);
    expect(state.pools.tai!.xp).toBeCloseTo(
      Math.min(poolCapacity('tai', content), mastery * K.poolShare),
      6,
    );
  });

  it('feeds the pool when the scroll is used', () => {
    const state = genin(4);
    state.bank[SCROLL] = 1;
    dispatch(state, { type: 'item.use', id: SCROLL, target: 'core:clone' }, content);
    expect(state.mastery['core:clone']?.xp).toBe(K.masteryPerHour);
    expect(state.pools.nin!.xp).toBeCloseTo(
      Math.min(poolCapacity('nin', content), K.masteryPerHour * K.poolShare),
      6,
    );
  });
});

describe('combat runs at the slot share', () => {
  /** A fight in slot `at` with drills in the other slots, so the fight gets 1/slots of the speed. */
  function shared(seed: number, slots: number, at: number): GameState {
    const state = genin(seed);
    setLevel(state, 'vit', 40);
    setLevel(state, 'cc', 10);
    while (state.slots.length < slots) {
      state.slots.push({ action: null, progress: 0, share: 0, data: null });
    }
    for (let i = 0; i < slots; i++) {
      const start =
        i === at
          ? ({ type: 'action.start', slot: i, kind: 'fight', id: 'core:dummy' } as const)
          : ({
              type: 'action.start',
              slot: i,
              kind: 'drill',
              id: ['core:lystok_na_lobi', 'core:kunai_na_doloni', 'core:chakra_v_stopakh'][i] ?? '',
            } as const);
      expect(dispatch(state, start, content)).toEqual({ ok: true });
    }
    return state;
  }
  const kills = (s: GameState) => s.counters['kills.core:dummy'] ?? 0;
  const ticks = (s: GameState) => s.counters['actions.fight'] ?? 0;

  it('halves kills and XP at a 500 share', () => {
    const full = shared(5, 1, 0);
    const half = shared(5, 2, 0);
    expect(half.slots[0]?.share).toBe(SHARE_FULL / 2);
    advance(full, HOUR, content);
    advance(half, HOUR, content);
    expect(ticks(half) * 2).toBe(ticks(full));
    // Kills are not exactly linear (the longer run levels up and hits harder), but an hour at
    // half share is the same fight as half an hour at full share, kill for kill (checked below).
    expect(kills(half)).toBeLessThan(kills(full));
    const vit0 = xpAt(40);
    // Vitality and Evasion are trained only by the fight, so their totals halve exactly.
    expect(half.skills.vit!.xp - vit0).toBeCloseTo((full.skills.vit!.xp - vit0) / 2, 6);
    expect(half.skills.eva!.xp).toBeCloseTo(full.skills.eva!.xp / 2, 6);
    // The same clock gives the same fight: half an hour at full speed matches an hour at half.
    const thirty = shared(5, 1, 0);
    advance(thirty, HOUR / 2, content);
    expect(kills(thirty)).toBe(kills(half));
  });

  for (const [slots, at] of [
    [2, 0],
    [3, 1],
  ] as const) {
    it(`gives byte-identical saves for any chunking at ${slots} slots`, () => {
      const run = (chunk: number): string => {
        const state = shared(6, slots, at);
        for (let t = 0; t < 120_000; t += chunk)
          advance(state, Math.min(chunk, 120_000 - t), content);
        return serialize(state, 0);
      };
      const whole = run(120_000);
      for (const chunk of [1, 7, 999, 3600]) expect(run(chunk)).toBe(whole);
      expect(deserialize(whole, content).combat?.fight.t).toBeGreaterThan(0);
    });
  }
});
