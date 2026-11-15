import type { ContentDb } from '@shinobi/content';

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

/** The content of the running game, or null before any game was made. */
export const tryActiveContent = (): ContentDb | null => current;

/** The content of the running game. */
export function activeContent(): ContentDb {
  if (!current) throw new Error('No game is running: the content is not installed yet');
  return current;
}
