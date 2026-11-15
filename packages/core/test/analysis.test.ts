/**
 * Battle analysis: the first fight, the session forecast against real play, secrecy, hints, the
 * comparison of loadouts, resumable jobs and speed. The played side of the forecast tests is the
 * real game: `dispatch` to start the action, `advance` to play it, a restart after every defeat as a
 * player would do, a realistic stock of pills, and Wounds that are never reset.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  analyzeFight,
  analysisProgress,
  compareLoadouts,
  defaultRules,
  serialize,
  startAnalysis,
  stepAnalysis,
  unlockBoss,
  type Analysis,
  type AnalysisTarget,
  type GameState,
} from '../src/index.ts';
import { K } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { wellStocked } from './prep-helpers.ts';
import { dispatch } from '../src/index.ts';
import {
  fighter,
  ids,
  know,
  run,
  startFight,
  startOperation,
  stock,
  unlock,
} from './prep-state.ts';

/** Pills the player keeps in the bank besides the pouch: a few hundred broths is what a few hours of play can buy. */
const BROTHS = 150;
const SESSIONS_PLAYED = 8;
/** A zone analysis must stay well under a second. */
const ZONE_BUDGET_MS = 1000;

interface Case {
  name: string;
  target: AnalysisTarget;
  level: number;
  bank: Record<string, number>;
  knows?: string[];
  /** A drill in the second slot halves the share of the fight. */
  shared?: boolean;
  prepare: (state: GameState) => void;
}

const analyze = (state: GameState, target: AnalysisTarget, opts = {}): Analysis => {
  const result = analyzeFight(state, target, opts, content, defaultRules);
  if (!result) throw new Error('no analysis');
  return result;
};

const boss = (level: number): Case => ({
  name: `the hunter boss at level ${level}`,
  target: { kind: 'boss', id: 'core:zone_boss_hunter' },
  level,
  bank: { [ids.heal]: BROTHS },
  knows: ['core:boss_hunter'],
  prepare: (s) => {
    unlockBoss(s, 'core:boss_hunter', content);
    run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_hunter' });
  },
});

const zone = (shared: boolean): Case => ({
  name: shared ? 'a plain zone with a drill in the other slot' : 'a plain zone',
  target: { kind: 'zone', id: 'core:zone_wolfmask' },
  level: 2,
  bank: { [ids.heal]: BROTHS },
  shared,
  prepare: (s) => run(s, { type: 'loadout.prepare', encounter: 'core:zone_wolfmask' }),
});

const hideout: Case = {
  name: 'the hideout operation',
  target: { kind: 'operation', id: 'core:op_hideout' },
  level: 50,
  bank: Object.fromEntries(Object.keys(wellStocked(50)).map((id) => [id, 20 * K.pouchStack])),
  knows: ['core:guard_pack', 'core:boss_twins', 'core:boss_mist'],
  prepare: (s) => {
    unlock(s, 'op.hideout.unlocked');
    run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_twins' });
  },
};

function build(c: Case, seed: number): GameState {
  const state = fighter(seed, c.level, 'katon');
  setLevel(state, 'futon', c.level);
  setLevel(state, 'raiton', c.level);
  for (const id of c.knows ?? []) know(state, id);
  stock(state, c.bank);
  c.prepare(state);
  if (c.shared) {
    state.slots.push({ action: null, progress: 0, share: 1000, data: null });
    const drill = content.exercises[0];
    if (!drill) throw new Error('no drill');
    const started = dispatch(
      state,
      { type: 'action.start', slot: 1, kind: 'drill', id: drill.id },
      content,
    );
    if (!started.ok) throw new Error(`drill refused: ${started.reason}`);
  }
  return state;
}

interface Played {
  rate: number;
  winsPerHour: number;
  /** Minutes to the first defeat, or null when there was none. */
  firstDefeat: number | null;
}

