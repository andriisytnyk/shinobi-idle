import { testmodPack } from '@shinobi/core/testmod';
import { createState, type GameState } from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { composeBoot } from '../src/lib/boot.ts';
import {
  assertSaneSave,
  LoadError,
  loadGame,
  saveGame,
  SAVE_KEY,
  type Clock,
  type KeyValue,
} from '../src/lib/persistence.ts';

/*
 * A save made with other packs than the game has now. The web does not second-guess the core
 * loader: it checks the envelope, and the core fills in what a new pack needs and keeps what a
 * missing pack left. The round trip goes through the real persistence path with an in-memory store.
 */

const both = composeBoot([testmodPack]);
const coreOnly = composeBoot();
const SKILL = 'testmod:forge';
const TOKEN = 'testmod:token';

function memoryStore(): KeyValue {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    del: async (key) => void data.delete(key),
    update: async (key, fn) => {
      const next = fn(data.get(key));
      if (next !== undefined) data.set(key, next);
    },
  };
}
const clock: Clock = { now: () => 1_000_000 };

const xp = (state: GameState): number =>
  (state.skills as Record<string, { xp: number } | undefined>)[SKILL]?.xp ?? -1;
const token = (state: GameState): number =>
  (state.currencies as Record<string, number | undefined>)[TOKEN] ?? -1;
const changed = (state: GameState) =>
  state.events.flatMap((e) => (e.type === 'packsChanged' ? [e] : []));

function withMod(): GameState {
  const state = createState(3, both.content);
  state.player.name = 'Тест';
  (state.skills as Record<string, { xp: number }>)[SKILL] = { xp: 7 };
  (state.currencies as Record<string, number>)[TOKEN] = 17;
  state.bank['testmod:pellet'] = 9;
  return state;
}

describe('a save and the packs of the game (item 1)', () => {
  it('survives a round trip through a game without the pack, and the pack data comes back exactly', async () => {
    const kv = memoryStore();
    await saveGame(kv, clock, withMod(), 0);

    // Played without the pack: it loads, the notice says the pack is gone, and saving keeps its data.
    const without = await loadGame(kv, clock, coreOnly.content, coreOnly.rules);
    expect(changed(without.state).map((e) => e.removed)).toEqual([['testmod']]);
    await saveGame(kv, clock, without.state, without.rev);

    // The pack is back: the numbers are exactly as they were, and the notice says it appeared.
    const back = await loadGame(kv, clock, both.content, both.rules);
    expect(xp(back.state)).toBe(7);
    expect(token(back.state)).toBe(17);
    expect(back.state.bank['testmod:pellet']).toBe(9);
    expect(changed(back.state).map((e) => e.added)).toEqual([['testmod']]);
  });

  it('loads a save made without the pack into a game with it: the pack starts from nothing', async () => {
    const kv = memoryStore();
    const plain = createState(3, coreOnly.content);
    plain.player.name = 'Тест';
    await saveGame(kv, clock, plain, 0);
    const loaded = await loadGame(kv, clock, both.content, both.rules);
    expect(xp(loaded.state)).toBe(0);
    expect(changed(loaded.state).map((e) => e.added)).toEqual([['testmod']]);
    // And back again without a complaint.
    await saveGame(kv, clock, loaded.state, loaded.rev);
    const again = await loadGame(kv, clock, coreOnly.content, coreOnly.rules);
    expect(again.state.player.name).toBe('Тест');
  });
});

describe('what the web rejects on its own', () => {
  it('only a text that is not a save: not JSON, or no version or state', async () => {
    expect(() => assertSaneSave('{')).toThrow(LoadError);
    expect(() => assertSaneSave('{"v":1}')).toThrow(LoadError);
    expect(() => assertSaneSave('{"v":1,"state":{}}')).not.toThrow();
    const kv = memoryStore();
    await kv.set(SAVE_KEY, 'not a save');
    const error = await loadGame(kv, clock, coreOnly.content, coreOnly.rules).catch((e) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as LoadError).reason).toBe('notJson');
  });
});
