// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import type { UiPack } from '../src/lib/ext/types.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, genin, type BootedApp } from './helpers/boot-app.ts';
import { testmodUi } from '../dev-packs/testmod-ui.ts';

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
const HOUR = 3_600_000;

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];
const cell = (part: string) => q(`[data-testmod="${part}"] dd`)?.textContent ?? null;

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
beforeEach(() => {
  localStorage.clear();
  for (const id of ['hideMax', 'cancelStop', 'hideHelp']) settings.setExt(`testmod:${id}`, false);
});
afterEach(() => {
  booted?.destroy();
  booted = null;
  vi.restoreAllMocks();
});

describe('the testmod pack: widgets, page, nav, link, setting (A3)', () => {
  it('shows the three figures on the skill page and they follow the game', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skill/tai');
    expect(cell('xph')).toBe('—');
    expect(game.dispatch(START).ok).toBe(true);
    flushSync();
    const xph = Number(cell('xph'));
    expect(xph).toBeGreaterThan(0);
    expect(cell('to-next')).toMatch(/хв/);
    const before = cell('to-max');
    expect(before).toMatch(/год/);
    booted.advance(10 * 60_000);
    expect(cell('to-max')).not.toBe(before);
    // The widget is computed from the core's own rate: XP per hour times the time it takes.
    expect(game.state.slots[0]?.action?.id).toBe('core:leaf_whirlwind');
    await booted.go('#/skill/herb');
    expect(cell('xph')).toBe('—');
  });

  it('adds a nav item that opens the pack page, and a link on technique pages', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skills');
    const item = q('a[data-nav="testmod:skills"]');
    expect(item?.getAttribute('href')).toBe('#/x/testmod/skills');
    expect(item?.textContent).toContain('Таблиця навичок');
    await booted.go(item?.getAttribute('href') ?? '');
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('testmod:skills');
    expect(qa('[data-testmod="page"] tbody tr')).toHaveLength(content.skills.length);
    expect(item?.getAttribute('aria-current')).toBe('page');
    // The phone menu lists it as well.
    await booted.go('#/more');
    expect(q('[data-more-item="testmod:skills"]')).not.toBeNull();

    await booted.go('#/technique/core:leaf_whirlwind');
    const link = q('[data-ui-links] a');
    expect(link?.textContent).toBe('Відкрити таблицю навичок');
    expect(link?.getAttribute('href')).toBe('#/x/testmod/skills');
  });

  it('the toggle setting hides the «to max level» row', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skill/tai');
    game.dispatch(START);
    flushSync();
    expect(q('[data-testmod="to-max"]')).not.toBeNull();
    settings.setExt('testmod:hideMax', true);
    flushSync();
    expect(q('[data-testmod="to-max"]')).toBeNull();
    expect(q('[data-testmod="to-next"]')).not.toBeNull();
    // The setting is on the settings page, with the pack's own text.
    await booted.go('#/settings');
    expect(q('[data-ui="pack-settings"]')?.textContent).toContain('Не показувати');
  });

  it('without the pack none of this exists', async () => {
    booted = await bootApp([coreUi], genin(), '#/skill/tai');
    game.dispatch(START);
    flushSync();
    for (const hash of ['#/skill/tai', '#/more', '#/technique/core:leaf_whirlwind', '#/settings']) {
      await booted.go(hash);
      expect(booted.target.innerHTML, hash).not.toContain('x.testmod.');
      expect(booted.target.innerHTML, hash).not.toContain('data-testmod');
    }
    expect(q('a[data-nav="testmod:skills"]')).toBeNull();
    await booted.go('#/x/testmod/skills');
    expect(q('[data-ui="page"]')).toBeNull();
  });
});

