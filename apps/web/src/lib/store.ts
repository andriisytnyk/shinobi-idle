import { composeBoot, type Boot } from './boot.ts';
import { createGame, type Game } from './game.svelte.ts';
import { indexedDbStore, wallClock } from './platform.ts';
import { createTabLock } from './tab-lock.ts';

const make = (boot: Boot): Game =>
  createGame({
    content: boot.content,
    rules: boot.rules,
    packs: boot.packs.map((p) => p.manifest),
    clock: wallClock,
    kv: indexedDbStore,
    lock: createTabLock(),
  });

/**
 * The one game of the running app, made from the pack `core` alone. Call `game.start()` once on boot.
 * The dev build replaces it with `bootGame` before the app is mounted, when packs were asked for.
 */
export let game: Game = make(composeBoot());

/** Replaces the game with one made from another set of packs; only before the app is mounted. */
export function bootGame(boot: Boot): Game {
  game = make(boot);
  return game;
}
