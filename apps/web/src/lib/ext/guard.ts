/** How many failures in a row disable a callback of a pack. */
export const FAILURE_LIMIT = 3;

export interface Guard {
  /**
   * Calls something a pack supplied (a hook, a predicate, an href builder, an observer mount).
   * A failure is caught and costs one warning; the callback is called again next time, and is
   * disabled after `FAILURE_LIMIT` failures in a row. While disabled it is not called and `fallback` stands in.
   */
  call<T>(owner: string, phase: string, fn: () => T, fallback: T): T;
  /** Reports a failure of something that runs once (a mount, a cleanup): one warning per owner and phase. */
  warn(owner: string, phase: string, error: unknown): void;
  /** Whether the callback is disabled. */
  disabled(owner: string, phase: string): boolean;
}

interface State {
  failures: number;
  off: boolean;
}

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One guard per boot of the app. Everything a pack supplies goes through it. */
export function createGuard(limit = FAILURE_LIMIT): Guard {
  const states = new Map<string, State>();
  const warned = new Set<string>();
  const stateOf = (key: string): State => {
    let s = states.get(key);
    if (!s) states.set(key, (s = { failures: 0, off: false }));
    return s;
  };
  return {
    call(owner, phase, fn, fallback) {
      const key = `${owner}\u0000${phase}`;
      const state = stateOf(key);
      if (state.off) return fallback;
      try {
        const out = fn();
        state.failures = 0;
        return out;
      } catch (error) {
        state.failures++;
        if (state.failures === 1) {
          console.warn(
            `[ui] "${owner}" failed in ${phase}: ${text(error)}. It is called again next time and disabled after ${limit} failures in a row.`,
            error,
          );
        }
        if (state.failures >= limit) {
          state.off = true;
          console.warn(`[ui] "${owner}" is disabled in ${phase} after ${limit} failures in a row.`);
        }
        return fallback;
      }
    },
    warn(owner, phase, error) {
      const key = `${owner}\u0000${phase}`;
      if (warned.has(key)) return;
      warned.add(key);
      console.warn(`[ui] "${owner}" failed in ${phase}: ${text(error)}`, error);
    },
    disabled: (owner, phase) => states.get(`${owner}\u0000${phase}`)?.off === true,
  };
}
