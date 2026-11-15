// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createProgressDriver,
  RESYNC_THRESHOLD,
  type ProgressEnv,
  type ProgressTiming,
} from '../src/lib/time-progress.ts';

/** A stubbed animation clock: animations read `clock.now`, tests move it. */
function rig(env: Partial<ProgressEnv> = {}) {
  const clock = { now: 0 };
  interface Fake {
    start: number;
    from: number;
    duration: number;
    cancelled: boolean;
    finished: boolean;
    onfinish: (() => void) | null;
  }
  const all: Fake[] = [];
  const node = document.createElement('div') as HTMLElement;
  (node as unknown as { animate: unknown }).animate = (
    frames: Record<string, string>[],
    opts: { duration: number },
  ) => {
    const fake: Fake = {
      start: clock.now,
      from: Number(frames[0]?.['--tp']),
      duration: opts.duration,
      cancelled: false,
      finished: false,
      onfinish: null,
    };
    all.push(fake);
    return {
      get currentTime() {
        return clock.now - fake.start;
      },
      get onfinish() {
        return fake.onfinish;
      },
      set onfinish(fn: (() => void) | null) {
        fake.onfinish = fn;
      },
      finished: Promise.resolve(),
      cancel() {
        fake.cancelled = true;
      },
    };
  };
  const driver = createProgressDriver(node, {
    reducedMotion: () => false,
    hidden: () => false,
    onVisibility: () => () => undefined,
    ...env,
  });
  /** The fraction the screen shows now: the live animation's position, or the static value. */
  const shown = (): number => {
    const live = [...all].reverse().find((a) => !a.cancelled);
    if (!live) return Number(node.style.getPropertyValue('--tp'));
    return Math.min(1, live.from + (1 - live.from) * ((clock.now - live.start) / live.duration));
  };
  /** Moves the clock by `ms`, firing the end of every animation that reaches its end. */
  const tick = (ms: number): void => {
    clock.now += ms;
    for (const a of all) {
      if (!a.cancelled && !a.finished && clock.now - a.start >= a.duration) {
        a.finished = true;
        a.onfinish?.();
      }
    }
  };
  return { clock, node, driver, shown, tick, all };
}

const FRAME = 1000 / 60;

/** Runs the primitive like the app: a store update every 100 ms, a sample every frame. */
function simulate(
  r: ReturnType<typeof rig>,
  cycleMs: number,
  totalMs: number,
  timingAt: (elapsed: number) => ProgressTiming,
) {
  const samples: number[] = [];
  let next = 0;
  for (let t = 0; t <= totalMs; t += FRAME) {
    while (next <= t) {
      r.driver.update(timingAt(next));
      next += 100;
    }
    r.tick(FRAME);
    samples.push(r.shown());
  }
  void cycleMs;
  return samples;
}

const maxStep = (samples: number[]): number => {
  let worst = 0;
  for (let i = 1; i < samples.length; i++) {
    worst = Math.max(worst, Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0)));
  }
  return worst;
};

describe('time progress primitive', () => {
  it('moves smoothly at frame rate over a 3 s action', () => {
    const r = rig();
    const cycle = 3000;
    const samples = simulate(r, cycle, cycle - 100, (e) => ({
      fraction: e / cycle,
      cycleMs: cycle,
      running: true,
    }));
    expect(maxStep(samples)).toBeLessThanOrEqual(FRAME / cycle + 0.01);
    // A smooth run, not the ten steps of the store.
    expect(new Set(samples.map((s) => s.toFixed(4))).size).toBeGreaterThan(100);
  });

  it('starts the next cycle at 0 after a completion, and stays smooth over a hundred repeats', () => {
    const r = rig();
    const cycle = 3000;
    const samples = simulate(r, cycle, cycle * 100, (e) => ({
      fraction: (e % cycle) / cycle,
      cycleMs: cycle,
      running: true,
    }));
    // Every drop is a restart from near 0; nothing sweeps backwards and nothing drifts.
    let wraps = 0;
    for (let i = 1; i < samples.length; i++) {
      const d = (samples[i] ?? 0) - (samples[i - 1] ?? 0);
      if (d < 0) {
        wraps++;
        expect(samples[i]).toBeLessThan(0.06);
      } else {
        expect(d).toBeLessThanOrEqual(FRAME / cycle + 0.01);
      }
    }
    expect(wraps).toBeGreaterThanOrEqual(99);
    expect(wraps).toBeLessThanOrEqual(101);
    // The error against the truth stays within the threshold at the end.
    const last = (cycle * 100 - FRAME) % cycle;
    const gap = Math.abs((samples.at(-1) ?? 0) - last / cycle);
    expect(Math.min(gap, 1 - gap)).toBeLessThan(0.07);
  });

  it('re-syncs on a change of speed without a jump larger than the threshold', () => {
    const r = rig();
    const before = simulate(r, 3000, 1500, (e) => ({
      fraction: e / 3000,
      cycleMs: 3000,
      running: true,
    }));
    const at = before.at(-1) ?? 0;
    // Half the speed: the cycle takes twice as long, the fraction so far is the same.
    r.driver.update({ fraction: at, cycleMs: 6000, running: true });
    expect(Math.abs(r.shown() - at)).toBeLessThanOrEqual(RESYNC_THRESHOLD);
    r.tick(600);
    // 600 ms of a 6000 ms cycle is 10% of it.
    expect(r.shown() - at).toBeCloseTo(0.1, 2);
  });

  it('freezes when the action stops', () => {
    const r = rig();
    r.driver.update({ fraction: 0.4, cycleMs: 3000, running: true });
    r.tick(300);
    r.driver.update({ fraction: 0.5, cycleMs: 3000, running: false });
    const frozen = r.shown();
    r.tick(1000);
    expect(r.shown()).toBe(frozen);
    expect(frozen).toBeCloseTo(0.5, 5);
  });

  it('steps instead of moving when reduced motion is asked for', () => {
    const r = rig({ reducedMotion: () => true });
    r.driver.update({ fraction: 0.2, cycleMs: 3000, running: true });
    expect(r.all).toHaveLength(0);
    r.tick(500);
    expect(r.shown()).toBeCloseTo(0.2, 5);
    r.driver.update({ fraction: 0.3, cycleMs: 3000, running: true });
    expect(r.shown()).toBeCloseTo(0.3, 5);
  });

  it('does not run in a hidden tab', () => {
    const r = rig({ hidden: () => true });
    r.driver.update({ fraction: 0.2, cycleMs: 3000, running: true });
    expect(r.all).toHaveLength(0);
  });
});