/** Plays one session of the real game and reports what the forecast reports. */
function play(c: Case, seed: number, minutes: number): Played {
  const state = build(c, seed);
  const start = (): void => {
    const result =
      c.target.kind === 'operation'
        ? startOperation(state, c.target.id)
        : startFight(state, c.target.id);
    if (!result.ok) throw new Error(`cannot start ${c.target.id}: ${result.reason}`);
  };
  start();
  const win = c.target.kind === 'operation' ? 'operationCleared' : 'enemyDefeated';
  let wins = 0;
  let fights = 0;
  let firstDefeat: number | null = null;
  const key = c.target.kind === 'operation' ? c.target.id : c.target.id;
  for (let t = 0; t < minutes * 60_000; t += 1000) {
    advance(state, 1000, content);
    for (const e of state.events) {
      if (e.type === win) {
        wins++;
        fights++;
      } else if (e.type === 'playerDefeated') {
        fights++;
        firstDefeat ??= (t + 1000) / 60_000;
      }
    }
    state.events = [];
    const fighting = state.slots.some(
      (s) => s.action?.kind === 'fight' || s.action?.kind === 'operation',
    );
    if (!fighting) start();
  }
  if (c.target.kind !== 'operation') fights += state.report[key]?.timeouts ?? 0;
  return {
    rate: fights === 0 ? 0 : wins / fights,
    winsPerHour: (wins * 60) / minutes,
    firstDefeat,
  };
}

const inBand = (v: number, p10: number, p90: number): boolean => v >= p10 - 0.03 && v <= p90 + 0.03;

describe('the session forecast against real play', () => {
  const rows: string[] = [];
  const cases: { c: Case; verdict?: 'stable' | 'risky' | 'hopeless'; collapse?: boolean }[] = [
    { c: zone(false), verdict: 'stable' },
    { c: zone(true), verdict: 'stable' },
    { c: boss(40), verdict: 'hopeless' },
    { c: boss(46), verdict: 'risky', collapse: true },
    { c: boss(50), verdict: 'stable' },
    { c: hideout },
  ];
  for (const [i, { c, verdict, collapse }] of cases.entries()) {
    it(`describes ${c.name}`, { timeout: 300_000 }, () => {
      const state = build(c, 20 + i);
      const before = serialize(state, 0);
      const a = analyze(state, c.target);
      expect(serialize(state, 0), 'the analysis changes nothing').toBe(before);
      const s = a.session;
      if (!s) throw new Error('no session');
      const played = Array.from({ length: SESSIONS_PLAYED }, (_, g) =>
        play(c, 200 + 10 * i + g, s.minutes),
      );
      const inside = played.filter((p) => inBand(p.rate, s.winRate.p10, s.winRate.p90)).length;
      const meanPerHour = played.reduce((n, p) => n + p.winsPerHour, 0) / played.length;
      const noDefeat = played.filter((p) => p.firstDefeat === null).length / played.length;
      const row = `| ${c.name} | ${(100 * a.fresh.winRate).toFixed(0)}% | ${(100 * s.winRate.p10).toFixed(0)} / ${(100 * s.winRate.median).toFixed(0)} / ${(100 * s.winRate.p90).toFixed(0)}% (${s.runs} runs) | ${played.map((p) => (100 * p.rate).toFixed(0)).join(' ')} | ${s.winsPerHour.mean.toFixed(1)} / ${meanPerHour.toFixed(1)} | ${(100 * s.collapseShare).toFixed(0)}% | ${s.verdict} | ${(100 * s.untilDefeat.noDefeatShare).toFixed(0)}% / ${(100 * noDefeat).toFixed(0)}% | ${s.share} |`;
      rows.push(row);
      console.log(row);
      // The played sessions fall in the forecast band, in nearly all of the cases.
      expect(inside / played.length, 'sessions inside the p10-p90 band').toBeGreaterThanOrEqual(
        0.6,
      );
      if (verdict) expect(s.verdict).toBe(verdict);
      if (collapse) expect(s.collapseShare).toBeGreaterThan(0);
      expect(s.assumesRestart).toBe(true);
      // Where the sessions agree, the yield is a plain number and must match.
      if (s.winRate.p90 - s.winRate.p10 < 0.1 && s.winsPerHour.mean > 5) {
        expect(Math.abs(s.winsPerHour.mean - meanPerHour) / meanPerHour).toBeLessThanOrEqual(0.1);
      }
      // What happens without an immediate restart: the share of sessions with no defeat.
      expect(Math.abs(s.untilDefeat.noDefeatShare - noDefeat)).toBeLessThanOrEqual(0.4);
    });
  }

  it('says which share of the speed the fight slot has', () => {
    const alone = analyze(build(zone(false), 61), zone(false).target).session;
    const shared = analyze(build(zone(true), 62), zone(true).target).session;
    expect(alone?.share).toBe(1000);
    expect(shared?.share).toBe(500);
    // Half the speed, about half the wins per hour.
    const ratio = (shared?.winsPerHour.mean ?? 0) / (alone?.winsPerHour.mean ?? 1);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.6);
  });

  it('shows the tipping point as a spread, not a mean: sessions split between a collapse and a good run', () => {
    const c = boss(46);
    const s = analyze(build(c, 63), c.target).session;
    if (!s) throw new Error('no session');
    expect(s.winRate.p90 - s.winRate.p10).toBeGreaterThan(0.3);
    expect(s.collapseShare).toBeGreaterThan(0);
    expect(s.collapseShare).toBeLessThan(1);
    expect(s.collapseShareSe).toBeGreaterThan(0);
  });

  it('keeps the first fight apart from the yields: a boss that wins a fresh fight is not worth farming', () => {
    const c = boss(44);
    const a = analyze(build(c, 64), c.target);
    expect(a.fresh.winRate).toBeGreaterThan(0.6);
    expect(a.session?.winRate.median ?? 1).toBeLessThan(0.3);
    expect(a.session?.verdict).not.toBe('stable');
    expect('winsPerHour' in a).toBe(false);
    expect(a.fresh.winRateSe).toBeGreaterThan(0);
    expect(a.fresh.samples).toBe(K.analysis.samples);
  });
});

