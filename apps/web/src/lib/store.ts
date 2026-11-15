import { createGame } from './game.svelte.ts';
import { indexedDbStore, wallClock } from './platform.ts';

/** The one game of the running app. Call `game.start()` once on boot. */
export const game = createGame({ clock: wallClock, kv: indexedDbStore });
