// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { createState } from '@shinobi/core';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { ENTITY_PARTS, UI_PARTS } from '../src/lib/ext/parts.ts';
import { APP_ICON_CREDIT } from '../src/lib/credits.ts';
import { toasts } from '../src/lib/toasts.svelte.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, genin, type BootedApp } from './helpers/boot-app.ts';
import { coreRegistry } from './helpers/core-registry.ts';
import { setRevealDisabled } from '../src/lib/reveal.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

/**
 * The routes that existed before the registries, as patterns, written out by hand. The kinds whose details
 * became a sheet over a parent page (technique, item, recipe, gear, building) have no page of their own now:
 * their addresses are answered by the generic route and drawn as a sheet (see entity-sheets.test.ts).
 */
const ROUTES = [
  '#/',
  '#/:kind/*id',
  '#/bank',
  '#/cell/*id',
  '#/combat',
  '#/combat/bingo',
  '#/combat/prepare/:kind/*id',
  '#/combat/report',
  '#/credits',
  '#/exam/*id',
  '#/mission/*id',
  '#/help',
  '#/missions',
  '#/more',
  '#/nature',
  '#/poi/*id',
  '#/quest/*id',
  '#/quests',
  '#/rank',
  '#/region/*id',
  '#/settings',
  '#/shop',
  '#/shop/sell',
  '#/skill/*id',
  '#/skills',
  '#/village',
  '#/village/*focus',
  '#/world',
];

/** The nav items that existed before, with the hash each opens. */
const NAV: Record<string, string> = {
  skills: '#/skills',
  quests: '#/quests',
  missions: '#/missions',
  combat: '#/combat',
  world: '#/world',
  bank: '#/bank',
  shop: '#/shop',
  village: '#/village',
  rank: '#/rank',
  help: '#/help',
  more: '#/more',
};

const firstCell = content.cells[0];
const poi = content.cells.flatMap((c) => c.pois)[0];
/** One real hash for every registered page pattern. */
const SAMPLE: Record<string, string> = {
  'core:home': '#/',
  'core:entity': `#/enemy/${content.enemies[0]?.id}`,
  'core:entity.technique': `#/technique/${content.techniques[0]?.id}`,
  'core:entity.recipe': `#/recipe/${content.recipes[0]?.id}`,
  'core:entity.gear': `#/gear/${content.gear[0]?.id}`,
  'core:entity.building': `#/building/${content.buildings[0]?.id}`,
  'core:entity.item': `#/item/${content.items[0]?.id}`,
  'core:entity.quest': `#/quest/${content.quests[0]?.id}`,
  'core:entity.mission': `#/mission/${content.missions[0]?.id}`,
  'core:entity.exam': `#/exam/${content.exams[0]?.id}`,
  'core:entity.skill': '#/skill/tai',
  'core:entity.cell': `#/cell/${firstCell?.id}`,
  'core:entity.region': `#/region/${firstCell?.region}`,
  'core:entity.poi': `#/poi/${poi?.id}`,
  'core:village.focus': '#/village/core:forge',
  'core:combat.prepare': '#/combat/prepare/zone/core:zone_dummy',
};
/** The collection each entity kind lives in, to check that the sample hashes name real entities. */
const REAL: Record<string, readonly { id: string }[]> = {
  enemy: content.enemies,
  technique: content.techniques,
  recipe: content.recipes,
  gear: content.gear,
  building: content.buildings,
  item: content.items,
  quest: content.quests,
  mission: content.missions,
  exam: content.exams,
  cell: content.cells,
  region: content.regions,
  poi: content.cells.flatMap((c) => c.pois),
};
const sampleOf = (key: string, route: string): string => SAMPLE[key] ?? route;

let booted: BootedApp | null = null;
const errors: unknown[][] = [];

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  vi.restoreAllMocks();
});

describe('the built-in game through the registries', () => {
  it('uses sample hashes that name real entities', () => {
    for (const hash of Object.values(SAMPLE)) {
      const [, kind = '', ...rest] = hash.split('/');
      const list = REAL[kind];
      if (!list) continue;
      const id = decodeURIComponent(rest.join('/'));
      expect(
        list.some((e) => e.id === id),
        hash,
      ).toBe(true);
    }
    expect(Object.keys(REAL).length).toBeGreaterThan(5);
  });

  it('registers exactly the routes that existed before', () => {
    expect(coreRegistry.pages.map((p) => p.route).sort()).toEqual([...ROUTES].sort());
  });

  it('registers the nav items that existed before, with the same targets', () => {
    expect(Object.fromEntries(coreRegistry.navItems.map((n) => [n.id, n.route]))).toEqual(NAV);
  });

  it('opens every registered page without console errors, under the same hash', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args));
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => void errors.push(args));
    errors.length = 0;
    // Every page of the registry opens, whatever the player has discovered: the reveal rule is switched off here.
    setRevealDisabled(true);
    booted = await bootApp([coreUi]);
    for (const page of coreRegistry.pages) {
      const hash = sampleOf(page.key, page.route);
      expect(hash, page.key).not.toContain('undefined');
      await booted.go(hash);
      expect(location.hash).toBe(hash);
      const root = booted.target.querySelector('[data-ui="page"]');
      expect(root?.getAttribute('data-page'), hash).toBe(page.key);
      expect(root?.children.length, `${hash} drew nothing`).toBeGreaterThan(0);
    }
    setRevealDisabled(false);
    spy.mockRestore();
    warn.mockRestore();
    expect(errors).toEqual([]);
  });

  it('opens every nav item from the sidebar and the tab bar', async () => {
    booted = await bootApp([coreUi]);
    const links = [...booted.target.querySelectorAll<HTMLAnchorElement>('a[data-ui="nav-item"]')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const id = link.dataset.nav ?? link.dataset.tab ?? '';
      expect(link.getAttribute('href'), id).toBe(NAV[id]);
    }
    for (const [id, hash] of Object.entries(NAV)) {
      await booted.go(hash);
      expect(booted.target.querySelector('[data-ui="page"]'), id).not.toBeNull();
    }
  });

  it('falls back to the generic page for an unknown kind and shows not-found for nonsense', async () => {
    booted = await bootApp([coreUi]);
    await booted.go('#/enemy/core:dummy');
    expect(
      booted.target.querySelector('[data-ui="entity-page"]')?.getAttribute('data-entity'),
    ).toBe('enemy:core:dummy');
    await booted.go('#/nothing/here');
    expect(booted.target.querySelector('[data-ui="page"]')).toBeNull();
    expect(booted.target.textContent).toContain('Такої сторінки немає');
  });
});

