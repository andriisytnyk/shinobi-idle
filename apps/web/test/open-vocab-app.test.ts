// @vitest-environment happy-dom
import { createState, syncVillage, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import PoiRow from '../src/components/PoiRow.svelte';
import { testmodUi } from '../dev-packs/testmod-ui.ts';
import { clearMissingKeys, missingKeys } from '../src/lib/i18n.ts';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

/*
 * T1. The game composed with the content pack `testmod` and its UI pack: every vocabulary and
 * entity the pack adds shows up in the interface with a name, an icon, a colour, a page and links,
 * without a line of interface code that knows about it.
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  const { composeBoot } = await import('../src/lib/boot.ts');
  const { testmodPack } = await import('@shinobi/content/testmod');
  const boot = composeBoot([testmodPack]);
  return {
    game: createGame({
      content: boot.content,
      rules: boot.rules,
      packs: boot.packs.map((p) => p.manifest),
      clock: { now: () => 0 },
    }),
  };
});

const SKILL = 'testmod:forge';
const NATURE = 'testmod:aether';
const TOKEN = 'testmod:token';
const RANK = 'testmod:adept';
const HUT = 'testmod:hut';
const CELL = 'testmod:grove_edge';
const POI = 'testmod:poi_grove_edge_outpost';
const RAW_KEY = /\b[a-z]+\.[a-z0-9_:.-]+\.(name|desc)\b/;

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];
const text = (sel: string) => q(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

/** A genin who stands in the first cell, with the village, and with some of everything the pack needs. */
function state(): GameState {
  const gs = createState(1, game.content);
  gs.player.name = 'Тест';
  gs.player.rank = 'genin';
  gs.bank['testmod:pellet'] = 10;
  gs.currencies[TOKEN] = 7;
  syncVillage(gs, game.content);
  return gs;
}

/** Every text node under the app root. */
function texts(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(booted?.target ?? document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (value !== '') out.push(value);
  }
  return out;
}

/** The raw keys and ids on the page: text nodes that look like a locale key or carry the pack prefix. */
const rawTexts = (): string[] => texts().filter((s) => RAW_KEY.test(s) || s.includes('testmod:'));

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
beforeEach(() => {
  localStorage.clear();
  clearMissingKeys();
});
afterEach(() => {
  booted?.destroy();
  booted = null;
});

const boot = (hash: string, gs: GameState = state()) => bootApp([coreUi, testmodUi], gs, hash);

describe('the app booted with core and testmod (T1)', () => {
  it('composes both packs', () => {
    expect(game.content.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
    expect(game.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
  });

  it('lists the skill in the sidebar under its group, with icon and level', async () => {
    booted = await boot('#/skills');
    const row = q(`[data-ui="skill-row"][data-entity="skill:${SKILL}"]`);
    expect(row).not.toBeNull();
    expect(row?.querySelector('svg.icon')).not.toBeNull();
    expect(row?.textContent).toMatch(/1/);
    expect(row?.textContent).toContain('Тестова кузня');
    // The row sits in the section of its group.
    const group = row?.closest('section.group');
    expect(group?.querySelector('.group-head')?.textContent?.trim()).toBe('Ремесла');
    expect(group?.querySelectorAll('[data-ui="skill-row"]').length).toBeGreaterThan(1);
  });

  it('opens the skill page with its action tile; the action starts and progresses', async () => {
    booted = await boot(`#/skill/${SKILL}`);
    expect(q(`[data-ui="entity-page"][data-entity="skill:${SKILL}"]`)).not.toBeNull();
    const tile = q('[data-ui="action-tile"][data-entity="recipe:testmod:elixir_brew"]');
    expect(tile).not.toBeNull();
    expect(tile?.textContent).toContain('Тестове варіння еліксиру');
    const start = tile?.querySelector<HTMLButtonElement>('button.ct-action:not([disabled])');
    expect(start).not.toBeNull();
    start?.click();
    flushSync();
    expect(game.state.slots[0]?.action?.id).toBe('testmod:elixir_brew');
    const before = game.state.skills[SKILL]?.xp ?? 0;
    booted.advance(60_000);
    expect(game.state.skills[SKILL]?.xp ?? 0).toBeGreaterThan(before);
    expect(game.state.bank['testmod:elixir'] ?? 0).toBeGreaterThan(0);
    expect(rawTexts()).toEqual([]);
  });

  it('shows the nature as a card with its colour token', async () => {
    booted = await boot('#/nature');
    const card = q(`[data-nature="${NATURE}"]`);
    expect(card).not.toBeNull();
    expect(card?.getAttribute('style')).toContain('--nature-color: var(--nature-testmod-aether)');
    expect(card?.textContent).toContain('Тестовий ефір');
    expect(card?.querySelector('svg.icon')).not.toBeNull();
    expect(rawTexts()).toEqual([]);
  });

  it('shows the currency in the top bar', async () => {
    booted = await boot('#/');
    const bar = q(`[data-ui="topbar-currency"][data-entity="currency:${TOKEN}"]`);
    expect(bar).not.toBeNull();
    expect(bar?.textContent).toContain('Тестовий жетон');
    expect(bar?.textContent).toContain('7');
    expect(bar?.querySelector('svg.icon')).not.toBeNull();
  });

  it('shows the rank on the rank page, and what it opens', async () => {
    booted = await boot('#/rank');
    const row = q(`[data-rank-row="${RANK}"]`);
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Тестовий адепт');
    expect(row?.getAttribute('data-state')).toBe('ahead');
    const link = row?.querySelector<HTMLAnchorElement>('a[href="#/mission/testmod:test_run"]');
    expect(link?.textContent).toBe('Тестове доручення');
    expect(rawTexts()).toEqual([]);
  });

  it('shows the requirement of the rank by its name on the mission page', async () => {
    booted = await boot('#/mission/testmod:test_run');
    expect(text('[data-ui="entity-page"] h1')).toContain('Тестове доручення');
    expect(text('[data-entity-req]')).toContain('Тестовий адепт');
    expect(rawTexts()).toEqual([]);
  });

  it('shows the building in the village and gives it a page', async () => {
    booted = await boot('#/village');
    const card = q(`[data-ui="building-card"][data-entity="building:${HUT}"]`);
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Тестова хатина');
    await booted.go(`#/building/${HUT}`);
    expect(text('[data-ui="entity-page"], [data-building-page]')).toContain('Тестова хатина');
    expect(rawTexts()).toEqual([]);
  });

  it('shows the region and the cell on the map, and the point of interest through its renderer', async () => {
    const gs = state();
    gs.world.explores[CELL] = game.content.balance.K.cellExplores[0] ?? 1;
    gs.world.pois[POI] = true;
    booted = await boot(`#/cell/${CELL}`, gs);
    expect(q(`[data-cell="${CELL}"]`)).not.toBeNull();
    expect(text(`[data-cell-panel="${CELL}"] [data-cell-title]`)).toBe('Край тестового гаю');
    const row = q(`[data-poi="${POI}"]`);
    expect(row?.textContent).toContain('Тестова застава');
    // The outpost renderer of the built-in game draws the line under the name.
    expect(row?.querySelector('svg.icon')).not.toBeNull();
    await booted.go('#/region/testmod:grove');
    expect(q('[data-region], [data-ui="world-cell"]')).not.toBeNull();
    expect(rawTexts()).toEqual([]);
  });

  it('draws a point of interest of a kind without a renderer generically: name, description, links', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const list = document.createElement('ul');
    target.append(list);
    const app = mount(PoiRow, {
      target: list,
      props: { poi: { id: POI, kind: 'beacon', building: HUT }, cell: CELL },
    });
    flushSync();
    const row = target.querySelector('[data-poi]');
    expect(row?.getAttribute('data-poi-kind')).toBe('beacon');
    expect(row?.textContent).toContain('Тестова застава');
    expect(row?.textContent).toContain('Beacon');
    expect(row?.querySelector('svg.icon')).not.toBeNull();
    expect(row?.querySelector('a[href="#/building/testmod:hut"]')?.textContent).toBe(
      'Тестова хатина',
    );
    void unmount(app);
    target.remove();
  });

  const PAGES: [name: string, hash: string, title: string][] = [
    ['item', '#/item/testmod:pellet', 'Тестова кулька'],
    ['recipe', '#/recipe/testmod:elixir_brew', 'Тестове варіння еліксиру'],
    ['gear', '#/gear/testmod:anvil', 'Тестова ковадла'],
    ['enemy', '#/enemy/testmod:shellback', 'Тестовий панцирник'],
    ['boss', '#/boss/testmod:boss_shell', 'Тестовий вартовий'],
    ['technique', '#/technique/testmod:ember_pulse', 'Тестовий імпульс жару'],
    ['quest', '#/quest/testmod:test_chain', 'Тестовий ланцюжок'],
    ['trait', '#/trait/testmod:shelled', 'Тестовий панцир'],
    ['status', '#/status/testmod:chill', 'Тестовий холод'],
  ];
  for (const [name, hash, title] of PAGES) {
    it(`opens the ${name} page by route, with its name and no raw keys`, async () => {
      booted = await boot(hash);
      expect(texts().some((s) => s.includes(title)), `${hash} shows «${title}»`).toBe(true);
      expect(q('main [data-not-found]')).toBeNull();
      expect(rawTexts()).toEqual([]);
    });
  }

  it('links the pages to each other', async () => {
    booted = await boot('#/item/testmod:pellet');
    const hrefs = (root: string) =>
      qa(`${root} a`).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs('main')).toContain('#/recipe/testmod:elixir_brew');
    await booted.go('#/recipe/testmod:elixir_brew');
    expect(hrefs('main')).toContain('#/item/testmod:pellet');
    expect(hrefs('main')).toContain('#/item/testmod:elixir');
    await booted.go('#/enemy/testmod:shellback');
    expect(hrefs('main')).toContain('#/item/testmod:pellet');
    expect(hrefs('main')).toContain('#/trait/testmod:shelled');
    await booted.go('#/technique/testmod:ember_pulse');
    expect(hrefs('main').some((h) => h.startsWith('#/skill/'))).toBe(true);
  });

  it('says that an unknown entity is not found, and does not crash', async () => {
    booted = await boot('#/enemy/testmod:nothing');
    expect(q('[data-not-found]')).not.toBeNull();
    expect(text('[data-not-found]')).toContain('Не знайдено');
    await booted.go('#/exercise/testmod:nothing');
    expect(q('[data-not-found]')).not.toBeNull();
  });

  it('keeps a log of the texts it had to stand in for, and shows none as a key', async () => {
    booted = await boot('#/enemy/testmod:shellback');
    for (const hash of PAGES.map((p) => p[1])) await booted.go(hash);
    expect(rawTexts()).toEqual([]);
    // Every missing text got a readable stand-in: nothing on the screen looks like the key it lacks.
    for (const key of missingKeys()) expect(texts().includes(key), key).toBe(false);
    settings.hints = false;
  });
});

