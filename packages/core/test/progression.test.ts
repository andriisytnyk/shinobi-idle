import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  dispatch,
  gainMasteryXp,
  gainPoolXp,
  gainXp,
  levelAt,
  masteryLevel,
  masteryXpPerAction,
  poolCapacity,
  poolGain,
  registerModifierProvider,
  practiceIntervalSeconds,
  rate,
  techniqueCastSeconds,
  xpAt,
  type GameEvent,
} from '../src/index.ts';
import { genin, HOUR, setLevel, start } from './helpers.ts';

const K = content.balance.K;

describe('formulas', () => {
  it('rate follows rateBase * rateGrowth^level and clamps the level to 1..cap', () => {
    expect(rate(30, content)).toBeCloseTo(K.rateBase * K.rateGrowth ** 30, 6);
    expect(rate(0, content)).toBe(rate(1, content));
    expect(rate(500, content)).toBe(rate(K.cap, content));
  });

  it('cast time grows with seals and shrinks with mastery, never below one seal', () => {
    expect(techniqueCastSeconds(0, 1, content)).toBeCloseTo(K.castBase, 9);
    expect(techniqueCastSeconds(6, 0, content)).toBeCloseTo(K.castBase + K.castPerSeal * 6, 9);
    const m99 = techniqueCastSeconds(6, K.masteryCap, content);
    expect(m99).toBeCloseTo(K.castBase + K.castPerSeal * 6 * (1 - K.masteryCast), 9);
    expect(techniqueCastSeconds(1, K.masteryCap, content)).toBeCloseTo(
      K.castBase + K.castPerSeal,
      9,
    );
  });

  it('practice interval is cast plus recovery, at least the minimum', () => {
    expect(practiceIntervalSeconds(0.4, content)).toBe(K.practiceMin);
    expect(practiceIntervalSeconds(5, content)).toBeCloseTo(5 + K.practiceRecovery, 9);
  });

  it('mastery XP per action and pool numbers come from the balance parameters', () => {
    expect(masteryXpPerAction(3600, content)).toBe(K.masteryPerHour);
    expect(poolGain(100, content)).toBe(100 * K.poolShare);
    const tech = content.techniques.filter((t) => t.skill === 'katon').length;
    expect(poolCapacity('katon', content)).toBe(K.poolCapPerItem * tech);
    expect(poolCapacity('cc', content)).toBe(K.poolCapPerItem * content.exercises.length);
  });
});

describe('A4: XP per hour follows the rate formula', () => {
  const cases: [number, string, 'practice'][] = [
    [1, 'core:leaf_whirlwind', 'practice'],
    [10, 'core:dynamic_entry', 'practice'],
    [30, 'core:great_fireball', 'practice'],
  ];
  for (const [level, id, kind] of cases) {
    it(`level ${level}`, () => {
      const t = content.techniques.find((x) => x.id === id)!;
      const state = genin();
      setLevel(state, t.skill, level);
      state.known[id] = true;
      expect(dispatch(state, start(kind, id), content).ok).toBe(true);
      const before = state.skills[t.skill].xp;
      advance(state, HOUR, content);
      const perHour = state.skills[t.skill].xp - before;
      const expected = K.rateBase * K.rateGrowth ** level;
      expect(Math.abs(perHour / expected - 1)).toBeLessThan(0.02);
    });
  }

  it('drill, meditate and obstacle pay the same rate at their level', () => {
    const cases2: [string, string, 'cc' | 'med' | 'ath', number][] = [
      ['drill', 'core:kunai_na_doloni', 'cc', 5],
      ['meditate', 'core:medytatsiia_v_rusi', 'med', 10],
      ['obstacle', 'core:obtiazhuvachi', 'ath', 10],
    ];
    for (const [kind, id, skill, level] of cases2) {
      const state = genin();
      setLevel(state, skill, level);
      expect(dispatch(state, start(kind, id), content)).toEqual({ ok: true });
      const before = state.skills[skill].xp;
      advance(state, HOUR, content);
      const perHour = state.skills[skill].xp - before;
      expect(Math.abs(perHour / rate(level, content) - 1)).toBeLessThan(0.02);
      expect(state.mastery[id]?.xp).toBeGreaterThan(0);
    }
  });

  it('interval.skill modifiers speed the cycle up', () => {
    const run = () => {
      const state = genin();
      dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
      advance(state, HOUR, content);
      return state.stats.completed;
    };
    const base = run();
    const off = registerModifierProvider(() => [
      { key: 'interval.skill.tai', op: 'add', value: -0.5, group: 'items', source: 'test' },
    ]);
    const fast = run();
    off();
    expect(fast / base).toBeCloseTo(2, 1);
  });
});

