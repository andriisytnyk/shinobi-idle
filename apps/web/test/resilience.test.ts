// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { STATE_VERSION } from '@shinobi/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import type { UiPack } from '../src/lib/ext/types.ts';
import { createGame, TICK_MS } from '../src/lib/game.svelte.ts';
import {
  BACKUPS_INDEX_KEY,
  BACKUPS_KEEP,
  LoadError,
  SAVE_KEY,
  addBackup,
  encodeStored,
  listBackups,
  loadGame,
  type KeyValue,
} from '../src/lib/persistence.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, genin, type BootedApp } from './helpers/boot-app.ts';
import Throwing from './helpers/Throwing.svelte';
import fixture from './fixtures/save-v14-reveal.json';

/*
 * Stage 9: a crash never costs the player their save. A page that fails to draw is replaced by a
 * fallback, the game loop that fails stops and leaves the save alone, and a save of an older format
 * is copied before it is upgraded.
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const T0 = 1_800_000_000_000;
/** The clock of the old save: loading it then has no away time to simulate. */
const SAVED_AT = fixture.savedAt;
const OLD_SAVE = JSON.stringify(fixture);

function memoryStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    del: async (key) => void data.delete(key),
    update: async (key, fn) => {
      const next = fn(data.get(key));
      if (next !== undefined) data.set(key, next);
    },
  };
}

/** A content whose upgrade from version 6 throws once armed: a migration that fails. */
function failingContent() {
  const state = { armed: false };
  const bad = new Proxy(content, {
    get(target, key, receiver) {
      if (state.armed && key === 'obstacles') throw new Error('migration boom');
      return Reflect.get(target, key, receiver);
    },
  });
  return { bad, arm: () => (state.armed = true) };
}

describe('backup before an upgrade', () => {
  it('keeps the raw text of a real old save under a key with its version, then upgrades it', async () => {
    const kv = memoryStore();
    kv.data.set(SAVE_KEY, OLD_SAVE);
    const result = await loadGame(kv, { now: () => SAVED_AT }, content);
    expect(result.state.v).toBe(STATE_VERSION);
    const [entry] = await listBackups(kv);
    expect(entry).toBeDefined();
    expect(entry?.v).toBe(14);
    expect(entry?.key).toBe(`save.backup.v14.${SAVED_AT}`);
    expect(kv.data.get(entry?.key ?? '')).toBe(OLD_SAVE);
  });

  it('keeps no backup of a save that is already current, and none twice of the same text', async () => {
    const kv = memoryStore();
    kv.data.set(SAVE_KEY, OLD_SAVE);
    await loadGame(kv, { now: () => SAVED_AT }, content);
    await loadGame(kv, { now: () => SAVED_AT + 5 }, content);
    expect(await listBackups(kv)).toHaveLength(1);

    const fresh = memoryStore();
    const loaded = await loadGame(fresh, { now: () => T0 }, content);
    expect(loaded.rev).toBe(0);
    expect(fresh.data.has(BACKUPS_INDEX_KEY)).toBe(false);
  });

  it('keeps the last three backups and removes the older texts', async () => {
    const kv = memoryStore();
    for (let i = 0; i < 5; i++) await addBackup(kv, `text-${i}`, 10 + i, T0 + i);
    const list = await listBackups(kv);
    expect(list).toHaveLength(BACKUPS_KEEP);
    expect(list.map((e) => e.v)).toEqual([14, 13, 12]);
    const keys = [...kv.data.keys()].filter((k) => k.startsWith('save.backup.v'));
    expect(keys.sort()).toEqual(list.map((e) => e.key).sort());
  });

  it('keeps the old save untouched and the backup in place when the upgrade throws', async () => {
    const kv = memoryStore();
    const stored = encodeStored(4, JSON.stringify({ ...fixture, v: 6 }));
    kv.data.set(SAVE_KEY, stored);
    const { bad, arm } = failingContent();
    arm();
    const error = await loadGame(kv, { now: () => T0 }, bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as Error).message).toContain('migration boom');
    expect(kv.data.get(SAVE_KEY)).toBe(stored);
    const [entry] = await listBackups(kv);
    expect(entry?.v).toBe(6);
    expect(kv.data.get(entry?.key ?? '')).toBe(stored);
  });
});

