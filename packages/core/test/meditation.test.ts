/** Meditation: Insights and Enlightenments, buying modifier levels, nature locks. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  dispatch,
  getMod,
  listMeditationMods,
  meditateKind,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, plainRules, start, withNatures } from './helpers.ts';

const QUIET = 'core:tykha_kimnata';
const FIRE = 'core:bilia_vohnyshcha';
const K = content.balance.K.meditation;

const buy = (s: GameState, practice: string, mod: string) =>
  dispatch(s, { type: 'meditation.buy', practice, mod }, content);
const rich = (s: GameState, practice: string, insight = 1000, enlight = 1000) => {
  s.meditation[practice] = { insight, enlight, bought: {} };
};
const masteryAt = (s: GameState, key: string, level: number) => {
  s.mastery[key] = { xp: xpAt(level) };
};

describe('A6: Insights and Enlightenments', () => {
  it('rolls 5% and 2% per completed cycle on the action stream', () => {
    const s = genin();
    const n = 20_000;
    // Plain rules: base chances, without the checkpoint that raises the Insight chance.
    for (let i = 0; i < n; i++) meditateKind.complete(s, QUIET, content, plainRules);
    const entry = s.meditation[QUIET];
    expect(entry).toBeDefined();
    expect(Math.abs((entry?.insight ?? 0) / n - K.insightChance)).toBeLessThan(0.007);
    expect(Math.abs((entry?.enlight ?? 0) / n - K.enlightChance)).toBeLessThan(0.005);
  });

  it('stores them per practice and emits an event for each', () => {
    const s = genin();
    for (let i = 0; i < 400; i++) meditateKind.complete(s, QUIET, content, defaultRules);
    for (let i = 0; i < 400; i++) meditateKind.complete(s, FIRE, content, defaultRules);
    const a = s.meditation[QUIET];
    const b = s.meditation[FIRE];
    expect(a?.insight).toBeGreaterThan(0);
    expect(b?.insight).toBeGreaterThan(0);
    const gains = s.events.filter((e) => e.type === 'meditationGain');
    expect(gains.length).toBe(
      (a?.insight ?? 0) + (a?.enlight ?? 0) + (b?.insight ?? 0) + (b?.enlight ?? 0),
    );
  });

  it('earns them while the meditate action runs', () => {
    const s = genin();
    expect(dispatch(s, start('meditate', QUIET), content)).toEqual({ ok: true });
    advance(s, HOUR, content);
    const cycles = s.counters['actions.meditate'] ?? 0;
    expect(cycles).toBeGreaterThan(1000);
    const entry = s.meditation[QUIET];
    expect((entry?.insight ?? 0) / cycles).toBeGreaterThan(0.03);
  });

  it('charges level n its own number, up to 8 insight and 5 enlightenment levels', () => {
    const s = genin();
    rich(s, QUIET, 36, 15);
    masteryAt(s, QUIET, 99);
    let left = 36;
    for (let level = 1; level <= K.insightLevels; level++) {
      expect(buy(s, QUIET, 'insight.0')).toEqual({ ok: true });
      left -= level;
      expect(s.meditation[QUIET]?.insight).toBe(left);
      expect(s.meditation[QUIET]?.bought['insight.0']).toBe(level);
    }
    expect(left).toBe(0);
    s.meditation[QUIET]!.insight = 100;
    expect(buy(s, QUIET, 'insight.0')).toEqual({ ok: false, reason: 'error.maxLevel' });
    expect(s.meditation[QUIET]?.insight).toBe(100);
    for (let level = 1; level <= K.enlightLevels; level++) {
      expect(buy(s, QUIET, 'enlight.0')).toEqual({ ok: true });
    }
    expect(s.meditation[QUIET]?.enlight).toBe(0);
    s.meditation[QUIET]!.enlight = 100;
    expect(buy(s, QUIET, 'enlight.0')).toEqual({ ok: false, reason: 'error.maxLevel' });
  });

  it('refuses a level it cannot pay and leaves the state alone', () => {
    const s = genin();
    rich(s, QUIET, 3, 0);
    expect(buy(s, QUIET, 'insight.0')).toEqual({ ok: true }); // costs 1
    expect(buy(s, QUIET, 'insight.0')).toEqual({ ok: true }); // costs 2
    expect(s.meditation[QUIET]?.insight).toBe(0);
    const before = JSON.stringify(s.meditation);
    expect(buy(s, QUIET, 'insight.0')).toEqual({ ok: false, reason: 'error.notEnoughInsights' });
    expect(JSON.stringify(s.meditation)).toBe(before);
    expect(buy(s, QUIET, 'enlight.1')).toEqual({ ok: false, reason: 'error.masteryTooLow' });
    expect(buy(s, QUIET, 'insight.7')).toEqual({ ok: false, reason: 'error.unknownMeditationMod' });
    expect(buy(s, QUIET, 'nonsense')).toEqual({ ok: false, reason: 'error.unknownMeditationMod' });
    expect(buy(s, 'core:nope', 'insight.0')).toEqual({
      ok: false,
      reason: 'error.unknownPractice',
    });
  });

  it('opens insight modifiers at practice mastery 1 / 40 / 80 and enlightenment at 20 / 60 / 99', () => {
    const gates = (kind: 'insight' | 'enlight', gate: number[]) => {
      gate.forEach((g, i) => {
        const s = genin();
        rich(s, QUIET);
        if (g > 1) masteryAt(s, QUIET, g - 1);
        const below = buy(s, QUIET, `${kind}.${i}`);
        if (g > 1)
          expect(below, `${kind}.${i} at ${g - 1}`).toEqual({
            ok: false,
            reason: 'error.masteryTooLow',
          });
        masteryAt(s, QUIET, g);
        expect(buy(s, QUIET, `${kind}.${i}`), `${kind}.${i} at ${g}`).toEqual({ ok: true });
      });
    };
    expect(K.insightGates).toEqual([1, 40, 80]);
    expect(K.enlightGates).toEqual([20, 60, 99]);
    gates('insight', K.insightGates);
    gates('enlight', K.enlightGates);
  });

  it('gives each bought level total / levels of the modifier value', () => {
    const s = genin();
    rich(s, QUIET);
    masteryAt(s, QUIET, 99);
    // insight.1: +8% Ninjutsu XP over 8 levels
    for (const levels of [1, 3, 8]) {
      s.meditation[QUIET]!.bought['insight.1'] = levels;
      const result = getMod(s, 'xp.skill.nin', content);
      expect(result.total).toBeCloseTo(1 + (0.08 * levels) / 8, 12);
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]?.source).toEqual({ kind: 'practice', id: QUIET });
    }
    // enlight.0: -5% non-elemental chakra cost over 5 levels
    s.meditation[QUIET]!.bought['enlight.0'] = 2;
    expect(getMod(s, 'cost.chakra.nonelemental', content).total).toBeCloseTo(
      1 - (0.05 * 2) / 5,
      12,
    );
  });

  it('takes effect in the mechanic: a bought level shortens the Chakra Control drill', () => {
    const s = genin();
    rich(s, QUIET);
    masteryAt(s, QUIET, 99);
    const drill = defaultRules.actionKinds.drill;
    const base = drill?.intervalMs(s, 'core:lystok_na_lobi', content, defaultRules) ?? 0;
    s.meditation[QUIET]!.bought['insight.2'] = 4; // -8% over 8 levels: -4%
    expect(drill?.intervalMs(s, 'core:lystok_na_lobi', content, defaultRules)).toBe(
      Math.round(base * 0.96),
    );
  });
});

describe('A5: modifiers of a nature the player does not own stay locked', () => {
  it('are inactive and reported as locked until the nature is owned', () => {
    const s = genin();
    rich(s, FIRE);
    masteryAt(s, FIRE, 99);
    s.meditation[FIRE]!.bought['insight.0'] = 8; // +8% Katon XP, needs Katon
    s.meditation[FIRE]!.bought['insight.1'] = 8; // +8% Provisions XP, no nature
    s.meditation[FIRE]!.bought['enlight.1'] = 5; // +10% Burn duration, needs Katon
    expect(getMod(s, 'xp.skill.katon', content).total).toBe(1);
    expect(getMod(s, 'burn.duration', content).total).toBe(1);
    expect(getMod(s, 'xp.skill.prov', content).total).toBeCloseTo(1.08, 12);
    const locked = listMeditationMods(s, FIRE, content).filter((m) => m.lockedNature !== null);
    expect(locked.map((m) => m.ref)).toEqual(['insight.0', 'enlight.1']);
    expect(locked.every((m) => m.lockedNature === 'katon' && !m.active)).toBe(true);
    withNatures(s, 'futon', 'katon'); // katon is owned but not native: no native bonus
    expect(getMod(s, 'xp.skill.katon', content).total).toBeCloseTo(1.08, 12);
    expect(getMod(s, 'burn.duration', content).total).toBeCloseTo(1.1, 12);
    expect(listMeditationMods(s, FIRE, content).filter((m) => m.lockedNature !== null)).toEqual([]);
    expect(listMeditationMods(s, FIRE, content).filter((m) => m.active)).toHaveLength(3);
  });

  it('can still be bought while locked', () => {
    const s = genin();
    rich(s, FIRE);
    expect(buy(s, FIRE, 'insight.0')).toEqual({ ok: true });
  });
});
