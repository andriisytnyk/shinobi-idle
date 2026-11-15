// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import type { UiApi, UiPack } from '../src/lib/ext/types.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, genin, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const START = {
  type: 'action.start',
  slot: 0,
  kind: 'practice',
  id: 'core:leaf_whirlwind',
} as const;

let booted: BootedApp | null = null;
beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  vi.restoreAllMocks();
});

describe('a widget that fails does not break the page (A5)', () => {
  let updates = 0;
  const flaky: UiPack = {
    id: 'flaky',
    setup(ui) {
      ui.addWidget(
        'skill.header',
        () => {
          throw new Error('mount');
        },
        { id: 'mount', order: 1 },
      );
      ui.addWidget(
        'skill.header',
        (el, api) => {
          el.textContent = 'sub';
          api.subscribe(() => {
            throw new Error('subscription');
          });
        },
        { id: 'sub', order: 2 },
      );
      ui.addWidget(
        'skill.header',
        (el) => {
          el.textContent = 'cleanup';
          return () => {
            throw new Error('cleanup');
          };
        },
        { id: 'cleanup', order: 3 },
      );
      ui.addWidget(
        'skill.header',
        (el, api) => {
          el.textContent = 'fine';
          api.subscribe(() => void updates++);
        },
        { id: 'fine', order: 4 },
      );
    },
  };

  it('renders the page and the other widgets, with one warning per widget', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    updates = 0;
    booted = await bootApp([coreUi, flaky], genin(), '#/skill/tai');
    const host = (id: string) => booted?.target.querySelector(`[data-ui-widget="flaky:${id}"]`);
    // The page is there, and so is every widget that did not fail on mount; the failed one shows nothing.
    expect(booted.target.querySelector('[data-ui="entity-page"]')).not.toBeNull();
    expect(host('mount')?.childNodes.length).toBe(0);
    expect(host('sub')?.textContent).toBe('sub');
    expect(host('fine')?.textContent).toBe('fine');

    game.dispatch(START);
    booted.advance(1000);
    booted.advance(1000);
    // The subscriber that throws does not stop the one after it.
    expect(updates).toBeGreaterThanOrEqual(2);
    expect(booted.target.querySelector('[data-ui="action-tile"]')).not.toBeNull();

    await booted.go('#/bank');
    expect(booted.target.querySelector('[data-ui="page"]')).not.toBeNull();

    const warned = (id: string) =>
      warn.mock.calls.filter((c) => String(c[0]).includes(`"flaky:${id}"`));
    expect(warned('mount')).toHaveLength(1);
    expect(warned('sub')).toHaveLength(1);
    expect(warned('cleanup')).toHaveLength(1);
    expect(warned('fine')).toHaveLength(0);
  });
});

describe('the API gives no way to write to the game (A7)', () => {
  let api: UiApi | null = null;
  const probe: UiPack = {
    id: 'probe',
    start(a) {
      api = a;
    },
  };

  it('hands out snapshots that cannot be written to, and refreshes them after an update', async () => {
    booted = await bootApp([coreUi, probe]);
    if (!api) throw new Error('the pack was not started');
    const ui = api as UiApi;
    const snapshot = ui.read();
    // The same data the UI reads.
    expect(snapshot).toEqual(game.read((s) => s));
    const ryo = snapshot.currencies.ryo;
    expect(() => {
      snapshot.currencies.ryo = ryo + 1000;
    }).toThrow(TypeError);
    expect(() => {
      snapshot.slots.push({ action: null, progress: 0, share: 0, data: null });
    }).toThrow(TypeError);
    expect(game.state.currencies.ryo).toBe(ryo);
    expect(ui.read().currencies.ryo).toBe(ryo);

    // After a store update the next read is a fresh snapshot of the game.
    game.dispatch(START);
    flushSync();
    const next = ui.read();
    expect(next).not.toBe(snapshot);
    expect(next.slots[0]?.action?.id).toBe('core:leaf_whirlwind');
    expect(snapshot.slots[0]?.action).toBeNull();
    expect(ui.read((s) => s.slots[0]?.action?.id)).toBe('core:leaf_whirlwind');
  });

  it('changes the game only through dispatch: refused and accepted', async () => {
    booted = await bootApp([coreUi, probe]);
    const ui = api as unknown as UiApi;
    const before = JSON.stringify(game.state.slots);
    const refused = ui.dispatch({
      type: 'action.start',
      slot: 0,
      kind: 'practice',
      id: 'core:nope',
    });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(game.state.slots)).toBe(before);
    const accepted = ui.dispatch(START);
    expect(accepted).toEqual({ ok: true });
    expect(game.state.slots[0]?.action?.id).toBe('core:leaf_whirlwind');
    // The functions of the core that change a state they are given are not on the API.
    for (const name of ['dispatch', 'advance', 'advanceOffline']) {
      expect(name in ui.core, name).toBe(false);
    }
    expect(typeof ui.core.actionInfo).toBe('function');
    expect(ui.getMod('xp.all').total).toBeGreaterThan(0);
  });

  it('keeps the storage of a pack apart from the save and from other packs', async () => {
    localStorage.clear();
    booted = await bootApp([coreUi, probe, { id: 'other' }]);
    const ui = api as unknown as UiApi;
    ui.storage.set('key', { n: 1 });
    expect(ui.storage.get('key')).toEqual({ n: 1 });
    expect(localStorage.getItem('shinobi.ui.probe.key')).toBe('{"n":1}');
    expect(localStorage.getItem('shinobi.ui.other.key')).toBeNull();
    ui.storage.remove('key');
    expect(ui.storage.get('key')).toBeUndefined();
    expect(JSON.stringify(game.state)).not.toContain('shinobi.ui');
  });
});