describe('what is once and what is a yield', () => {
  it('lists the first-kill bounty and the first clear apart from the per-hour figures', () => {
    const c = boss(50);
    const state = build(c, 70);
    state.bingo['core:boss_hunter'] = {
      seen: 1,
      wins: 0,
      losses: 0,
      timeouts: 0,
      bought: 3,
      bounty: 0,
    };
    const a = analyze(state, c.target);
    const bounty = content.bosses.find((b) => b.id === 'core:boss_hunter')?.bounty;
    expect(a.once.bounty).toBe(bounty?.first);
    // Once it is paid it is not offered again.
    state.bingo['core:boss_hunter'] = {
      seen: 1,
      wins: 1,
      losses: 0,
      timeouts: 0,
      bought: 3,
      bounty: 0,
    };
    expect(analyze(state, c.target).once.bounty).toBe(0);
    const op = build(hideout, 71);
    const clear = analyze(op, hideout.target).once.clear;
    expect(clear).toMatchObject({ ryo: 1500, rep: 40 });
    op.flags['op.hideout.cleared'] = true;
    expect(analyze(op, hideout.target).once.clear).toBeNull();
  });
});

describe('coverage, hints and secrecy', () => {
  const marauder: AnalysisTarget = { kind: 'zone', id: 'core:zone_marauder' };
  const kiri: AnalysisTarget = { kind: 'zone', id: 'core:zone_kiri_hunter' };
  const quick = { samples: 20, minSessions: 1, maxSessions: 1, sessionMinutes: 5 };

  /** A player with no answer to Evasive or to Hidden in the loadout or the pouch. */
  function bare(seed: number, level: number): GameState {
    const state = fighter(seed, level, 'katon');
    for (const id of Object.keys(state.known)) {
      const t = content.techniques.find((x) => x.id === id);
      if (t?.tags.includes('bind') || t?.tags.includes('reveal')) delete state.known[id];
    }
    run(state, { type: 'loadout.auto', on: true });
    return state;
  }

  it('lists exactly the known traits, and says nothing of the hidden ones', () => {
    const state = bare(1, 30);
    const unknown = analyze(state, kiri, quick);
    expect(unknown.coverage).toEqual([]);
    expect(unknown.hiddenTraits).toBe(1);
    expect(unknown.hints).toEqual([]);
    const text = JSON.stringify(unknown);
    expect(text).not.toContain('"trait":"hidden"');
    expect(text).not.toContain('sensing');
    know(state, 'core:kiri_hunter');
    const known = analyze(state, kiri, quick);
    expect(known.coverage.map((c) => c.trait)).toEqual(['hidden']);
    expect(known.hiddenTraits).toBe(0);
    const seen = bare(2, 40);
    seen.bingo['core:guard_pack'] = {
      seen: 1,
      wins: 0,
      losses: 0,
      timeouts: 0,
      bought: 0,
      bounty: 0,
    };
    const guards = analyze(seen, { kind: 'zone', id: 'core:zone_guard_pack' }, quick);
    expect(guards.coverage.map((c) => c.trait).sort()).toEqual(['armor', 'pack']);
  });

  it('names what answers a known trait: the technique or the item', () => {
    const state = fighter(3, 30, 'katon');
    setLevel(state, 'futon', 30);
    know(state, 'core:marauder');
    const bind = content.techniques.find((t) => t.tags.includes('bind') && t.src === 'N');
    if (!bind) throw new Error('no bind technique');
    state.known[bind.id] = true;
    run(state, { type: 'loadout.set', techniques: [bind.id, 'core:leaf_whirlwind'] });
    const a = analyze(state, marauder, quick);
    expect(a.coverage.find((c) => c.trait === 'evasive')).toMatchObject({
      answered: true,
      by: [{ kind: 'technique', id: bind.id }],
    });
    const wire = content.items.find((i) => i.tags.includes('bind') && i.pouch === true);
    if (!wire) throw new Error('no bind tool');
    stock(state, { [wire.id]: 4 });
    run(state, { type: 'loadout.set', techniques: ['core:leaf_whirlwind'] });
    run(state, { type: 'pouch.set', slot: 0, item: wire.id });
    const b = analyze(state, marauder, quick);
    expect(b.coverage.find((c) => c.trait === 'evasive')?.by).toEqual([
      { kind: 'item', id: wire.id },
    ]);
  });

  it('hints, for each uncovered known trait, at techniques and tools that exist and can be had', () => {
    const state = bare(4, 24);
    know(state, 'core:marauder');
    know(state, 'core:kiri_hunter');
    for (const target of [marauder, kiri]) {
      const a = analyze(state, target, quick);
      const open = a.coverage.filter((c) => !c.answered);
      expect(open.length).toBeGreaterThan(0);
      expect(a.hints.map((h) => h.trait)).toEqual(open.map((c) => c.trait));
      for (const hint of a.hints) {
        expect(hint.options.length, hint.trait).toBeGreaterThan(0);
        expect(hint.options.length).toBeLessThanOrEqual(K.analysis.hintOptions);
        for (const o of hint.options) {
          if (o.kind === 'technique') {
            const t = content.techniques.find((x) => x.id === o.id);
            expect(t, o.id).toBeDefined();
            expect(state.known[o.id]).toBeUndefined();
            expect([t?.skill, t?.level]).toEqual([o.skill, o.level]);
          } else {
            expect(
              content.items.some((i) => i.id === o.id),
              o.id,
            ).toBe(true);
            if (o.source === 'shop') expect(content.shop.some((s) => s.item === o.id)).toBe(true);
            if (o.source === 'craft') {
              expect(content.recipes.some((r) => r.output.item === o.id)).toBe(true);
            }
          }
        }
        const prices = hint.options.map((o) => o.ryo ?? Infinity);
        expect([...prices].sort((x, y) => x - y)).toEqual(prices);
      }
    }
  });

  it('never names a carrier of a technique that the book does not show', () => {
    const state = bare(5, 24);
    know(state, 'core:marauder');
    for (const level of [0, 2]) {
      const carrier = content.enemies.find((e) => e.carries !== null);
      if (!carrier) throw new Error('no carrier');
      delete state.bingo[carrier.id];
      if (level === 2) know(state, carrier.id);
      const a = analyze(state, marauder, quick);
      for (const h of a.hints) {
        for (const o of h.options) {
          if (o.kind !== 'technique' || o.source !== 'carrier') continue;
          for (const id of o.carriers) {
            expect(state.bingo[id], id).toBeDefined();
          }
        }
      }
    }
  });

  it('leaves the state and every random stream byte for byte as it was, and repeats exactly', () => {
    const state = build(zone(false), 40);
    know(state, 'core:wolfmask');
    const before = serialize(state, 0);
    const rng = JSON.stringify(state.rng);
    const first = analyze(state, zone(false).target, quick);
    const second = analyze(state, zone(false).target, quick);
    expect(serialize(state, 0)).toBe(before);
    expect(JSON.stringify(state.rng)).toBe(rng);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(analyze(state, zone(false).target, { ...quick, seed: 99 }))).not.toBe(
      JSON.stringify(first),
    );
  });

  it('reports xp, ryo, wounds and mastery per hour for a known enemy, and nothing for a target that does not exist', () => {
    const state = build(zone(false), 41);
    know(state, 'core:wolfmask');
    const a = analyze(state, zone(false).target, quick);
    const s = a.session;
    expect(s?.xpPerHour.vit).toBeGreaterThan(0);
    expect(s?.xpPerHour.eva).toBeGreaterThan(0);
    expect(Object.keys(s?.masteryPerHour ?? {}).length).toBeGreaterThan(0);
    expect(s?.ryoPerHour).toBeGreaterThan(0);
    expect(
      analyzeFight(state, { kind: 'zone', id: 'core:nothing' }, {}, content, defaultRules),
    ).toBeNull();
    expect(
      startAnalysis(state, { kind: 'zone', id: 'core:nothing' }, {}, content, defaultRules),
    ).toBeNull();
  });
});

