// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import type { UiApi, UiPack } from '../src/lib/ext/types.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { testmodUi } from '../dev-packs/testmod-ui.ts';
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
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];
/** Lets the hashchange event and the effects it starts run, without flushing anything by hand. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  vi.restoreAllMocks();
  for (const id of ['hideMax', 'cancelStop', 'hideHelp']) settings.setExt(`testmod:${id}`, false);
});

describe('a pack error never stops the game (item 1)', () => {
  it('boots when setup throws, rolls the pack back and says so on the settings page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: UiPack = {
      id: 'bad',
      setup(ui) {
        ui.addWidget('skill.header', (el) => void (el.textContent = 'never'), { id: 'w' });
        ui.removeNavItem('core:nope');
      },
    };
    booted = await bootApp([coreUi, bad], genin(), '#/skill/tai');
    expect(q('[data-ui="entity-page"]')).not.toBeNull();
    expect(booted.target.textContent).not.toContain('never');
    expect(booted.ui.registry.disabled.map((d) => d.packId)).toEqual(['bad']);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('"bad"'))).toHaveLength(1);
    await booted.go('#/settings');
    expect(q('[data-ui="disabled-packs"]')?.textContent).toMatch(
      /Інтерфейс розширення «bad» вимкнено через помилку.*core:nope/,
    );
  });

  it('boots when a nav predicate throws, and stops calling it after three failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const when = vi.fn(() => {
      throw new Error('predicate');
    });
    const bad: UiPack = { id: 'bad', setup: (ui) => ui.removeNavItem('core:help', { when }) };
    booted = await bootApp([coreUi, bad], genin(), '#/skills');
    expect(q('a[data-nav="help"]')).not.toBeNull();
    expect(qa('a[data-ui="nav-item"]').length).toBeGreaterThan(5);
    // The nav is read by two components and re-read on every change; the predicate is called three times at most.
    for (let i = 0; i < 4; i++) {
      settings.setExt('bad:x', i % 2 === 0);
      flushSync();
    }
    expect(when.mock.calls.length).toBeLessThanOrEqual(3);
    expect(q('a[data-nav="help"]')).not.toBeNull();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('predicate'))).toBe(true);
  });

  it('renders the page when an entity link builder throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: UiPack = {
      id: 'bad',
      setup: (ui) =>
        ui.addEntityLink({
          kind: 'technique',
          title: 'x.bad.link',
          href: () => {
            throw new Error('href');
          },
        }),
    };
    booted = await bootApp([coreUi, bad, testmodUi], genin(), '#/technique/core:leaf_whirlwind');
    expect(q('[data-ui="entity-page"]')).not.toBeNull();
    // The other pack's link is still there; the failing one shows nothing.
    expect(qa('[data-ui-links] a')).toHaveLength(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('href'))).toBe(true);
  });

  it('switches a pack off when start throws, taking back what it did', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: UiPack = {
      id: 'bad',
      setup: (ui) =>
        ui.addWidget('skill.header', (el) => void (el.textContent = 'never'), { id: 'w' }),
      start(api) {
        api.on('state', () => {});
        api.dom.observe({ part: 'action-tile' }, () => {});
        throw new Error('start failed');
      },
    };
    booted = await bootApp([coreUi, bad], genin(), '#/skill/tai');
    expect(booted.ui.registry.disabled[0]?.message).toBe('start failed');
    expect(booted.target.textContent).not.toContain('never');
    expect(booted.ui.stats()).toEqual({ hooks: 0, injected: 0, subscriptions: 0 });
  });

  it('calls a hook that keeps failing three times, then no more', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = vi.fn(() => {
      throw new Error('hook');
    });
    const bad: UiPack = { id: 'bad', start: (api) => void api.on('command:before', calls) };
    booted = await bootApp([coreUi, bad]);
    for (let i = 0; i < 5; i++)
      game.dispatch({ type: 'action.start', slot: 0, kind: 'practice', id: 'core:nope' });
    expect(calls).toHaveBeenCalledTimes(3);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes('failed in'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('disabled'))).toBe(true);
    // A hook that works again in between is not disabled: the count is of failures in a row.
    expect(game.dispatch(START).ok).toBe(true);
  });
});

describe('the route hook (item 2)', () => {
  it('asks «before» while the old page is on screen and «after» when the new one is drawn', async () => {
    const seen: string[] = [];
    const page = () => q('[data-ui="page"]')?.getAttribute('data-page');
    const spy: UiPack = {
      id: 'spy',
      start: (api) =>
        void api.on('route', (e) => void seen.push(`${e.phase}:${e.from}>${e.to} on ${page()}`)),
    };
    booted = await bootApp([coreUi, spy], genin(), '#/skills');
    seen.length = 0;
    // The way the browser does it: the address changes and a hashchange event follows.
    location.hash = '#/bank';
    await settle();
    expect(seen).toEqual([
      'before:#/skills>#/bank on core:skills',
      'after:#/skills>#/bank on core:bank',
    ]);
  });

  it('lets «before» cancel a route or send it elsewhere', async () => {
    const guard: UiPack = {
      id: 'guard',
      start: (api) =>
        void api.on('route', (e) => {
          if (e.phase !== 'before') return;
          if (e.to === '#/rank') return false;
          if (e.to === '#/shop') return '#/bank';
        }),
    };
    booted = await bootApp([coreUi, guard], genin(), '#/skills');
    location.hash = '#/rank';
    await settle();
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:skills');
    expect(location.hash).toBe('#/skills');
    location.hash = '#/shop';
    await settle();
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:bank');
    expect(location.hash).toBe('#/bank');
    // Going on works as before.
    location.hash = '#/help';
    await settle();
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:help');
  });
});

describe('content and core are read-only for packs (item 4)', () => {
  it('hands out frozen content', async () => {
    let api: UiApi | null = null;
    booted = await bootApp([coreUi, { id: 'p', start: (a) => void (api = a) }]);
    const ui = api as unknown as UiApi;
    expect(Object.isFrozen(ui.content)).toBe(true);
    expect(Object.isFrozen(ui.content.balance.K)).toBe(true);
    expect(() => {
      (ui.content.balance.K as { masteryCap: number }).masteryCap = 3;
    }).toThrow(TypeError);
    expect(content.balance.K.masteryCap).not.toBe(3);
    // The game itself runs on the frozen content: starting and advancing write nothing into it.
    game.dispatch(START);
    booted.advance(60_000);
    expect(game.state.skills.tai!.xp).toBeGreaterThan(0);
  });
});

describe('a refused command is said once, by the store (item 6)', () => {
  it('shows the refusal for the Now-bar stop button as well', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skill/tai');
    game.dispatch(START);
    flushSync();
    settings.setExt('testmod:cancelStop', true);
    flushSync();
    q('[data-ui="now-slot"] button.stop')?.click();
    flushSync();
    expect(game.state.slots[0]?.action?.id).toBe('core:leaf_whirlwind');
    expect(document.body.textContent).toContain('Дію скасувало розширення інтерфейсу.');
  });
});

describe('the phone tab bar does not overflow (item 8)', () => {
  it('keeps five tabs; the others a pack moves there are listed on «Ще»', async () => {
    const mover: UiPack = {
      id: 'mover',
      setup(ui) {
        for (const id of ['bank', 'shop', 'village'])
          ui.moveNavItem(`core:${id}`, { group: 'tab', tabOrder: 5 });
      },
    };
    booted = await bootApp([coreUi, mover], genin(), '#/skills');
    const tabs = qa('nav.tabbar a[data-ui="nav-item"]');
    expect(tabs.length).toBeLessThanOrEqual(5);
    expect(tabs.some((t) => t.dataset.tab === 'more')).toBe(true);
    await booted.go('#/more');
    const shown = new Set(tabs.map((t) => t.dataset.tab));
    // Whatever did not fit in the bar is reachable from «Ще» (the built-in list names bank, shop and village by hand).
    for (const id of ['bank', 'shop', 'village']) {
      expect(shown.has(id) || q(`[data-more-${id}]`) !== null, id).toBe(true);
    }
  });
});

describe('routes and anchors', () => {
  it('opens #/village/ with a trailing slash', async () => {
    booted = await bootApp([coreUi], genin(), '#/village/');
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:village');
  });

  it('marks the rows of the goal tree and the points of interest', async () => {
    const state = genin();
    const cell = content.cells.find((c) => c.pois.length > 0);
    if (!cell) throw new Error('no cell with points of interest');
    state.world.explores[cell.id] = content.balance.K.cellExplores[0] ?? 0;
    for (const poi of cell.pois) state.world.pois[poi.id] = true;
    booted = await bootApp([coreUi], state, `#/cell/${cell.id}`);
    const rows = qa('[data-ui="poi-row"]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.getAttribute('data-entity')).toMatch(/^poi:.+/);

    const technique = content.techniques[0]?.id;
    game.dispatch({ type: 'goal.pin', ref: { kind: 'technique', id: technique ?? '' } });
    flushSync();
    await booted.go('#/skills');
    const goal = qa('[data-ui="goal-panel"] [data-ui="goal-row"]');
    expect(goal.length).toBeGreaterThan(0);
    expect(goal.some((r) => /^[a-z]+:.+/.test(r.getAttribute('data-entity') ?? ''))).toBe(true);
  });

  it('shows the base theme in the picker when the stored theme is unknown', async () => {
    settings.theme = 'gone:theme';
    booted = await bootApp([coreUi, testmodUi], genin(), '#/settings');
    settings.theme = 'gone:theme';
    flushSync();
    expect((q('[data-ui="theme-select"] select') as HTMLSelectElement).value).toBe('core:base');
  });
});
