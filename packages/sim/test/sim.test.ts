import { content } from '@shinobi/content';
import { createState, defaultRules, serialize, xpAt, type Rules } from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import {
  academyBot,
  buildReport,
  clonesBot,
  runBench,
  runBot,
  runCli,
  type Bot,
  type BotContext,
} from '../src/index.ts';

const MINUTE = 60_000;

const idleBot = (patch: Partial<Bot> = {}): Bot => ({
  name: 'test',
  description: 'test bot',
  goal: { label: 'ніколи', reached: () => false },
  decide: () => null,
  ...patch,
});

describe('academy bot', () => {
  it.each([1, 2, 3, 4, 5])('reaches Genin in 45 to 75 game minutes (seed %i)', (seed) => {
    const run = runBot(academyBot, { seed, limitMs: 240 * MINUTE });
    expect(run.ended).toBe('done');
    expect(run.state.player.rank).toBe('genin');
    expect(run.goalAt).toBeGreaterThanOrEqual(45 * MINUTE);
    expect(run.goalAt).toBeLessThanOrEqual(75 * MINUTE);
    expect(run.rejected).toBe(0);
    expect(run.kills['core:dummy']).toBeGreaterThanOrEqual(10);
  });

  it('gives identical timelines and final states for the same seed', () => {
    const a = runBot(academyBot, { seed: 3, limitMs: 240 * MINUTE });
    const b = runBot(academyBot, { seed: 3, limitMs: 240 * MINUTE });
    expect(b.timeline).toEqual(a.timeline);
    expect(serialize(b.state, 0)).toBe(serialize(a.state, 0));
    const options = { seed: 3, runs: 2, limitMs: 240 * MINUTE };
    expect(JSON.stringify(buildReport(academyBot, options))).toBe(
      JSON.stringify(buildReport(academyBot, options)),
    );
  });

  it('decides with the rules the run uses, not the defaults', () => {
    // Without the drill kind the selectors list no Chakra Control action, so the bot has nothing
    // to start for it; with default rules it would try, and the game would refuse.
    const { drill: _drill, ...kinds } = defaultRules.actionKinds;
    const rules: Rules = { ...defaultRules, actionKinds: kinds };
    const run = runBot(academyBot, { seed: 1, rules, limitMs: 40 * MINUTE });
    expect(run.ended).toBe('limit');
    expect(run.rejected).toBe(0);
    expect(run.xp['cc']).toBeUndefined();
    expect(run.xp['tai']).toBeGreaterThan(0);
  });

  it('starts from a provided mid-game state without touching it', () => {
    const start = createState(7, content);
    start.skills.tai!.xp = xpAt(5);
    start.skills.ath!.xp = xpAt(5);
    const before = serialize(start, 0);
    const run = runBot(academyBot, { seed: 7, initialState: start, limitMs: 240 * MINUTE });
    expect(serialize(start, 0)).toBe(before);
    expect(run.ended).toBe('done');
    const fresh = runBot(academyBot, { seed: 7, limitMs: 240 * MINUTE });
    expect(run.goalAt ?? Infinity).toBeLessThan(fresh.goalAt ?? 0);
    // Levels the run started with are not counted as XP it gained.
    expect(run.xp['tai'] ?? 0).toBeLessThan(fresh.xp['tai'] ?? 0);
    expect(run.timeline.some((m) => m.type === 'skill' && m.id === 'tai' && m.level === 5)).toBe(
      false,
    );
  });
});

