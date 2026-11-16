import type { GameState } from './state.ts';

/**
 * The one place that writes `state.shown`, the set of entities the reveal rule counts as seen. The
 * command `reveal.mark` writes through it, validated against the rule, and so does the bank when an
 * item is gained: what the player has held stays shown after the last unit is used up. The set
 * never grows past `limit` (the entities of the content for the command; a fixed ceiling for the
 * bank, which has no content at hand and only ever sees ids of items).
 */
export function addShown(state: GameState, id: string, limit: number): boolean {
  if (state.shown[id] === true) return true;
  if (Object.keys(state.shown).length >= limit) return false;
  state.shown[id] = true;
  return true;
}

/** Ceiling for writes that do not know the content: far above the number of items any pack adds. */
export const SHOWN_CEILING = 4000;