describe('comparing loadouts', () => {
  it('shows a better first fight and better sessions when the second loadout adds the answer to a known trait', () => {
    const state = fighter(6, 16, 'katon');
    know(state, 'core:marauder');
    const bind = content.techniques.find((t) => t.id === 'core:temporary_paralysis');
    if (!bind) throw new Error('no bind');
    state.known[bind.id] = true;
    const attacks = ['core:leaf_whirlwind', 'core:great_fireball', 'core:dynamic_entry'].filter(
      (id) => state.known[id],
    );
    const before = serialize(state, 0);
    const result = compareLoadouts(
      state,
      { kind: 'zone', id: 'core:zone_marauder' },
      attacks,
      [...attacks, bind.id],
      { samples: 200 },
      content,
      defaultRules,
    );
    expect(serialize(state, 0)).toBe(before);
    expect(result?.fresh.winRate).toBeGreaterThan(0);
    expect(result?.b.coverage.find((c) => c.trait === 'evasive')?.answered).toBe(true);
    expect(result?.a.coverage.find((c) => c.trait === 'evasive')?.answered).toBe(false);
    // Every per-hour difference comes from the sessions.
    expect(result?.session).not.toBeNull();
    expect(result?.session?.winsPerHour).toBeGreaterThan(0);
    expect(result && 'winsPerHour' in result).toBe(false);
  });
});

