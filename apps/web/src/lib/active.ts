import type { ContentDb } from '@shinobi/content';
import type { GameState } from '@shinobi/core';

/*
 * The content of the running game, for the few modules that are loaded before the game store exists
 * (the translator, the route parser, the toast mapper) and so cannot import it. `createGame` installs
 * the content it was made with; everything else in the app reads `game.content`.
 */

let current: ContentDb | null = null;

/** Called by `createGame`: the content of the game that is running now. */
export function setActiveContent(db: ContentDb): void {
  current = db;
}

let currentState: (() => GameState) | null = null;

/** Called by `createGame`: reads the state of the game that is running now (for the helpers that name things by what the player knows). */
export function setActiveState(read: (() => GameState) | null): void {
  currentState = read;
}

/** The state of the running game, or null before any game was made. */
export const tryActiveState = (): GameState | null => currentState?.() ?? null;

/** The content of the running game, or null before any game was made. */
export const tryActiveContent = (): ContentDb | null => current;

/** The content of the running game. */
export function activeContent(): ContentDb {
  if (!current) throw new Error('No game is running: the content is not installed yet');
  return current;
}
