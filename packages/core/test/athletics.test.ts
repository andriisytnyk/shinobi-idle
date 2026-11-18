/** Athletics course: building obstacles, laps, the pillar, and the modifiers of built obstacles. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  cycleSeconds,
  advance,
  buildCost,
  builtObstacles,
  courseKind,
  defaultRules,
  dispatch,
  getMod,
  lapIntervalMs,
  listCourse,
  poolCapacity,
  serialize,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, plainRules, setLevel, start } from './helpers.ts';

const K = content.balance.K;
/** One obstacle's cycle in ms: obstacles of later slots take longer. */
const cycleMs = (o: { cycle?: number | undefined; level: number }): number =>
  Math.round(cycleSeconds('obstacle', o, content) * 1000);
/** A lap at full speed before modifiers: the cycles of the built obstacles added up. */
const lapMs = (s: GameState): number =>
  builtObstacles(s, content).reduce((sum, o) => sum + cycleMs(o), 0);

/** Obstacles with no Athletics XP or Athletics speed modifier, one per slot, so laps follow the plain formula. */
const NEUTRAL: Record<number, string> = {
  1: 'core:bih_navkolo_sela',
  2: 'core:vidzhymannia_na_paltsiakh',
  3: 'core:ukhylennia_vid_kunaiv',
  4: 'core:bih_po_derevakh',
  5: 'core:perehony_z_supernykom',
  6: 'core:plavannia_proty_techii',
};

const build = (s: GameState, slot: number, obstacle: string) =>
  dispatch(s, { type: 'athletics.build', slot, obstacle }, content);

/** A genin who has everything open and plenty of ryo. */
function rich(seed = 1): GameState {
  const s = genin(seed);
  setLevel(s, 'ath', 50);
  setLevel(s, 'cc', 30);
  s.currencies.ryo = 1_000_000;
  return s;
}

/** Builds the first `count` neutral obstacles, then drops Athletics below the cap so XP still lands. */
function buildNeutral(s: GameState, count: number): void {
  for (let slot = 1; slot <= count; slot++) {
    expect(build(s, slot, NEUTRAL[slot] as string), `slot ${slot}`).toEqual({ ok: true });
  }
  setLevel(s, 'ath', 20);
}