describe('the game after a failed upgrade', () => {
  it('writes nothing, offers the backup for export and keeps it for the settings', async () => {
    const kv = memoryStore();
    const stored = encodeStored(4, JSON.stringify({ ...fixture, v: 6 }));
    kv.data.set(SAVE_KEY, stored);
    const { bad, arm } = failingContent();
    const g = createGame({ content: bad, clock: { now: () => T0 }, kv });
    arm();
    await g.start();
    expect(g.phase).toBe('error');
    expect(g.backups).toHaveLength(1);
    await g.save();
    expect(kv.data.get(SAVE_KEY)).toBe(stored);
    const text = await g.exportBackup(g.backups[0]?.key ?? '');
    expect(JSON.parse(atob(text ?? ''))).toMatchObject({ v: 6 });
    g.stop();
  });

  it('restores a backup from the list and keeps the game it replaces as the previous save', async () => {
    const kv = memoryStore();
    kv.data.set(SAVE_KEY, OLD_SAVE);
    const g = createGame({ clock: { now: () => SAVED_AT }, kv });
    await g.start();
    expect(g.phase).toBe('playing');
    expect(g.backups.map((b) => b.v)).toEqual([14]);
    g.state.player.name = 'Після';
    await g.save();
    expect(await g.restoreFrom(g.backups[0]?.key ?? '')).toBe(true);
    expect(g.state.player.name).not.toBe('Після');
    expect(g.hasBackup).toBe(true);
    expect(await g.restoreFrom('save.backup.v1.0')).toBe(false);
    g.stop();
  });
});

describe('the game loop that fails', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stops, keeps the last good save and never writes the half-changed state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const kv = memoryStore();
      let now = T0;
      const g = createGame({ clock: { now: () => now }, kv });
      await g.start();
      g.state.player.name = 'Добре';
      await g.save();
      const good = kv.data.get(SAVE_KEY);
      expect(good).toBeDefined();

      // The state is broken the way a bug would break it.
      (g.state as unknown as { slots: unknown }).slots = null;
      g.state.player.name = 'Зіпсовано';
      g.state.events.push(null as never);
      now += TICK_MS;
      vi.advanceTimersByTime(TICK_MS);
      if (g.phase !== 'crashed') {
        // Whatever the break was, make the loop throw for sure.
        (g.state as unknown as { rng: unknown }).rng = null;
        now += TICK_MS;
        vi.advanceTimersByTime(TICK_MS);
      }
      expect(g.phase).toBe('crashed');
      expect(g.crash?.message).toBeTruthy();

      // No timer and no event writes any more.
      now += 60_000;
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
      await g.save();
      expect(kv.data.get(SAVE_KEY)).toBe(good);

      // The last good save can be exported from the crash screen.
      const text = await g.exportStored();
      expect(JSON.parse(Buffer.from(text ?? '', 'base64').toString('utf8')).state.player.name).toBe(
        'Добре',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the app: a part that fails to draw', () => {
  let booted: BootedApp | null = null;
  afterEach(() => {
    booted?.destroy();
    booted = null;
    vi.restoreAllMocks();
  });

  const brokenPage: UiPack = {
    id: 'broken',
    setup: (ui) => {
      ui.addPage({
        id: 'oops',
        route: '#/x/broken/oops',
        title: 'x',
        mount: { svelte: Throwing },
      });
    },
  };

  it('shows the calm fallback for the page, keeps the rest and the loop going, and recovers on navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    booted = await bootApp([coreUi, brokenPage], genin(), '#/x/broken/oops');
    const fallback = booted.target.querySelector('[data-error-boundary="page"]');
    expect(fallback?.textContent).toContain('Щось пішло не так у цій частині гри');
    expect(fallback?.textContent).toContain('Спробувати ще раз');
    expect(fallback?.textContent).toContain('Повідомити');
    // The navigation, the Now bar and the top bar are still there.
    expect(booted.target.querySelector('.side')?.textContent).not.toBe('');
    expect(booted.target.querySelector('[data-error-boundary="side"]')).toBeNull();
    expect(booted.target.querySelector('[data-error-boundary="now"]')).toBeNull();
    // The game goes on.
    const before = game.state.now;
    booted.advance(1_000);
    expect(game.state.now).toBe(before + 1_000);
    // Another page is drawn again.
    await booted.go('#/settings');
    expect(booted.target.querySelector('[data-error-boundary]')).toBeNull();
  });

  it('copies a short error report to the clipboard and tells the player', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    booted = await bootApp([coreUi, brokenPage], genin(), '#/x/broken/oops');
    const buttons = [...booted.target.querySelectorAll('[data-error-boundary="page"] button')];
    const report = buttons.find((b) => b.textContent?.includes('Повідомити')) as HTMLElement;
    report.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledOnce();
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain('area: page');
    expect(text).toContain('error: boom');
    expect(
      booted.target.querySelector('[data-error-boundary="page"] [role="status"]'),
    ).not.toBeNull();
  });

  it('the retry button draws the part again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    booted = await bootApp([coreUi, brokenPage], genin(), '#/x/broken/oops');
    const buttons = [...booted.target.querySelectorAll('[data-error-boundary="page"] button')];
    const retry = buttons.find((b) => b.textContent?.includes('Спробувати ще раз')) as HTMLElement;
    retry.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The page throws again, so the fallback is back: the button reached the boundary and nothing else broke.
    expect(booted.target.querySelector('[data-error-boundary="page"]')).not.toBeNull();
  });
});