describe('A5: Academy slowdown', () => {
  it('slows a student only at or above the Academy cap', () => {
    const slow = K.academySlow;
    for (const level of [1, 5, 9, 10, 11, 30]) {
      const student = createState(1, content);
      const g = genin();
      setLevel(student, 'tai', level);
      setLevel(g, 'tai', level);
      const a = student.skills.tai.xp;
      gainXp(student, 'tai', 100, content);
      gainXp(g, 'tai', 100, content);
      const studentGain = student.skills.tai.xp - a;
      const geninGain = g.skills.tai.xp - a;
      expect(geninGain).toBe(100);
      expect(studentGain).toBe(level >= K.academyCap ? 100 * slow : 100);
    }
  });
});

describe('A6: the level cap', () => {
  it('XP never passes xpAt(cap) and the level never passes cap', () => {
    const state = genin();
    gainXp(state, 'tai', 1e12, content);
    gainXp(state, 'tai', 5, content);
    expect(state.skills.tai.xp).toBe(xpAt(K.cap));
    expect(levelAt(state.skills.tai.xp, K.cap)).toBe(K.cap);
  });

  it('a long run at the cap stays clamped', () => {
    const state = genin();
    state.skills.tai.xp = xpAt(K.cap) - 10;
    dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
    advance(state, 2 * HOUR, content);
    expect(state.skills.tai.xp).toBe(xpAt(K.cap));
  });

  it('emits one levelUp per level gained', () => {
    const state = genin();
    gainXp(state, 'tai', xpAt(4), content);
    const ups = state.events.filter((e) => e.type === 'levelUp');
    expect(ups.map((e) => e.level)).toEqual([2, 3, 4]);
  });
});

describe('A7: mastery pace', () => {
  it('level 25 arrives after 0.75 h of continuous practice, within 5%', () => {
    const state = genin();
    dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
    const seen: GameEvent[] = [];
    for (let i = 0; i < 90; i++) {
      advance(state, 60_000, content);
      seen.push(...state.events.splice(0));
    }
    const hit = seen.find((e) => e.type === 'masteryUp' && e.level === 25);
    expect(hit).toBeDefined();
    const hours = (hit?.at ?? 0) / HOUR;
    expect(Math.abs(hours / 0.75 - 1)).toBeLessThan(0.05);
    expect(masteryLevel(state, 'core:leaf_whirlwind', content)).toBeGreaterThanOrEqual(25);
  });

  it('practice with seals gets faster as mastery trims them', () => {
    const state = genin();
    setLevel(state, 'katon', 30);
    state.known['core:great_fireball'] = true;
    const early = (() => {
      dispatch(state, start('practice', 'core:great_fireball'), content);
      advance(state, 60_000, content);
      return state.stats.completed;
    })();
    state.mastery['core:great_fireball'] = { xp: xpAt(80) };
    const before = state.stats.completed;
    advance(state, 60_000, content);
    expect(state.stats.completed - before).toBeGreaterThan(early);
  });
});

describe('mastery and pool events', () => {
  it('queues masteryUp per level and poolCheckpoint once per threshold', () => {
    const state = genin();
    gainMasteryXp(state, 'core:clone', xpAt(3), content);
    expect(state.events.map((e) => e.type)).toEqual(['masteryUp', 'masteryUp']);

    state.events = [];
    const cap = poolCapacity('nin', content);
    gainPoolXp(state, 'nin', cap * 0.3, content);
    gainPoolXp(state, 'nin', cap * 0.3, content);
    const pcts = state.events.flatMap((e) => (e.type === 'poolCheckpoint' ? [e.pct] : []));
    expect(pcts).toEqual([10, 25, 50]);
    gainPoolXp(state, 'nin', cap * 10, content);
    expect(state.pools.nin.xp).toBe(cap);
    expect(state.events.filter((e) => e.type === 'poolCheckpoint').length).toBe(4);
  });

  it('feeds the pool a share of mastery XP while practising', () => {
    const state = genin();
    dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
    advance(state, HOUR, content);
    const mastery = state.mastery['core:leaf_whirlwind']!.xp;
    expect(state.pools.tai.xp).toBeCloseTo(mastery * K.poolShare, 3);
  });

  it('ignores skills without masteries and non-positive gains', () => {
    const state = genin();
    gainPoolXp(state, 'vit', 100, content);
    expect(state.pools.vit.xp).toBe(0);
    gainXp(state, 'tai', -5, content);
    gainXp(state, 'tai', 0, content);
    gainMasteryXp(state, 'core:clone', 0, content);
    expect(state.skills.tai.xp).toBe(0);
    expect(state.mastery).toEqual({});
  });
});