describe('A7: building obstacles', () => {
  it('builds slot 1 for free and charges base x slot squared for the rest', () => {
    const s = rich();
    expect(build(s, 1, NEUTRAL[1] as string)).toEqual({ ok: true });
    expect(s.currencies.ryo!).toBe(1_000_000);
    for (let slot = 2; slot <= 6; slot++) {
      const before = s.currencies.ryo!;
      expect(build(s, slot, NEUTRAL[slot] as string)).toEqual({ ok: true });
      expect(before - s.currencies.ryo!, `slot ${slot}`).toBe(K.obstacleBase * slot ** 2);
    }
    expect(K.obstacleBase * 4).toBe(600);
    expect(Object.keys(s.course).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('replaces the first obstacle with the other one at full cost, slot 1 included', () => {
    const s = rich();
    build(s, 1, 'core:strybky_po_dakhakh');
    expect(s.currencies.ryo!).toBe(1_000_000);
    expect(build(s, 1, 'core:bih_navkolo_sela')).toEqual({ ok: true });
    expect(s.currencies.ryo!).toBe(1_000_000 - K.obstacleBase);
    expect(s.course['1']).toBe('core:bih_navkolo_sela');
    build(s, 3, 'core:koloda_nad_prirvoiu');
    const before = s.currencies.ryo!;
    expect(build(s, 3, 'core:ukhylennia_vid_kunaiv')).toEqual({ ok: true });
    expect(before - s.currencies.ryo!).toBe(K.obstacleBase * 9);
    expect(build(s, 3, 'core:ukhylennia_vid_kunaiv')).toEqual({
      ok: false,
      reason: 'error.alreadyBuilt',
    });
  });

  it('opens slots at Athletics 1, 10, 20, 30, 40 and 50', () => {
    const levels = [1, 10, 20, 30, 40, 50];
    for (const [i, level] of levels.entries()) {
      const slot = i + 1;
      const s = genin();
      setLevel(s, 'cc', 30);
      s.currencies.ryo = 1_000_000;
      if (level > 1) {
        setLevel(s, 'ath', level - 1);
        expect(build(s, slot, NEUTRAL[slot] as string), `slot ${slot} at ${level - 1}`).toEqual({
          ok: false,
          reason: 'error.slotLocked',
        });
      }
      setLevel(s, 'ath', level);
      expect(build(s, slot, NEUTRAL[slot] as string), `slot ${slot} at ${level}`).toEqual({
        ok: true,
      });
    }
  });

  it('enforces the obstacle requirement: Chakra Control 15 for trees and 30 for water', () => {
    const s = genin();
    setLevel(s, 'ath', 50);
    s.currencies.ryo = 1_000_000;
    setLevel(s, 'cc', 14);
    expect(build(s, 4, 'core:bih_po_derevakh')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    expect(build(s, 4, 'core:lazinnia_po_skeli')).toEqual({ ok: true });
    setLevel(s, 'cc', 15);
    expect(build(s, 4, 'core:bih_po_derevakh')).toEqual({ ok: true });
    setLevel(s, 'cc', 29);
    expect(build(s, 6, 'core:bih_po_vodi')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    setLevel(s, 'cc', 30);
    expect(build(s, 6, 'core:bih_po_vodi')).toEqual({ ok: true });
  });

  it('refuses unknown obstacles, the wrong slot and a purse that is too thin, changing nothing', () => {
    const s = rich();
    s.currencies.ryo = 599;
    const before = serialize(s);
    expect(build(s, 2, 'core:vidzhymannia_na_paltsiakh')).toEqual({
      ok: false,
      reason: 'error.notEnoughRyo',
    });
    expect(build(s, 1, 'core:nope')).toEqual({ ok: false, reason: 'error.unknownObstacle' });
    expect(build(s, 1, 'core:vidzhymannia_na_paltsiakh')).toEqual({
      ok: false,
      reason: 'error.invalidSlot',
    });
    expect(serialize(s)).toBe(before);
    s.currencies.ryo = 600;
    expect(build(s, 2, 'core:vidzhymannia_na_paltsiakh')).toEqual({ ok: true });
    expect(s.currencies.ryo!).toBe(0);
  });

  it('applies obstacle.cost modifiers to the price', () => {
    const s = rich();
    s.pools.ath!.xp = (poolCapacity('ath', content) * 10) / 100; // -5% obstacle price
    const second = content.obstacles.find((o) => o.id === NEUTRAL[2]);
    if (!second) throw new Error('no obstacle');
    expect(buildCost(s, second, content, defaultRules)).toBe(Math.round(600 * 0.95));
    const before = s.currencies.ryo!;
    build(s, 2, NEUTRAL[2] as string);
    expect(before - s.currencies.ryo!).toBe(570);
  });

  it('lists the slots with costs and why an option is closed', () => {
    const s = genin();
    s.currencies.ryo = 10;
    const slots = listCourse(s, content, defaultRules);
    expect(slots.map((x) => x.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(slots[0]?.open).toBe(true);
    expect(slots[0]?.options.map((o) => o.cost)).toEqual([0, 0]);
    expect(slots[1]?.open).toBe(false);
    expect(slots[1]?.options[0]?.blocked).toBe('error.slotLocked');
  });
});

describe('A7: laps', () => {
  it.each([1, 3, 6])(
    'runs %i obstacles in a lap of the sum of their cycles that pays the sum of their XP',
    (n) => {
      const s = rich();
      buildNeutral(s, n);
      const built = builtObstacles(s, content);
      expect(built).toHaveLength(n);
      expect(lapIntervalMs(s, content, defaultRules)).toBe(lapMs(s));
      expect(courseKind.intervalMs(s, 'ath', content, defaultRules)).toBe(lapMs(s));
      const pillar = n >= K.athletics.pillarCount ? 1 + K.athletics.pillarXp : 1;
      const expected = built.reduce((sum, o) => sum + (o.xp ?? 0), 0) * pillar;
      const before = s.skills.ath!.xp;
      courseKind.complete(s, 'ath', content, defaultRules);
      expect(s.skills.ath!.xp - before).toBeCloseTo(expected, 6);
      // Every built obstacle earned mastery.
      for (const o of built) expect(s.mastery[o.id]?.xp, o.id).toBeGreaterThan(0);
    },
  );

  it('runs the lap as an action: one lap takes the sum of the cycles, XP per hour is the XP of a lap over its time', () => {
    for (const n of [1, 3]) {
      const s = rich();
      buildNeutral(s, n);
      expect(dispatch(s, start('course', 'ath'), content)).toEqual({ ok: true });
      advance(s, lapMs(s) - 1, content);
      expect(s.counters['actions.course'] ?? 0).toBe(0);
      advance(s, 1, content);
      expect(s.counters['actions.course']).toBe(1);
      const before = s.skills.ath!.xp;
      advance(s, HOUR, content);
      const meanRate =
        (builtObstacles(s, content).reduce((sum, o) => sum + (o.xp ?? 0), 0) * HOUR) / lapMs(s);
      expect((s.skills.ath!.xp - before) / meanRate).toBeGreaterThan(0.99);
      expect((s.skills.ath!.xp - before) / meanRate).toBeLessThan(1.01);
    }
  });

  it('refuses to start with nothing built, and starts once one obstacle stands', () => {
    const s = genin();
    expect(dispatch(s, start('course', 'ath'), content)).toEqual({
      ok: false,
      reason: 'error.noObstacles',
    });
    build(s, 1, NEUTRAL[1] as string);
    expect(dispatch(s, start('course', 'ath'), content)).toEqual({ ok: true });
  });

  it('lengthens a running lap when an obstacle is added', () => {
    const s = rich();
    buildNeutral(s, 1);
    dispatch(s, start('course', 'ath'), content);
    advance(s, 1000, content);
    build(s, 2, NEUTRAL[2] as string);
    advance(s, lapMs(s) - 1000 - 1, content);
    expect(s.counters['actions.course'] ?? 0).toBe(0);
    advance(s, 1, content);
    expect(s.counters['actions.course']).toBe(1);
  });

  it('adds the pillar from five built obstacles: +5% Athletics XP', () => {
    const s = rich();
    for (let slot = 1; slot <= 4; slot++) build(s, slot, NEUTRAL[slot] as string);
    expect(getMod(s, 'xp.skill.ath', content).total).toBe(1);
    build(s, 5, NEUTRAL[5] as string);
    const pillar = getMod(s, 'xp.skill.ath', content);
    expect(pillar.total).toBeCloseTo(1 + K.athletics.pillarXp, 12);
    expect(pillar.parts[0]?.source).toEqual({ kind: 'skill', id: 'ath' });
  });
});

describe('A7: modifiers of built obstacles', () => {
  it('applies the bonus and the penalty, lists the obstacle as source, and swaps them on replacement', () => {
    const s = rich();
    build(s, 2, 'core:obtiazhuvachi'); // +3% Taijutsu XP / -2% Athletics speed
    const tai = getMod(s, 'xp.skill.tai', content);
    expect(tai.total).toBeCloseTo(1.03, 12);
    expect(tai.parts[0]?.source).toEqual({ kind: 'obstacle', id: 'core:obtiazhuvachi' });
    const speed = getMod(s, 'speed.skill.ath', content);
    expect(speed.total).toBeCloseTo(0.98, 12);
    // The penalty changes the lap exactly: the cycle is divided by the speed.
    build(s, 1, NEUTRAL[1] as string);
    expect(lapIntervalMs(s, content, defaultRules)).toBe(Math.round(lapMs(s) / 0.98));
    // The other obstacle of the slot swaps the modifiers.
    build(s, 2, 'core:vidzhymannia_na_paltsiakh'); // +2% stamina pool / -1% Alchemy speed
    expect(getMod(s, 'xp.skill.tai', content).total).toBe(1);
    expect(getMod(s, 'speed.skill.ath', content).total).toBe(1);
    expect(getMod(s, 'pool.stamina', content).total).toBeCloseTo(1.02, 12);
    expect(getMod(s, 'speed.skill.alch', content).total).toBeCloseTo(0.99, 12);
  });

  it('changes Taijutsu XP and Athletics speed by exactly the text of the obstacle', () => {
    const s = rich();
    build(s, 2, 'core:obtiazhuvachi');
    const base = rich();
    const gainOf = (state: GameState, rules = defaultRules) => {
      const before = state.skills.tai!.xp;
      // gainXp via a practice cycle of a known technique is covered elsewhere; call the kind directly.
      state.known['core:leaf_whirlwind'] = true;
      rules.actionKinds.practice?.complete(state, 'core:leaf_whirlwind', content, rules);
      return state.skills.tai!.xp - before;
    };
    expect(gainOf(s) / gainOf(base)).toBeCloseTo(1.03, 9);
  });

  it('resizes bonuses with obstacle.bonus and penalties with obstacle.penalty', () => {
    const s = rich();
    build(s, 2, 'core:obtiazhuvachi');
    s.pools.ath!.xp = (poolCapacity('ath', content) * 25) / 100; // +2% to every bonus
    expect(getMod(s, 'xp.skill.tai', content).total).toBeCloseTo(1 + 0.03 * 1.02, 12);
    expect(getMod(s, 'speed.skill.ath', content).total).toBeCloseTo(1 - 0.02, 12);
    s.pools.ath!.xp = (poolCapacity('ath', content) * 50) / 100; // and -25% to every penalty
    expect(getMod(s, 'xp.skill.tai', content).total).toBeCloseTo(1 + 0.03 * 1.02, 12);
    expect(getMod(s, 'speed.skill.ath', content).total).toBeCloseTo(1 - 0.02 * 0.75, 12);
  });

  it('keeps modifiers permanent: they stay while no action runs', () => {
    const s = rich();
    build(s, 3, 'core:ukhylennia_vid_kunaiv'); // +3% evasion rating / -1% accuracy
    advance(s, HOUR, content, plainRules);
    expect(getMod(s, 'evasion', content).total).toBeCloseTo(1.03, 12);
    expect(getMod(s, 'accuracy', content).total).toBeCloseTo(0.99, 12);
  });
});
