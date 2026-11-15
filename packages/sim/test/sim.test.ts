import { serialize } from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { academyBot, buildReport, runBench, runBot, type Bot } from '../src/index.ts';

const MINUTE = 60_000;

describe('academy bot', () => {
  it.each([1, 2, 3, 4, 5])('reaches Genin in 45 to 75 game minutes (seed %i)', (seed) => {
    const run = runBot(academyBot, { seed, limitMs: 240 * MINUTE });
    expect(run.ended).toBe('done');
    expect(run.state.player.rank).toBe('genin');
    const genin = run.timeline.find((m) => m.type === 'rank' && m.id === 'genin');
    expect(genin?.at).toBeGreaterThanOrEqual(45 * MINUTE);
    expect(genin?.at).toBeLessThanOrEqual(75 * MINUTE);
    expect(run.kills['core:dummy']).toBeGreaterThanOrEqual(10);
  });

  it('gives identical timelines and final states for the same seed', () => {
    const a = runBot(academyBot, { seed: 3, limitMs: 240 * MINUTE });
    const b = runBot(academyBot, { seed: 3, limitMs: 240 * MINUTE });
    expect(b.timeline).toEqual(a.timeline);
    expect(serialize(b.state, 0)).toBe(serialize(a.state, 0));
    expect(JSON.stringify(buildReport(academyBot, 3, 2, 240 * MINUTE))).toBe(
      JSON.stringify(buildReport(academyBot, 3, 2, 240 * MINUTE)),
    );
  });
});

describe('runner', () => {
  it('stops at the time limit when the bot idles', () => {
    const idle: Bot = {
      name: 'idle',
      description: 'does nothing',
      decide: () => null,
      isDone: () => false,
    };
    const run = runBot(idle, { seed: 1, limitMs: 90_250 });
    expect(run.ended).toBe('limit');
    expect(run.endedAt).toBe(90_250);
    expect(run.timeline).toEqual([]);
  });
});

describe('benchmarks', () => {
  it('advance 12 game hours in under 2000 ms, with practice and with a fight', () => {
    const results = runBench();
    expect(results.map((r) => r.label)).toEqual(['практика', 'бій']);
    for (const r of results) expect(r.ms, r.label).toBeLessThan(2000);
  });
});
