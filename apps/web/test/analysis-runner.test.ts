import { content } from '@shinobi/content';
import {
  analyzeFight,
  createState,
  defaultRules,
  startAnalysis,
  stepAnalysis,
  xpAt,
  type Analysis,
  type AnalysisJob,
  type AnalysisProgress,
} from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { runAnalysis, SLICE_MS } from '../src/lib/analysis-runner.ts';

/** A genin who can fight the training dummy, and the target to forecast. */
function player() {
  const state = createState(5, content);
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(15);
  }
  return state;
}
const TARGET = { kind: 'zone', id: 'core:zone_dummy' } as const;

/** A fake clock and scheduler: `later` queues the next slice, nothing runs until the test says so. */
function harness(cost: number) {
  let clock = 0;
  const queue: (() => void)[] = [];
  const calls: { n: number; at: number }[] = [];
  const updates: { progress: AnalysisProgress; result: Analysis | null }[] = [];
  const state = player();
  const stop = runAnalysis<AnalysisJob>({
    start: () => startAnalysis(state, TARGET, {}, content, defaultRules),
    step: (job, n) => {
      calls.push({ n, at: clock });
      // Every unit of the forecast takes `cost` ms on the fake clock.
      clock += cost * n;
      return stepAnalysis(job, n, content, defaultRules);
    },
    now: () => clock,
    later: (fn) => {
      queue.push(fn);
      return () => {
        const at = queue.indexOf(fn);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    onUpdate: (progress, result) => updates.push({ progress, result }),
  });
  /** Runs every queued slice until the job is done; returns how many slices that took. */
  const drain = (): number => {
    let slices = 0;
    while (queue.length > 0) {
      queue.shift()?.();
      slices++;
      expect(slices).toBeLessThan(10_000);
    }
    return slices;
  };
  return { stop, drain, calls, updates, queue, now: () => clock };
}

describe('F1: the forecast runs in slices', () => {
  it('starts nothing until the browser has had a turn, and never steps more than one unit at a call', () => {
    const h = harness(1);
    expect(h.calls).toEqual([]);
    expect(h.queue).toHaveLength(1);
    h.drain();
    expect(h.calls.length).toBeGreaterThan(5);
    expect(h.calls.every((c) => c.n === 1)).toBe(true);
  });

  it('gives the thread back once a slice has used its budget', () => {
    // A unit that costs more than the whole slice: one unit per slice.
    const slow = harness(SLICE_MS * 2);
    const slices = slow.drain();
    expect(slices).toBe(slow.calls.length);
    // A cheap unit: several units fit in a slice, but a slice never runs past its budget by more than one unit.
    const cheap = harness(1);
    const cheapSlices = cheap.drain();
    expect(cheapSlices).toBeLessThan(cheap.calls.length);
    const perSlice: number[] = [];
    let begin = -1;
    for (const c of cheap.calls) {
      if (c.at - begin >= SLICE_MS || begin < 0) {
        perSlice.push(0);
        begin = c.at;
      }
      perSlice[perSlice.length - 1]!++;
    }
    expect(Math.max(...perSlice)).toBeLessThanOrEqual(SLICE_MS + 1);
  });

  it('reports progress on the way and the result at the end, the same whatever the slices', () => {
    const h = harness(3);
    h.drain();
    const last = h.updates.at(-1);
    expect(last?.progress.finished).toBe(true);
    expect(last?.result?.session?.verdict).toBeDefined();
    const mid = h.updates.filter((u) => !u.progress.finished);
    expect(mid.length).toBeGreaterThan(1);
    expect(mid.every((u) => u.result === null)).toBe(true);
    const whole = analyzeFight(player(), TARGET, {}, content, defaultRules);
    expect(last?.result?.session?.verdict).toBe(whole?.session?.verdict);
    expect(last?.result?.fresh.winRate).toBe(whole?.fresh.winRate);
  });

  it('stops when told to: nothing runs after the stop', () => {
    const h = harness(1);
    h.queue.shift()?.();
    const before = h.calls.length;
    h.stop();
    h.drain();
    expect(h.calls.length).toBe(before);
  });

  it('says so for a target that does not exist', () => {
    const updates: AnalysisProgress[] = [];
    runAnalysis<AnalysisJob>({
      start: () =>
        startAnalysis(player(), { kind: 'zone', id: 'core:nothing' }, {}, content, defaultRules),
      step: () => {
        throw new Error('must not step');
      },
      now: () => 0,
      later: () => () => undefined,
      onUpdate: (p) => updates.push(p),
    });
    expect(updates.at(-1)?.finished).toBe(true);
  });
});
