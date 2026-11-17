import type { GameState } from './state.ts';

/** Counter key for defeats of one enemy. */
export const killsKey = (enemy: string): string => `kills.${enemy}`;

/** Counter key for the times an enemy defeated the player. */
export const defeatsKey = (enemy: string): string => `defeats.${enemy}`;

/** Counter key for finished cycles of one action kind. */
export const actionsKey = (kind: string): string => `actions.${kind}`;

/** Counter of the natures the player has taken, the native one included: what a chain that asks for another nature counts. */
export const NATURES_GAINED = 'natures.gained';

/**
 * Current value of a counter; 0 when it was never bumped. The natures counter never reads below
 * the natures the character has, so a save from before the counter existed needs no migration.
 */
export function counterValue(state: GameState, key: string): number {
  const stored = state.counters[key] ?? 0;
  return key === NATURES_GAINED ? Math.max(stored, state.player.natures.length) : stored;
}

/** Adds `n` (a whole number, 1 by default) to a counter. */
export function bump(state: GameState, key: string, n = 1): void {
  state.counters[key] = (state.counters[key] ?? 0) + n;
}
