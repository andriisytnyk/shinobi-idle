import type { Analysis, AnalysisProgress } from '@shinobi/core';

/*
 * Runs a battle analysis in slices, so that a forecast never holds the page. A job is a plain-JSON
 * object the core steps `n` units at a time (`stepAnalysis`); between two slices the browser draws.
 * The runner takes the core's functions and the clock as arguments, so a test can drive it with a
 * fake clock and watch every call.
 */

/** The job as the runner needs to know it: nothing but that it can be stepped. */
export interface Job {
  readonly target: { kind: string; id: string };
}

export interface RunnerDeps<J extends Job> {
  /** Starts the job from the state as it is now; null for a target that does not exist. */
  start(): J | null;
  /** Runs `n` units of the job. */
  step(job: J, n: number): { progress: AnalysisProgress; result: Analysis };
  /** The time in ms, for the slice budget. */
  now(): number;
  /** Runs `fn` later, once the browser has had the chance to draw; returns the way to cancel it. */
  later(fn: () => void): () => void;
  /** Called after every slice with how far the job is and what it says so far. */
  onUpdate(progress: AnalysisProgress, result: Analysis | null): void;
  /** Called when the job cannot be started or a step throws. */
  onFail?(error: unknown): void;
}

/** A slice may keep going while less than this much time has passed since it began. */
export const SLICE_MS = 8;

/**
 * Starts the job and steps it one slice at a time: units are run one by one until the slice has
 * used `SLICE_MS`, then the browser gets the thread back. Returns the function that stops it.
 */
export function runAnalysis<J extends Job>(deps: RunnerDeps<J>): () => void {
  let stopped = false;
  let cancel: (() => void) | null = null;
  let job: J | null;
  try {
    job = deps.start();
  } catch (error) {
    deps.onFail?.(error);
    return () => undefined;
  }
  if (!job) {
    deps.onUpdate({ done: 0, total: 0, finished: true }, null);
    return () => undefined;
  }
  const current = job;
  deps.onUpdate({ done: 0, total: 0, finished: false }, null);

  const slice = (): void => {
    cancel = null;
    if (stopped) return;
    const began = deps.now();
    try {
      let out: { progress: AnalysisProgress; result: Analysis };
      do {
        out = deps.step(current, 1);
      } while (!out.progress.finished && deps.now() - began < SLICE_MS);
      deps.onUpdate(out.progress, out.progress.finished ? out.result : null);
      if (!out.progress.finished && !stopped) cancel = deps.later(slice);
    } catch (error) {
      stopped = true;
      deps.onFail?.(error);
    }
  };
  cancel = deps.later(slice);
  return () => {
    stopped = true;
    cancel?.();
  };
}

/**
 * The browser's way to give the page a turn between two slices: a timer as long as a slice, so that the
 * page is idle for about as long as the forecast has just worked. (Not a frame callback: a tab the
 * browser throttles would then run one slice a second.)
 */
export function laterInBrowser(fn: () => void): () => void {
  const timer = setTimeout(fn, SLICE_MS);
  return () => clearTimeout(timer);
}
