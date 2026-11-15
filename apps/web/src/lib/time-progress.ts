/**
 * The shared primitive of every time-progress visual (bars, the seal strip, the emblem flash).
 *
 * The store updates about ten times a second, which is too coarse to look smooth. On each update
 * the primitive is told the true fraction of the running cycle and how long the whole cycle takes
 * at the present speed. It then runs one linear Web Animation of the custom property `--tp`
 * (a registered number, 0..1) from the true fraction to 1 over the real time left, so the
 * browser moves the visual at display refresh rate without any per-frame JavaScript. Visuals read
 * `var(--tp)`; children inherit it, so one animation can drive a whole strip.
 *
 * A running animation is kept while its prediction agrees with the next update. It is restarted
 * when the prediction and the truth differ by more than `RESYNC_THRESHOLD` of a cycle, or when
 * the time left changed (a speed change). When an animation reaches 1 and the action repeats,
 * the next cycle is started from 0 at once (`onfinish`), so there is neither a backward sweep nor
 * a bar parked at full while waiting for the next update.
 */

/** Largest disagreement, as a fraction of a cycle, between the prediction and the truth before a re-sync. */
export const RESYNC_THRESHOLD = 0.01;

/** The custom property the primitive animates. */
export const PROGRESS_PROP = '--tp';

export interface ProgressTiming {
  /** The true fraction of the current cycle, 0..1. */
  fraction: number;
  /** Real milliseconds the whole cycle takes at the present speed (slot share and speed modifiers included). */
  cycleMs: number;
  /** Whether the action is running; when it is not, the visual freezes at `fraction`. */
  running: boolean;
  /** Whether the cycle starts again by itself when it ends. Defaults to true. */
  repeat?: boolean;
}

/** What the primitive needs from the browser; tests pass their own. */
export interface ProgressEnv {
  /** Whether `prefers-reduced-motion` asks for steps instead of motion. */
  reducedMotion(): boolean;
  /** Whether the tab is hidden. */
  hidden(): boolean;
  /** Called when the tab becomes hidden or visible again. Returns the remover. */
  onVisibility(fn: () => void): () => void;
}

export const browserEnv: ProgressEnv = {
  reducedMotion: () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onVisibility(fn) {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
};

let registered = false;

/** Registers `--tp` as an animatable number once; harmless where it is unsupported or already done. */
function registerProperty(): void {
  if (registered) return;
  registered = true;
  try {
    CSS.registerProperty({
      name: PROGRESS_PROP,
      syntax: '<number>',
      inherits: true,
      initialValue: '0',
    });
  } catch {
    // Unsupported (the visual then steps with the store) or already registered.
  }
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const timeOf = (anim: Animation): number => {
  const t = anim.currentTime;
  return typeof t === 'number' ? t : 0;
};

/** The driver of one element. `update` is called with each new timing; `destroy` releases everything. */
export function createProgressDriver(
  node: HTMLElement | SVGElement,
  env: ProgressEnv = browserEnv,
) {
  registerProperty();
  let anim: Animation | null = null;
  /** Fraction the running animation started from, and its length: its prediction at time t. */
  let from = 0;
  let length = 0;
  let last: ProgressTiming | null = null;
  let paused = false;

  const setStatic = (fraction: number): void => {
    node.style.setProperty(PROGRESS_PROP, String(clamp01(fraction)));
    node.dataset.fraction = clamp01(fraction).toFixed(3);
  };

  const cancel = (): void => {
    if (!anim) return;
    anim.onfinish = null;
    anim.cancel();
    anim = null;
  };

  /** Where the running animation says the visual is now. */
  const predicted = (): number | null => {
    if (!anim || length <= 0) return null;
    return clamp01(from + (1 - from) * (timeOf(anim) / length));
  };

  const run = (start: number, ms: number, repeat: boolean, cycleMs: number): void => {
    cancel();
    from = clamp01(start);
    length = Math.max(1, ms);
    setStatic(from);
    if (typeof node.animate !== 'function') return;
    const a = node.animate([{ [PROGRESS_PROP]: String(from) }, { [PROGRESS_PROP]: '1' }], {
      duration: length,
      easing: 'linear',
      fill: 'forwards',
    });
    anim = a;
    // A cancelled animation rejects `finished`; nobody waits for it.
    a.finished?.catch(() => undefined);
    a.onfinish = () => {
      if (anim !== a) return;
      // The cycle ended before the store said so: when it repeats, start the next one from 0.
      if (repeat && cycleMs > 0 && !paused) run(0, cycleMs, repeat, cycleMs);
    };
  };

  function update(timing: ProgressTiming): void {
    last = timing;
    const fraction = clamp01(timing.fraction);
    const frozen = !timing.running || timing.cycleMs <= 0 || env.reducedMotion() || env.hidden();
    if (frozen) {
      cancel();
      setStatic(fraction);
      return;
    }
    paused = false;
    const left = (1 - fraction) * timing.cycleMs;
    const guess = predicted();
    if (anim && guess !== null) {
      const leftGuess = Math.max(0, length - timeOf(anim));
      const wrapped = fraction < guess - 0.5;
      const ok =
        !wrapped &&
        Math.abs(guess - fraction) <= RESYNC_THRESHOLD &&
        Math.abs(leftGuess - left) <= RESYNC_THRESHOLD * timing.cycleMs + 20;
      if (ok) {
        node.dataset.fraction = fraction.toFixed(3);
        return;
      }
    }
    run(fraction, left, timing.repeat !== false, timing.cycleMs);
  }

  // A hidden tab stops the visual; the next update (after the offline catch-up) restarts it.
  const stopListening = env.onVisibility(() => {
    if (env.hidden()) {
      paused = true;
      cancel();
      if (last) setStatic(last.fraction);
    }
  });

  return {
    update,
    destroy(): void {
      stopListening();
      cancel();
    },
  };
}

/** Svelte action: `use:timeProgress={timing}`. */
export function timeProgress(node: HTMLElement | SVGElement, timing: ProgressTiming) {
  const driver = createProgressDriver(node);
  driver.update(timing);
  return { update: driver.update, destroy: driver.destroy };
}
