/**
 * The slow half of the analysis tests: the horizon of the supplies against four real hours, and
 * the honest intervals over twenty analysis seeds. They run whole sessions many times over.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { K } from './fight-helpers.ts';
import { ids } from './prep-state.ts';
import { analyze, boss, build, inBand, play, rateOf, zone, type Case } from './analysis-helpers.ts';
import type { Session } from '../src/index.ts';
void content;

/** The supplies: boss level 50 (a boss that is below that cannot be farmed without free healing: the health does not come back between fights) with a stock that runs out within the four hours played. */
describe('the horizon of the supplies', () => {
  for (const level of [50]) {
    it(
      `states the forecast for the time the stock lasts, and for after it, at level ${level}`,
      {
        timeout: 300_000,
      },
      () => {
        const c = boss(level);
        const a = analyze(build(c, 300 + level), c.target);
        const s = a.session;
        if (!s?.afterSupplies) throw new Error('no forecast for after the supplies');
        const heal = s.supplies.find((x) => x.item === ids.heal);
        expect(heal, 'the broths are a supply').toBeDefined();
        expect(s.horizonMinutes).toBe(s.supplies[0]?.lastsMinutes);
        expect(s.afterSupplies.removed).toContain(ids.heal);
        const games = [0, 1].map((g) => play(c, 400 + level + g, 240));
        const moments = games.flatMap((p) => (p.outAt === null ? [] : [p.outAt]));
        expect(moments.length, 'the stock ran out in play').toBe(games.length);
        const moment = moments.reduce((x, y) => x + y, 0) / moments.length;
        const horizon = s.horizonMinutes ?? 0;
        console.log(
          `level ${level}: horizon ${horizon.toFixed(0)} min, played ${moment.toFixed(0)} min; while supplies last ${(100 * s.winRate.p10).toFixed(0)}/${(100 * s.winRate.median).toFixed(0)}/${(100 * s.winRate.p90).toFixed(0)}% ${s.verdict}; after ${(100 * s.afterSupplies.winRate.p10).toFixed(0)}/${(100 * s.afterSupplies.winRate.median).toFixed(0)}/${(100 * s.afterSupplies.winRate.p90).toFixed(0)}% ${s.afterSupplies.verdict}; played by hour ${[0, 1, 2, 3].map((h) => (100 * (games.reduce((n, p) => n + rateOf(p.hours[h] ?? { wins: 0, fights: 0 }), 0) / games.length)).toFixed(0)).join(' / ')}`,
        );
        expect(Math.abs(horizon - moment) / moment).toBeLessThanOrEqual(0.2);
        // The first hour is played while the supplies last, the last one after they ran out.
        const first =
          games.reduce((n, p) => n + rateOf(p.hours[0] ?? { wins: 0, fights: 0 }), 0) /
          games.length;
        const last =
          games.reduce((n, p) => n + rateOf(p.hours[3] ?? { wins: 0, fights: 0 }), 0) /
          games.length;
        expect(inBand(first, s.winRate.p10, s.winRate.p90), `hour 1: ${first}`).toBe(true);
        expect(
          inBand(last, s.afterSupplies.winRate.p10, s.afterSupplies.winRate.p90),
          `hour 4: ${last}`,
        ).toBe(true);
        // The after-supplies forecast is worse than the main one.
        expect(s.afterSupplies.winRate.median).toBeLessThan(s.winRate.median);
      },
    );
  }

  it('omits the forecast for after the supplies when nothing that is used runs out', () => {
    const c = boss(50, 100_000);
    const a = analyze(build(c, 310), c.target, { sessionMinutes: 20, maxSessions: 4, samples: 20 });
    expect(a.session?.afterSupplies).toBeNull();
    const heal = a.session?.supplies.find((x) => x.item === ids.heal);
    expect(heal?.lastsMinutes ?? 0).toBeGreaterThan(K.analysis.horizonMinutes);
    expect(a.session?.horizonMinutes ?? 0).toBeGreaterThan(K.analysis.horizonMinutes);
  });
});