describe('sections registered by the built-in pack', () => {
  it('shows the application section on the settings page in a plain browser', async () => {
    booted = await bootApp([coreUi], genin(), '#/settings');
    const section = booted.target.querySelector(
      '[data-ui-widget="core:pwa"] [data-ui="pwa-section"]',
    );
    expect(section).not.toBeNull();
    expect(section?.querySelector('[data-pwa-panel] h3')?.textContent).toBe('Застосунок');
    expect(section?.querySelector('[data-pwa-version]')?.textContent).toMatch(/Версія .+ збірка/);
    // Nothing to install or update in a browser tab that is not an installed app.
    expect(section?.querySelector('[data-pwa-install]')).toBeNull();
    expect(section?.querySelector('[data-pwa-apply]')).toBeNull();
  });

  it('credits the application icon on the credits page', async () => {
    booted = await bootApp([coreUi], genin(), '#/credits');
    const block = booted.target.querySelector('[data-app-icon-credit]');
    expect(block?.textContent).toContain(APP_ICON_CREDIT.icon);
    expect(block?.textContent).toContain(APP_ICON_CREDIT.author);
    expect(block?.querySelector('a')?.getAttribute('href')).toBe(APP_ICON_CREDIT.url);
  });

  it('puts the toast part on toasts, and the persistent one keeps its alert role', async () => {
    booted = await bootApp([coreUi]);
    toasts.push({ key: 'toast.mod', params: { text: 'тост' } });
    flushSync();
    expect(booted.target.querySelector('[data-ui="toast"]')?.textContent).toContain('тост');
  });
});

describe('stable anchors (D11)', () => {
  it('every data-ui is a known part and entity-bound parts have data-entity', async () => {
    const state = genin();
    state.bank['core:mint'] = 3;
    state.skills.tai!.xp = 500;
    booted = await bootApp([coreUi], state);
    game.dispatch({ type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' });
    const seen = new Set<string>();
    const hashes = [
      '#/skill/tai',
      '#/skill/alch',
      '#/skill/herb',
      '#/recipe/' + content.recipes[0]?.id,
      '#/technique/core:leaf_whirlwind',
      '#/shop',
      '#/bank',
      '#/village',
      '#/building/core:forge',
      '#/world',
      `#/cell/${firstCell?.id}`,
      '#/settings',
      '#/quests',
      '#/enemy/core:dummy',
    ];
    for (const hash of hashes) {
      await booted.go(hash);
      for (const el of booted.target.querySelectorAll('[data-ui]')) {
        const part = el.getAttribute('data-ui') ?? '';
        seen.add(part);
        expect(UI_PARTS as readonly string[], `${hash}: ${part}`).toContain(part);
        if ((ENTITY_PARTS as readonly string[]).includes(part)) {
          expect(el.getAttribute('data-entity'), `${hash}: ${part}`).toMatch(/^[a-z]+:.+/);
        }
      }
    }
    // Parts that the walk is expected to have met somewhere.
    for (const part of [
      'page',
      'nav-item',
      'skill-row',
      'action-tile',
      'action-xp',
      'action-interval',
      'action-progress',
      'mastery-ring',
      'pool-bar',
      'req-row',
      'now-slot',
      'goal-panel',
      'entity-page',
      'entity-header',
      'entity-section',
      'ingredient-row',
      'shop-good',
      'bank-item',
      'building-card',
      'map',
      'hex',
      'hex-panel',
      'topbar-currency',
    ]) {
      expect(seen, part).toContain(part);
    }
    const slot = booted.target.querySelector('[data-ui="now-slot"]');
    expect(slot?.getAttribute('data-slot-index')).toBe('0');
  });

  it('puts a modal part on dialogs', async () => {
    const state = createState(1, content);
    booted = await bootApp([coreUi], state);
    expect(booted.target.querySelector('[data-ui="modal"]')).not.toBeNull();
  });

  it('shows no pack content when only the built-in pack runs', async () => {
    booted = await bootApp([coreUi], genin(), '#/skill/tai');
    expect(booted.target.innerHTML).not.toContain('x.testmod.');
    expect(booted.target.querySelector('[data-ui-widget]')).toBeNull();
    expect(booted.target.querySelector('[data-ui="theme-select"]')).toBeNull();
  });
});