describe('themes (A4)', () => {
  const root = () => document.documentElement;
  const accent = () => root().style.getPropertyValue('--accent');

  it('applies the overrides, restores the base look exactly and drops the injected style', async () => {
    booted = await bootApp([coreUi, testmodUi]);
    const originalStyle = root().getAttribute('style');
    expect(accent()).toBe('');

    settings.theme = 'testmod:bright';
    flushSync();
    expect(accent()).toBe('#ff4fa3');
    expect(root().style.getPropertyValue('--space-1')).toBe('0.4rem');
    expect(root().style.getPropertyValue('--control-md')).toBe('3rem');
    expect(getComputedStyle(root()).getPropertyValue('--accent').trim()).toBe('#ff4fa3');
    expect(document.querySelectorAll('style[data-ui-theme]')).toHaveLength(1);

    settings.theme = 'core:base';
    flushSync();
    expect(root().getAttribute('style')).toBe(originalStyle);
    expect(accent()).toBe('');
    expect(document.querySelector('style[data-ui-theme]')).toBeNull();
  });

  it('is picked on the settings page from the registered themes', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/settings');
    const select = q('[data-ui="theme-select"] select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['core:base', 'testmod:bright']);
    select.value = 'testmod:bright';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(accent()).toBe('#ff4fa3');
    select.value = 'core:base';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(accent()).toBe('');
  });

  it('falls back to the base theme for an unknown id, and has no picker with one theme', async () => {
    settings.theme = 'gone:theme';
    booted = await bootApp([coreUi, testmodUi]);
    settings.theme = 'gone:theme';
    flushSync();
    expect(accent()).toBe('');
    expect(root().getAttribute('style') ?? '').not.toContain('--');
    await booted.go('#/settings');
    expect(q('[data-ui="theme-select"]')).not.toBeNull();
    booted.destroy();
    booted = await bootApp([coreUi], genin(), '#/settings');
    expect(q('[data-ui="theme-select"]')).toBeNull();
  });

  it('moves the whole control scale, which every button, field, select and nav item follows', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/settings');
    settings.theme = 'testmod:bright';
    flushSync();
    // The scale is set on the root; the components read it (no-raw-lengths checks that they all do).
    expect(
      ['--control-xs', '--control-sm', '--control-md'].map((t) => root().style.getPropertyValue(t)),
    ).toEqual(['2.25rem', '2.5rem', '3rem']);
    // The controls the theme reaches are on the page: buttons, a select, a text field, nav items.
    expect(qa('main button').length).toBeGreaterThan(0);
    expect(q('[data-ui="theme-select"] select')).not.toBeNull();
    expect(q('a[data-ui="nav-item"]')).not.toBeNull();
    settings.theme = 'core:base';
    flushSync();
    expect(root().style.getPropertyValue('--control-md')).toBe('');
  });

  it('removes the theme when the app is closed', async () => {
    booted = await bootApp([coreUi, testmodUi]);
    settings.theme = 'testmod:bright';
    flushSync();
    expect(accent()).toBe('#ff4fa3');
    booted.destroy();
    booted = null;
    expect(accent()).toBe('');
    expect(document.querySelector('style[data-ui-theme]')).toBeNull();
  });
});

describe('injection by selector (D12)', () => {
  const lines = () => qa('[data-testmod="mastery-line"]');
  const tiles = () => qa('[data-ui="action-tile"]');

  it('adds a line to every action tile, also to tiles that appear after navigation', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skill/tai');
    await Promise.resolve();
    expect(tiles().length).toBeGreaterThan(1);
    expect(lines()).toHaveLength(tiles().length);
    for (const tile of tiles()) {
      expect(tile.contains(tile.querySelector('[data-testmod="mastery-line"]'))).toBe(true);
    }
    expect(lines()[0]?.textContent).toMatch(/^До наступного рівня Майстерності: \d+ досвіду$/);

    await booted.go('#/skill/herb');
    await Promise.resolve();
    expect(tiles().length).toBeGreaterThan(0);
    expect(lines()).toHaveLength(tiles().length);
  });

  it('runs the cleanups when the elements go away: no nodes, subscriptions or observers left', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skill/tai');
    await Promise.resolve();
    const baseline = booted.ui.stats();
    expect(baseline.injected).toBe(tiles().length);
    for (let i = 0; i < 3; i++) {
      await booted.go('#/skill/herb');
      await Promise.resolve();
      await booted.go('#/skill/tai');
      await Promise.resolve();
    }
    expect(booted.ui.stats()).toEqual(baseline);
    await booted.go('#/bank');
    await Promise.resolve();
    expect(lines()).toHaveLength(0);
    expect(booted.ui.stats().injected).toBe(0);
    const bare = booted.ui.stats().subscriptions;
    booted.destroy();
    booted = null;
    expect(bare).toBeLessThan(baseline.subscriptions);
    expect(document.querySelectorAll('[data-testmod]')).toHaveLength(0);
  });

  it('finds an entity by part, kind and id', async () => {
    booted = await bootApp([coreUi], genin(), '#/skill/tai');
    const seen: string[] = [];
    const off = booted.ui.hub.observe(
      'core',
      { part: 'action-tile', kind: 'technique', id: 'core:leaf_whirlwind' },
      (el) => void seen.push(el.dataset.entity ?? ''),
    );
    await Promise.resolve();
    expect(seen).toEqual(['technique:core:leaf_whirlwind']);
    off();
  });
});

