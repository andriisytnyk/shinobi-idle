import { content } from '@shinobi/content';
import { listSkillActions, serialize, xpAt } from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import { createGame, SLEEP_GAP_MS } from '../src/lib/game.svelte.ts';
import { SAVE_KEY, type KeyValue } from '../src/lib/persistence.ts';
import type { ToastSpec } from '../src/lib/toasts.svelte.ts';

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function setup() {
  const data = new Map<string, string>();
  const kv: KeyValue = {
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    del: async (key) => void data.delete(key),
  };
  let now = T0;
  const clock = { now: () => now };
  const pushed: ToastSpec[] = [];
  const game = createGame({ clock, kv, toasts: { push: (spec) => void pushed.push(spec) } });
  return { game, data, pushed, advance: (ms: number) => (now += ms), clock };
}

function startTai(game: ReturnType<typeof setup>['game']) {
  game.state.player.rank = 'genin';
  const info = listSkillActions(game.state, 'tai', content)[0];
  if (!info) throw new Error('no tai action');
  expect(game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id }).ok).toBe(
    true,
  );
  return info;
}

describe('game store', () => {
  it('moves the game by the real time that passed, a tick at a time', () => {
    const { game, advance } = setup();
    startTai(game);
    const before = game.state.now;
    const version = game.version;
    advance(100);
    game.tick();
    expect(game.state.now).toBe(before + 100);
    expect(game.version).toBeGreaterThan(version);
  });

  it('does nothing when no time has passed', () => {
    const { game } = setup();
    const version = game.version;
    game.tick();
    expect(game.version).toBe(version);
  });

  it('turns level-ups into toasts and empties the event queue', () => {
    const { game, advance, pushed } = setup();
    startTai(game);
    game.state.skills.tai.xp = xpAt(2) - 1;
    for (let i = 0; i < 400; i++) {
      advance(100);
      game.tick();
    }
    expect(pushed.some((t) => t.key === 'toast.levelUp' && t.ref?.id === 'tai')).toBe(true);
    expect(game.state.events).toEqual([]);
  });

  it('catches up through the offline path after a sleep and reports it', () => {
    const { game, advance } = setup();
    const info = startTai(game);
    const xp = game.state.skills.tai.xp;
    advance(2 * HOUR);
    game.tick();
    expect(game.state.skills.tai.xp).toBeGreaterThan(xp);
    expect(game.state.now).toBeGreaterThanOrEqual(2 * HOUR);
    expect(game.report?.skills.some((s) => s.skill === 'tai')).toBe(true);
    expect(game.report?.mastery.some((m) => m.key === info.id)).toBe(true);
    game.dismissReport();
    expect(game.report).toBeNull();
  });

  it('applies a short gap silently', () => {
    const { game, advance } = setup();
    startTai(game);
    advance(SLEEP_GAP_MS - 1);
    game.tick();
    expect(game.report).toBeNull();
  });

  it('saves the state under the save key', async () => {
    const { game, data } = setup();
    startTai(game);
    await game.save();
    expect(data.get(SAVE_KEY)).toBe(serialize(game.state, T0));
    expect(game.saveStatus).toBe('saved');
  });

  it('A4: export, reset, import gives back the same serialized state', async () => {
    const { game, advance } = setup();
    startTai(game);
    advance(10 * 60_000);
    game.tick();
    const before = serialize(game.state, T0);
    const text = game.exportText();
    await game.reset();
    expect(serialize(game.state, T0)).not.toBe(before);
    await game.importText(text);
    expect(serialize(game.state, T0)).toBe(before);
  });

  it('refuses to import text that is not a save and keeps the game', async () => {
    const { game } = setup();
    const before = serialize(game.state, T0);
    await expect(game.importText('bm90IGEgc2F2ZQ==')).rejects.toThrow();
    expect(serialize(game.state, T0)).toBe(before);
  });
});