describe('a job that runs in slices', () => {
  const c = boss(46);
  const opts = { samples: 60, minSessions: 3, maxSessions: 3, sessionMinutes: 10 };

  function sliced(n: number): string {
    const state = build(c, 80);
    const job = startAnalysis(state, c.target, opts, content, defaultRules);
    if (!job) throw new Error('no job');
    let last = '';
    const seen: number[] = [];
    for (;;) {
      const { progress, result } = stepAnalysis(job, n, content, defaultRules);
      seen.push(progress.done);
      last = JSON.stringify(result);
      if (progress.finished) break;
      // Between the slices the game may change: the job has its own copy of the state.
      advance(state, 1000, content);
      state.currencies.ryo += 1;
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(analysisProgress(job, content).finished).toBe(true);
    return last;
  }

  it('gives the same result whatever the size of the slices', () => {
    const whole = sliced(Number.MAX_SAFE_INTEGER);
    expect(sliced(1)).toBe(whole);
    expect(sliced(7)).toBe(whole);
    const direct = analyze(build(c, 80), c.target, opts);
    expect(JSON.stringify(direct)).toBe(whole);
  });

  it('is plain JSON that survives being stored between slices', () => {
    const state = build(c, 80);
    const job = startAnalysis(state, c.target, opts, content, defaultRules);
    if (!job) throw new Error('no job');
    stepAnalysis(job, 2, content, defaultRules);
    const stored = JSON.parse(JSON.stringify(job)) as typeof job;
    const a = stepAnalysis(job, Number.MAX_SAFE_INTEGER, content, defaultRules).result;
    const b = stepAnalysis(stored, Number.MAX_SAFE_INTEGER, content, defaultRules).result;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('speed', () => {
  it('finishes an analysis within the budget: a zone under a second, a boss and an operation under five', () => {
    const budget = K.analysis.budgetMs;
    for (const c of [zone(false), boss(46), hideout]) {
      const state = build(c, 50);
      const t0 = performance.now();
      const a = analyze(state, c.target);
      const ms = performance.now() - t0;
      console.log(
        `analysis of ${c.name}: ${ms.toFixed(0)} ms, ${a.session?.runs} sessions (budget ${c.target.kind === 'zone' ? ZONE_BUDGET_MS : budget} ms)`,
      );
      expect(ms).toBeLessThan(c.target.kind === 'zone' ? ZONE_BUDGET_MS : budget);
    }
  });
});
