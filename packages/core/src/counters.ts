import type { GameState } from './state.ts';

/** Counter key for defeats of one enemy. */
export const killsKey = (enemy: string): string => `kills.${enemy}`;

/** Counter key for finished cycles of one action kind. */
export const actionsKey = (kind: string): string => `actions.${kind}`;

/** Current value of a counter; 0 when it was never bumped. */
export function counterValue(state: GameState, key: string): number {
  return state.counters[key] ?? 0;
}

/** Adds `n` (a whole number, 1 by default) to a counter. */
export function bump(state: GameState, key: string, n = 1): void {
  state.counters[key] = counterValue(state, key) + n;
}
