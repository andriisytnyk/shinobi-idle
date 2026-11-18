/** A clone's fight pays only when the clone wins it: a lost fight gives no XP, no Mastery, no loot. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  dispatch,
  growSlots,
  deserialize,
  serialize,
  type GameState,
} from '../src/index.ts';
import { HOUR, setLevel } from './helpers.ts';
import { fighter, ids, startFight, stock } from './prep-state.ts';

const CLONE = 'core:shadow_clone';
const WOLF = 'core:zone_wolf';
const HARD = 'core:zone_foreign_genin';
const MIN = 60_000;

function cloner(seed: number, level: number): GameState {
  const state = fighter(seed, level);
  state.known[CLONE] = true;
  growSlots(state, content);
  stock(state, { [ids.heal]: 300 });
  state.events = [];
  return state;
}

const totalXp = (s: GameState): number => Object.values(s.skills).reduce((a, k) => a + k.xp, 0);
const totalMastery = (s: GameState): number =>
  Object.values(s.mastery).reduce((a, m) => a + m.xp, 0);

/** Runs a clone of `level` in `zone` for `ms`, in steps. */
function probe(zone: string, level: number, ms: number, seed = 5): GameState {
  const s = cloner(seed, level);
  expect(startFight(s, zone, 1)).toEqual({ ok: true });
  for (let t = 0; t < ms; t += MIN) advance(s, Math.min(MIN, ms - t), content);
  return s;
}

describe('a lost clone fight pays nothing', () => {
  it('the hardest zone is no longer the best for a clone (the review probe)', () => {
    const hard = probe(HARD, 10, 4 * HOUR);
    const easy = probe(WOLF, 10, 4 * HOUR);
    const gain = (s: GameState): number => totalXp(s) - totalXp(cloner(5, 10));
    expect(hard.report[HARD]?.losses ?? 0).toBeGreaterThan(0);
    expect(gain(hard)).toBeLessThan(gain(easy) / 2);
  });

  it('pays no XP and no Mastery while the clone only loses', () => {
    const s = cloner(6, 1);
    setLevel(s, 'nin', 1);
    const xp0 = totalXp(s);
    const m0 = totalMastery(s);
    startFight(s, HARD, 1);
    let lost = 0;
    for (let i = 0; i < 30 && lost === 0; i++) {
      advance(s, MIN, content);
      lost = s.report[HARD]?.losses ?? 0;
    }
    expect(lost).toBeGreaterThan(0);
    expect(s.report[HARD]?.wins ?? 0).toBe(0);
    expect(s.report[HARD]?.cloneLosses).toBe(lost);
    expect(totalXp(s)).toBe(xp0);
    expect(totalMastery(s)).toBe(m0);
  });

  it('pays a won fight what it earned (on the win, not before)', () => {
    const s = cloner(7, 36);
    startFight(s, WOLF, 1);
    const xp0 = totalXp(s);
    let seenKept = false;
    for (let i = 0; i < 40 && (s.report[WOLF]?.wins ?? 0) === 0; i++) {
      advance(s, 1000, content);
      if (s.combat?.pending && (s.report[WOLF]?.wins ?? 0) === 0) {
        seenKept = true;
        expect(totalXp(s)).toBe(xp0);
      }
    }
    expect(seenKept).toBe(true);
    expect(s.report[WOLF]?.wins).toBeGreaterThan(0);
    expect(totalXp(s)).toBeGreaterThan(xp0);
    expect(totalMastery(s)).toBeGreaterThan(0);
  });

  it('pays what was earned so far when the clone is dispelled mid-fight', () => {
    const s = cloner(8, 36);
    startFight(s, WOLF, 1);
    const xp0 = totalXp(s);
    advance(s, 2_000, content);
    expect(s.combat?.pending).toBeDefined();
    expect(totalXp(s)).toBe(xp0);
    expect(dispatch(s, { type: 'clone.dispel' }, content)).toEqual({ ok: true });
    expect(s.combat).toBeNull();
    expect(totalXp(s)).toBeGreaterThan(xp0);
  });

  it("leaves the character's own fights paid by time, as before", () => {
    const s = cloner(9, 36);
    startFight(s, WOLF, 0);
    const xp0 = totalXp(s);
    advance(s, 2_000, content);
    expect(s.combat?.pending).toBeUndefined();
    expect(totalXp(s)).toBeGreaterThan(xp0);
  });

  it('keeps the kept earnings across a save', () => {
    const s = cloner(10, 36);
    startFight(s, WOLF, 1);
    advance(s, 2_000, content);
    const kept = s.combat?.pending;
    expect(kept).toBeDefined();
    const loaded = deserialize(serialize(s, 7), content);
    expect(loaded.combat?.pending).toEqual(kept);
  });

  it('is deterministic, split-invariant and the same offline', () => {
    const run = (chunks: number[]): GameState => {
      const s = cloner(11, 10);
      startFight(s, HARD, 1);
      let left = 40 * MIN;
      for (let i = 0; left > 0; i++) {
        const step = Math.min(left, chunks[i % chunks.length] ?? 1);
        advance(s, step, content);
        left -= step;
      }
      return s;
    };
    const whole = run([40 * MIN]);
    expect(JSON.stringify(run([40 * MIN]))).toBe(JSON.stringify(whole));
    for (const chunks of [[7_001], [999, 5_003], [60_000, 1, 33_333]]) {
      const cut = run(chunks);
      expect(cut.skills).toEqual(whole.skills);
      expect(cut.mastery).toEqual(whole.mastery);
      expect(JSON.stringify(cut.combat)).toBe(JSON.stringify(whole.combat));
      expect(cut.report).toEqual(whole.report);
    }
  });
});
