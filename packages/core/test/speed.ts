/**
 * Wall-clock budgets for speed tests, scaled to the machine that runs them.
 *
 * An absolute number of milliseconds fails on a slow CI runner or under parallel load without any
 * regression in the code. So a budget is stated for the reference machine and stretched by how much
 * slower a fixed arithmetic workload runs here and now, up to a hard cap that is the real product
 * requirement.
 *
 * Speed tests are declared with `speedIt` and run apart from the rest: `pnpm test:speed` (one worker,
 * `--mode speed`, selected by the `@speed` tag). In a normal `pnpm test` they are skipped, because
 * the other test files share the CPUs and the timing would be noise.
 */
import { it } from 'vitest';

/** True in `pnpm test:speed` (`vitest --mode speed`). */
export const speedMode: boolean =
  (import.meta as { env?: { MODE?: string } }).env?.MODE === 'speed';

/** A wall-clock test: runs only in speed mode; the `@speed` tag is what `test:speed` selects. */
export const speedIt = (name: string, fn: () => void): void => {
  (speedMode ? it : it.skip)(`${name} @speed`, { timeout: 300_000 }, fn);
};

/** What the workload below takes on the machine the budgets were set on, ms. */
const REFERENCE_MS = 18;

function workload(): number {
  let a = 1;
  let sum = 0;
  for (let i = 0; i < 20_000_000; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    sum = (sum + (a & 1023)) | 0;
  }
  return sum;
}

function ms(fn: () => void): number {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

/** How many times slower than the reference machine this one is right now; never below 1. */
export function machineFactor(): number {
  let best = Infinity;
  for (let run = 0; run < 5; run++) best = Math.min(best, ms(workload));
  return Math.max(1, best / REFERENCE_MS);
}

/** The budget for here and now: `referenceMs` stretched by the machine factor, at most `capMs`. */
export function speedBudget(referenceMs: number, capMs: number): number {
  return Math.min(capMs, referenceMs * machineFactor());
}

/** The fastest of up to `runs` runs of `fn`, stopping early once one is inside the budget. */
export function bestOf(runs: number, budgetMs: number, fn: () => void): number {
  let best = Infinity;
  for (let run = 0; run < runs && best >= budgetMs; run++) best = Math.min(best, ms(fn));
  return best;
}