describe('hooks (D13)', () => {
  it('counts started actions on the pack page', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/x/testmod/skills');
    expect(q('[data-testmod="started"]')?.textContent).toBe('Розпочато дій: 0');
    game.dispatch(START);
    flushSync();
    expect(q('[data-testmod="started"]')?.textContent).toBe('Розпочато дій: 1');
    game.dispatch({ ...START, id: 'core:leaf_whirlwind' });
    flushSync();
    expect(q('[data-testmod="started"]')?.textContent).toBe('Розпочато дій: 2');
    // A refused command is not counted.
    game.dispatch({ type: 'action.start', slot: 0, kind: 'practice', id: 'core:nope' });
    flushSync();
    expect(q('[data-testmod="started"]')?.textContent).toBe('Розпочато дій: 2');
  });

  it('cancels a command and leaves the state unchanged, with a toast', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skill/tai');
    game.dispatch(START);
    settings.setExt('testmod:cancelStop', true);
    flushSync();
    const before = JSON.stringify(game.state.slots);
    const result = game.dispatch({ type: 'action.stop', slot: 0 });
    flushSync();
    expect(result).toEqual({ ok: false, reason: 'error.cancelledByMod' });
    expect(JSON.stringify(game.state.slots)).toBe(before);
    expect(game.state.slots[0]?.action?.id).toBe('core:leaf_whirlwind');
    expect(document.body.textContent).toContain('Розширення не дозволило зупинити дію.');
    // With the setting off the same command goes through.
    settings.setExt('testmod:cancelStop', false);
    flushSync();
    expect(game.dispatch({ type: 'action.stop', slot: 0 }).ok).toBe(true);
    expect(game.state.slots[0]?.action).toBeNull();
  });

  /** A pack that records which of its hooks ran, in what order. */
  const logger = (
    id: string,
    log: string[],
    opts: { late?: boolean; throws?: boolean } = {},
  ): UiPack => ({
    id,
    setup(ui) {
      if (opts.late) {
        // Registers its hook only when the widget is mounted, long after the others started.
        ui.addWidget('topbar', (_el, api) => api.on('command:before', () => void log.push(id)));
      }
    },
    start: opts.late
      ? undefined
      : (api) => {
          const off = api.on('command:before', () => {
            log.push(id);
            if (opts.throws) throw new Error(`boom from ${id}`);
          });
          const offAfter = api.on('command:after', () => void log.push(`${id}:after`));
          return () => {
            off();
            offAfter();
          };
        },
  });

  it('runs hooks in pack load order, whenever they were registered', async () => {
    const log: string[] = [];
    booted = await bootApp([coreUi, logger('aaa', log, { late: true }), logger('bbb', log)]);
    game.dispatch(START);
    expect(log).toEqual(['aaa', 'bbb', 'bbb:after']);
  });

  it('isolates a hook that throws: the command and the other hooks still run, one warning', async () => {
    const log: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    booted = await bootApp([coreUi, logger('bad', log, { throws: true }), logger('good', log)]);
    expect(game.dispatch(START).ok).toBe(true);
    game.dispatch({ type: 'action.stop', slot: 0 });
    expect(log.filter((l) => l === 'good')).toHaveLength(2);
    expect(log.filter((l) => l === 'good:after')).toHaveLength(2);
    expect(game.state.slots[0]?.action).toBeNull();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('bad'))).toHaveLength(1);
  });

  it('lets a hook replace a command', async () => {
    const replacer: UiPack = {
      id: 'swap',
      start: (api) =>
        api.on('command:before', (command) =>
          command.type === 'action.start' && command.slot === 7
            ? { ...command, slot: 0 }
            : undefined,
        ),
    };
    booted = await bootApp([coreUi, replacer]);
    expect(game.dispatch({ ...START, slot: 7 }).ok).toBe(true);
    expect(game.state.slots[0]?.action?.id).toBe('core:leaf_whirlwind');
  });

  it('reports routes before and after, the state after updates and every game event', async () => {
    const seen: string[] = [];
    const events: string[] = [];
    const watcher: UiPack = {
      id: 'watch',
      start(api) {
        const offs = [
          api.on('route', (e) => void seen.push(`${e.phase}:${e.to}`)),
          api.on('state', () => void seen.push('state')),
          api.on('event', (e) => void events.push(e.type)),
        ];
        return () => offs.forEach((off) => off());
      },
    };
    const state = genin();
    state.skills.tai!.xp = 0;
    booted = await bootApp([coreUi, watcher], state, '#/skills');
    seen.length = 0;
    await booted.go('#/bank');
    expect(seen.filter((s) => s !== 'state')).toEqual(['before:#/bank', 'after:#/bank']);
    seen.length = 0;
    game.dispatch(START);
    booted.advance(2 * HOUR);
    expect(seen).toContain('state');
    expect(events).toContain('levelUp');
  });
});

