import { content } from '@shinobi/content';
import { listSkillActions, serialize, xpAt } from '@shinobi/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabLock } from '../src/lib/tab-lock.ts';
import { createGame, SLEEP_GAP_MS } from '../src/lib/game.svelte.ts';
import {
  BROKEN_SAVE_KEY,
  SAVE_KEY,
  decodeStored,
  encodeStored,
  type KeyValue,
} from '../src/lib/persistence.ts';
import { toastFor, type ToastSpec } from '../src/lib/toasts.svelte.ts';

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function setup(opts: { lock?: TabLock; data?: Map<string, string> } = {}) {
  const data = opts.data ?? new Map<string, string>();
  const kv: KeyValue = {
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    del: async (key) => void data.delete(key),
    update: async (key, fn) => {
      const next = fn(data.get(key));
      if (next !== undefined) data.set(key, next);
    },
  };
  let now = T0;
  const clock = { now: () => now };
  const pushed: ToastSpec[] = [];
  const game = createGame({
    clock,
    kv,
    lock: opts.lock ?? null,
    toasts: { push: (spec) => void pushed.push(spec) },
  });
  return { game, data, kv, pushed, advance: (ms: number) => (now += ms), clock };
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
    expect(decodeStored(data.get(SAVE_KEY) ?? '').text).toBe(serialize(game.state, T0));
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

describe('start, error and tab handling', () => {
  function browserStubs() {
    const intervals: number[] = [];
    let n = 0;
    vi.stubGlobal('window', {
      setInterval: () => {
        intervals.push(++n);
        return n;
      },
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal('document', {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
    });
    return intervals;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('a corrupted save shows the error, starts no loop and never writes', async () => {
    const intervals = browserStubs();
    const s = setup();
    s.data.set(SAVE_KEY, 'garbage');
    await s.game.start();
    expect(s.game.phase).toBe('error');
    expect(s.game.loadError?.raw).toBe('garbage');
    expect(intervals).toEqual([]);
    await s.game.save();
    expect(s.data.get(SAVE_KEY)).toBe('garbage');
  });

  it('retry reads the save again and plays when it is readable', async () => {
    browserStubs();
    const s = setup();
    s.data.set(SAVE_KEY, 'garbage');
    await s.game.start();
    s.data.delete(SAVE_KEY);
    await s.game.retry();
    expect(s.game.phase).toBe('playing');
  });

  it('starting anew after an error parks the broken text first', async () => {
    browserStubs();
    const s = setup();
    s.data.set(SAVE_KEY, 'garbage');
    await s.game.start();
    await s.game.startNewAfterError();
    expect(s.game.phase).toBe('playing');
    expect(s.data.get(BROKEN_SAVE_KEY)).toBe('garbage');
    expect(decodeStored(s.data.get(SAVE_KEY) ?? '').text).toContain('"state"');
  });

  it('a failing read keeps the loop off', async () => {
    const intervals = browserStubs();
    const s = setup();
    s.kv.get = async () => {
      throw new Error('blocked');
    };
    await s.game.start();
    expect(s.game.phase).toBe('error');
    expect(s.game.loadError?.raw).toBeNull();
    expect(intervals).toEqual([]);
  });

  it('a second tab is blocked until it takes over, and the first then stops', async () => {
    browserStubs();
    let holder: (() => void) | null = null;
    const lock: TabLock = {
      acquire: async (onLost) => {
        if (holder) return false;
        holder = onLost;
        return true;
      },
      takeOver: async (onLost) => {
        holder?.();
        holder = onLost;
      },
      release: () => {},
    };
    const data = new Map<string, string>();
    const a = setup({ lock, data });
    const b = setup({ lock, data });
    await a.game.start();
    await b.game.start();
    expect(a.game.phase).toBe('playing');
    expect(b.game.phase).toBe('blocked');
    await b.game.takeOver();
    expect(b.game.phase).toBe('playing');
    expect(a.game.phase).toBe('blocked');
    const written = data.get(SAVE_KEY);
    await a.game.save();
    expect(data.get(SAVE_KEY)).toBe(written);
  });

  it('a tab that finds a newer revision stored stops instead of overwriting it', async () => {
    browserStubs();
    const s = setup();
    await s.game.start();
    await s.game.save();
    s.data.set(SAVE_KEY, encodeStored(99, serialize(s.game.state, T0)));
    const newer = s.data.get(SAVE_KEY);
    await s.game.save();
    expect(s.game.phase).toBe('blocked');
    expect(s.data.get(SAVE_KEY)).toBe(newer);
  });

  it('import keeps the previous save as a backup that can be restored', async () => {
    browserStubs();
    const s = setup();
    await s.game.start();
    startTai(s.game);
    s.advance(10 * 60_000);
    s.game.tick();
    await s.game.save();
    const before = serialize(s.game.state, T0);
    const other = setup();
    await other.game.start();
    await s.game.importText(other.game.exportText());
    expect(serialize(s.game.state, T0)).not.toBe(before);
    expect(s.game.hasBackup).toBe(true);
    expect(await s.game.restoreBackup()).toBe(true);
    expect(serialize(s.game.state, T0)).toBe(before);
  });

  it('announces an action that stops by itself, but not the player stopping it', () => {
    const stop = (reason: 'manual' | 'replaced' | 'requirements' | 'finished') =>
      toastFor({
        type: 'actionStopped',
        at: 0,
        slot: 0,
        kind: 'practice',
        id: 'core:clone',
        reason,
      });
    expect(stop('manual')).toBeNull();
    expect(stop('replaced')).toBeNull();
    expect(stop('requirements')?.key).toBe('toast.stopped.requirements');
    expect(stop('finished')?.ref).toEqual({ kind: 'technique', id: 'core:clone' });
  });

  it('a wall clock that moves backwards does not stall the loop', () => {
    const s = setup();
    startTai(s.game);
    s.advance(-5000);
    s.game.tick();
    const before = s.game.state.now;
    s.advance(100);
    s.game.tick();
    expect(s.game.state.now).toBe(before + 100);
  });
});