/** Intervals that are honest at small n, and a verdict that is not `stable` before it is earned. */
describe('honest intervals', () => {
  const verdicts = (c: Case, seeds: number, opts: object): Record<string, number> => {
    const counts: Record<string, number> = { stable: 0, risky: 0, hopeless: 0 };
    const state = build(c, 500);
    for (let seed = 1; seed <= seeds; seed++) {
      const s = analyze(state, c.target, { samples: 1, seed, ...opts }).session;
      if (s) counts[s.verdict] = (counts[s.verdict] ?? 0) + 1;
    }
    return counts;
  };

  // One test per seed: a single test that plays twenty whole analyses blocks the worker for so long
  // that the test runner loses contact with it on a slow CI machine.
  describe('does not call a marginal boss stable: level 48', () => {
    const counts: Record<string, number> = { stable: 0, risky: 0, hopeless: 0 };
    const c = boss(48, 100_000);
    let state: ReturnType<typeof build> | null = null;
    const SEEDS = 20;
    for (let seed = 1; seed <= SEEDS; seed++) {
      it(`analysis seed ${seed}`, { timeout: 120_000 }, () => {
        state ??= build(c, 500);
        // Whole sessions of the balance length: a shorter one does not see the Wounds spiral.
        const s = analyze(state, c.target, { samples: 1, seed }).session;
        if (!s) throw new Error('no session');
        counts[s.verdict] = (counts[s.verdict] ?? 0) + 1;
      });
    }
    it('is not stable for at least 19 of 20 seeds', () => {
      console.log(`level 48, ${SEEDS} seeds: ${JSON.stringify(counts)}`);
      expect((counts.stable ?? 0) + (counts.risky ?? 0) + (counts.hopeless ?? 0)).toBe(SEEDS);
      expect(counts.stable ?? 0).toBeLessThanOrEqual(1);
    });
  });

  it(
    'calls a safe zone stable for every seed, and never with a zero-width interval before enough sessions',
    { timeout: 300_000 },
    () => {
      const counts = verdicts(zone(false), 20, { sessionMinutes: 5, maxSessions: 24 });
      console.log(`safe zone, 20 seeds: ${JSON.stringify(counts)}`);
      expect(counts.stable).toBe(20);
      const state = build(zone(false), 501);
      const a = analyze(state, zone(false).target, { samples: 1, sessionMinutes: 5 });
      const s = a.session;
      if (!s) throw new Error('no session');
      // The interval of "no collapse" is as wide as the number of sessions allows, never 0 +- 0.
      expect(s.collapseCi.hi).toBeGreaterThan(0);
      expect(s.collapseCi.hi).toBeLessThan(K.analysis.verdict.stableCollapse);
      expect(s.collapseCi.n).toBe(s.runs);
      expect(s.runs).toBeGreaterThanOrEqual(
        Math.ceil(
          (K.analysis.confidenceZ * K.analysis.confidenceZ) / K.analysis.verdict.stableCollapse -
            K.analysis.confidenceZ * K.analysis.confidenceZ,
        ),
      );
    },
  );

  it('keeps asking for sessions until the interval is decided, and says risky when the budget ends first', () => {
    const c = boss(48, 100_000);
    const a = analyze(build(c, 502), c.target, {
      samples: 1,
      sessionMinutes: 15,
      maxSessions: 6,
    });
    // Six sessions cannot show a collapse share under the threshold, whatever they do.
    expect(a.session?.runs).toBe(6);
    expect(a.session?.verdict).not.toBe('stable');
    expect(a.session?.collapseCi.hi).toBeGreaterThan(K.analysis.verdict.stableCollapse);
  });

  it('gives the interval of every share: the first fight, the pooled sessions, the collapse, the no-defeat share', () => {
    const a = analyze(build(zone(false), 503), zone(false).target, {
      sessionMinutes: 5,
      maxSessions: 8,
      samples: 100,
    });
    const s = a.session as Session;
    for (const ci of [a.fresh.winRateCi, s.winRateCi, s.collapseCi, s.untilDefeat.noDefeatCi]) {
      expect(ci.lo).toBeGreaterThanOrEqual(0);
      expect(ci.hi).toBeLessThanOrEqual(1);
      expect(ci.hi).toBeGreaterThan(ci.lo);
      expect(ci.n).toBeGreaterThan(0);
    }
  });
});