describe('runner', () => {
  it('stops at the time limit when the bot idles', () => {
    const run = runBot(idleBot(), { seed: 1, limitMs: 90_250 });
    expect(run.ended).toBe('limit');
    expect(run.endedAt).toBe(90_250);
    expect(run.goalAt).toBeNull();
    expect(run.timeline).toEqual([]);
  });

  it('hands the bot its state, content and the rules of the run', () => {
    const seen: BotContext[] = [];
    const rules: Rules = { ...defaultRules };
    runBot(idleBot({ decide: (ctx) => (seen.push(ctx), null) }), {
      seed: 1,
      rules,
      limitMs: 2000,
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((ctx) => ctx.rules === rules && ctx.content === content)).toBe(true);
  });

  it('fails a run whose bot keeps sending commands the game refuses', () => {
    const bad = idleBot({
      decide: () => [{ type: 'action.start', slot: 0, kind: 'practice', id: 'core:nope' }],
    });
    const run = runBot(bad, { seed: 1, limitMs: 60 * MINUTE, rejectLimit: 20 });
    expect(run.ended).toBe('failed');
    expect(run.rejected).toBe(21);
    expect(run.firstRejection).toBe('error.unknownAction');
    expect(run.endedAt).toBeLessThan(60 * MINUTE);
  });

  it('keeps every milestone however many events a step produces', () => {
    // A 4 h step over fast training emits far more than the core's 200-event cap.
    const run = runBot(academyBot, { seed: 1, limitMs: 240 * MINUTE, stepMs: 240 * MINUTE });
    const levels = run.timeline.filter((m) => m.type === 'skill' && m.id === 'tai');
    expect(levels.length).toBeGreaterThanOrEqual(2);
  });
});

describe('CLI', () => {
  it('lists the bots without arguments', () => {
    const result = runCli([]);
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('academy');
  });

  it('prints the Genin time and timeline for the academy bot', () => {
    const result = runCli(['academy', '--seed', '1', '--runs', '2']);
    expect(result.code).toBe(0);
    const text = result.out.join('\n');
    expect(text).toContain('Час до цілі «Генін»');
    expect(text).toContain('Ранг: Генін');
    const json = JSON.parse(runCli(['academy', '--json']).out.join('\n')) as { goal: string };
    expect(json.goal).toBe('Генін');
  });

  it('exits non-zero for an unknown bot, bad options and a failing bot', () => {
    expect(runCli(['nope']).code).toBe(1);
    expect(runCli(['academy', '--runs', '0']).code).toBe(1);
    expect(runCli(['academy', '--seed', 'x']).code).toBe(1);
    const bad = idleBot({
      name: 'bad',
      decide: () => [{ type: 'action.stop', slot: 0 }],
    });
    const result = runCli(['bad'], { bad });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('error.noAction');
  });
});

/**
 * How much slower than the machine the budget was set on this one runs right now: the same fixed
 * workload and reference as `packages/core/test/speed.ts`, so a loaded CI runner gets a larger
 * budget, up to a hard cap that still catches a real slowdown.
 */
function machineFactor(): number {
  const REFERENCE_MS = 18;
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    let a = 1;
    let sum = 0;
    for (let i = 0; i < 20_000_000; i++) {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      sum = (sum + (a & 1023)) | 0;
    }
    if (sum === 42) best = 0; // keeps the loop from being optimised away
    best = Math.min(best, performance.now() - start);
  }
  return Math.max(1, best / REFERENCE_MS);
}

describe('benchmarks', () => {
  it('advance 12 game hours within the budget (2000 ms on the reference machine), with practice and with a fight', () => {
    const budget = Math.min(6000, 2000 * machineFactor());
    const results = runBench();
    expect(results.map((r) => r.label)).toEqual(['практика', 'бій']);
    for (const r of results) {
      expect(r.ms, `${r.label}, budget ${Math.round(budget)} ms`).toBeLessThan(budget);
      // The activity really ran: thousands of cycles, never ended early.
      expect(r.cycles, r.label).toBeGreaterThan(1000);
      expect(r.restarts, r.label).toBe(0);
    }
  });
});

describe('clones bot', () => {
  it.each([1, 2])('opens the clone technique within 5 to 8 game hours (seed %i)', (seed) => {
    const run = runBot(clonesBot, { seed, limitMs: 14 * 60 * MINUTE });
    expect(run.ended).toBe('done');
    expect(run.goalAt).toBeGreaterThanOrEqual(5 * 60 * MINUTE);
    expect(run.goalAt).toBeLessThanOrEqual(8 * 60 * MINUTE);
    expect(run.rejected).toBe(0);
    expect(run.state.slots.length).toBe(2);
    expect(run.actions['mission']).toBeGreaterThanOrEqual(10);
  });
});