describe('overrides (D14)', () => {
  it('wraps the settings page with a banner and takes it away with the page', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/settings');
    const banner = q('[data-testmod="banner"]');
    expect(banner?.textContent).toBe('Налаштування доповнено розширенням.');
    // The page itself is still drawn, below the banner, inside the same app.
    const title = [...(booted.target.querySelectorAll('h1') ?? [])].find((h) =>
      h.textContent?.includes('Налаштування'),
    );
    expect(title).toBeDefined();
    expect(banner?.compareDocumentPosition(title as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await booted.go('#/bank');
    expect(q('[data-testmod="banner"]')).toBeNull();
  });

  it('removes a nav item while the setting says so', async () => {
    booted = await bootApp([coreUi, testmodUi], genin(), '#/skills');
    expect(q('a[data-nav="help"]')).not.toBeNull();
    settings.setExt('testmod:hideHelp', true);
    flushSync();
    expect(q('a[data-nav="help"]')).toBeNull();
    expect(q('a[data-nav="bank"]')).not.toBeNull();
    settings.setExt('testmod:hideHelp', false);
    flushSync();
    expect(q('a[data-nav="help"]')).not.toBeNull();
  });

  it('replaces a page; when two packs replace it the later one wins, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const replacer = (id: string): UiPack => ({
      id,
      setup(ui) {
        ui.replacePage('core:help', (el) => {
          el.textContent = `help by ${id}`;
        });
      },
    });
    booted = await bootApp([coreUi, replacer('one'), replacer('two')], genin(), '#/help');
    expect(q('[data-ui="page"]')?.textContent).toBe('help by two');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('"two"'))).toBe(true);
  });

  it('moves a nav item to another group and orders widgets of another pack', async () => {
    const mover: UiPack = {
      id: 'mover',
      setup(ui) {
        ui.moveNavItem('core:bank', { group: 'tab', tabOrder: 5 });
        ui.removeWidget('testmod:figures');
      },
    };
    booted = await bootApp([coreUi, testmodUi, mover], genin(), '#/skill/tai');
    expect(q('a[data-tab="core:bank"], a[data-tab="bank"]')).not.toBeNull();
    expect(q('a[data-nav="bank"]')).toBeNull();
    expect(q('[data-testmod="figures"]')).toBeNull();
  });
});

describe('the observer costs little (A13)', () => {
  async function time(packs: UiPack[]): Promise<number> {
    const state = genin();
    booted = await bootApp(packs, state, '#/skill/tai');
    game.dispatch(START);
    flushSync();
    let best = Infinity;
    for (let rep = 0; rep < 2; rep++) {
      const start = performance.now();
      for (let i = 0; i < 200; i++) booted.advance(100);
      best = Math.min(best, performance.now() - start);
    }
    booted.destroy();
    booted = null;
    return best;
  }

  /** The best time of each set-up over alternating rounds, so that noise on the machine cancels out. */
  async function compare(loaded: UiPack[]): Promise<[number, number]> {
    await time([coreUi]);
    let without = Infinity;
    let withPack = Infinity;
    for (let round = 0; round < 5; round++) {
      // The order alternates: whatever the first run leaves behind (garbage, toasts) must not favour either.
      for (const isLoaded of round % 2 === 0 ? [false, true] : [true, false]) {
        const ms = await time(isLoaded ? loaded : [coreUi]);
        if (isLoaded) withPack = Math.min(withPack, ms);
        else without = Math.min(without, ms);
      }
    }
    return [without, withPack];
  }

  /** A pack that only injects a line into every action tile: the cost of observing and mounting. */
  const observerOnly: UiPack = {
    id: 'observer',
    start: (api) =>
      api.dom.observe({ part: 'action-tile' }, (el) => {
        const line = document.createElement('p');
        line.textContent = el.getAttribute('data-entity');
        el.append(line);
        return () => line.remove();
      }),
  };

  it(
    'the observer adds at most 20% to 200 store updates on the skill page',
    { timeout: 240_000, retry: 2 },
    async () => {
      const [without, withPack] = await compare([coreUi, observerOnly]);
      console.info(`observer: ${without.toFixed(1)} ms without, ${withPack.toFixed(1)} ms with`);
      expect(withPack).toBeLessThanOrEqual(without * 1.2);
    },
  );

  it(
    'the whole fixture, with its own computing, stays within +50% (it recounts XP rates on every update)',
    { timeout: 240_000, retry: 2 },
    async () => {
      const [without, withPack] = await compare([coreUi, testmodUi]);
      console.info(`fixture: ${without.toFixed(1)} ms without, ${withPack.toFixed(1)} ms with`);
      expect(withPack).toBeLessThanOrEqual(without * 1.5);
    },
  );
});
