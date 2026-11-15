import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  dispatch,
  gainMasteryXp,
  gainPoolXp,
  defaultRules,
  gainXp,
  levelAt,
  masteryLevel,
  masteryXpPerAction,
  poolCapacity,
  poolGain,
  practiceIntervalSeconds,
  rate,
  techniqueCastSeconds,
  xpAt,
  type GameEvent,
  type Rules,
} from '../src/index.ts';
import { genin, HOUR, plainRules, setLevel, start, withNatures } from './helpers.ts';

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
      // A second nature, so the skill is open and no native bonus mixes into the rate.
      if (t.skill === 'katon') withNatures(state, 'futon', 'katon');
      setLevel(state, t.skill, level);
      state.known[id] = true;
      expect(dispatch(state, start(kind, id), content).ok).toBe(true);
      const before = state.skills[t.skill]!.xp;
      advance(state, HOUR, content);
      const perHour = state.skills[t.skill]!.xp - before;
      const expected = K.rateBase * K.rateGrowth ** level;
      expect(Math.abs(perHour / expected - 1)).toBeLessThan(0.02);
    });
  }

  it('drill, meditate and a one-obstacle course pay the same rate at their level', () => {
    const cases2: [string, string, 'cc' | 'med' | 'ath', number, string][] = [
      ['drill', 'core:kunai_na_doloni', 'cc', 5, 'core:kunai_na_doloni'],
      ['meditate', 'core:medytatsiia_v_rusi', 'med', 10, 'core:medytatsiia_v_rusi'],
      ['course', 'ath', 'ath', 10, 'core:obtiazhuvachi'],
    ];
    for (const [kind, id, skill, level, masteryKey] of cases2) {
      const state = genin();
      setLevel(state, skill, level);
      if (kind === 'course') state.course = { '2': masteryKey };
      expect(dispatch(state, start(kind, id), content, plainRules)).toEqual({ ok: true });
      const before = state.skills[skill]!.xp;
      advance(state, HOUR, content, plainRules);
      const perHour = state.skills[skill]!.xp - before;
      expect(Math.abs(perHour / rate(level, content) - 1)).toBeLessThan(0.02);
      expect(state.mastery[masteryKey]?.xp).toBeGreaterThan(0);
    }
  });

  it('interval.skill modifiers speed the cycle up', () => {
    const run = (rules: Rules) => {
      const state = genin();
      dispatch(state, start('practice', 'core:leaf_whirlwind'), content, rules);
      advance(state, HOUR, content, rules);
      return state.stats.completed;
    };
    const base = run(defaultRules);
    const fast = run({
      ...defaultRules,
      modifierProviders: [
        () => [
          { key: 'interval.skill.tai', op: 'add', value: -0.5, group: 'items', source: 'test' },
        ],
      ],
    });
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
      const a = student.skills.tai!.xp;
      gainXp(student, 'tai', 100, content, defaultRules);
      gainXp(g, 'tai', 100, content, defaultRules);
      const studentGain = student.skills.tai!.xp - a;
      const geninGain = g.skills.tai!.xp - a;
      expect(geninGain).toBe(100);
      expect(studentGain).toBe(level >= K.academyCap ? 100 * slow : 100);
    }
  });
});

describe('A5: a grant that crosses the Academy cap is split there', () => {
  const gate = xpAt(K.academyCap);

  it('student at level 9 with a big grant: full below the cap, slowed above', () => {
    const state = createState(1, content);
    setLevel(state, 'tai', 9);
    const room = gate - state.skills.tai!.xp;
    gainXp(state, 'tai', room + 1000, content, defaultRules);
    expect(state.skills.tai!.xp).toBeCloseTo(gate + 1000 * K.academySlow, 6);
  });

  it('gives the same XP in one grant as in two', () => {
    const one = createState(1, content);
    const two = createState(1, content);
    setLevel(one, 'tai', 9);
    setLevel(two, 'tai', 9);
    gainXp(one, 'tai', 5000, content, defaultRules);
    gainXp(two, 'tai', 2000, content, defaultRules);
    gainXp(two, 'tai', 3000, content, defaultRules);
    expect(two.skills.tai!.xp).toBeCloseTo(one.skills.tai!.xp, 6);
  });

  it('a grant crossing both the Academy cap and the level cap ends exactly at the cap', () => {
    const state = createState(1, content);
    setLevel(state, 'tai', 9);
    gainXp(state, 'tai', 1e12, content, defaultRules);
    expect(state.skills.tai!.xp).toBe(xpAt(K.cap));
    expect(levelAt(state.skills.tai!.xp, K.cap)).toBe(K.cap);
  });

  it('a genin keeps the whole grant', () => {
    const state = genin();
    setLevel(state, 'tai', 9);
    gainXp(state, 'tai', 5000, content, defaultRules);
    expect(state.skills.tai!.xp).toBe(xpAt(9) + 5000);
  });
});

describe('A6: the level cap', () => {
  it('mastery XP stops at the mastery cap', () => {
    const state = genin();
    gainMasteryXp(state, 'core:clone', 1e12, content);
    expect(state.mastery['core:clone']?.xp).toBe(xpAt(K.masteryCap));
  });

  it('XP never passes xpAt(cap) and the level never passes cap', () => {
    const state = genin();
    gainXp(state, 'tai', 1e12, content, defaultRules);
    gainXp(state, 'tai', 5, content, defaultRules);
    expect(state.skills.tai!.xp).toBe(xpAt(K.cap));
    expect(levelAt(state.skills.tai!.xp, K.cap)).toBe(K.cap);
  });

  it('a long run at the cap stays clamped', () => {
    const state = genin();
    state.skills.tai!.xp = xpAt(K.cap) - 10;
    dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
    advance(state, 2 * HOUR, content);
    expect(state.skills.tai!.xp).toBe(xpAt(K.cap));
  });

  it('emits one levelUp per level gained', () => {
    const state = genin();
    gainXp(state, 'tai', xpAt(4), content, defaultRules);
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
    withNatures(state, 'katon');
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
    expect(state.pools.nin!.xp).toBe(cap);
    expect(state.events.filter((e) => e.type === 'poolCheckpoint').length).toBe(4);
  });

  it('feeds the pool a share of mastery XP while practising', () => {
    const state = genin();
    dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
    advance(state, HOUR, content);
    const mastery = state.mastery['core:leaf_whirlwind']!.xp;
    expect(state.pools.tai!.xp).toBeCloseTo(mastery * K.poolShare, 3);
  });

  it('ignores skills without masteries and non-positive gains', () => {
    const state = genin();
    gainPoolXp(state, 'vit', 100, content);
    expect(state.pools.vit!.xp).toBe(0);
    gainXp(state, 'tai', -5, content, defaultRules);
    gainXp(state, 'tai', 0, content, defaultRules);
    gainMasteryXp(state, 'core:clone', 0, content);
    expect(state.skills.tai!.xp).toBe(0);
    expect(state.mastery).toEqual({});
  });
});
