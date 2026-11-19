// @vitest-environment happy-dom
import { createState, syncVillage, type GameState } from '@shinobi/core';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import type { UiPack } from '../src/lib/ext/types.ts';
import { setRevealDisabled } from '../src/lib/reveal.ts';
import { sheetParents } from '../src/lib/sheet-parents.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

/*
 * W1. The details of a leaf entity open as a sheet over its parent page: `#/<kind>/<id>` draws the
 * parent page with the sheet open and the entity's tile highlighted; the pages that stay pages get a
 * breadcrumb; a kind a pack gives a parent opens as a sheet, one without a parent keeps the generic page.
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const content = game.content;
let booted: BootedApp | null = null;

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  setRevealDisabled(false);
});

const q = <T extends Element = HTMLElement>(sel: string): T | null =>
  booted?.target.querySelector<T>(sel) ?? null;

/** A genin who has seen everything: the reveal rule is not what these tests are about. */
function open(): GameState {
  const state = createState(1, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  syncVillage(state, content);
  return state;
}

const tile = (sel = '[data-highlighted]') => q(sel);
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every former page of a leaf entity, with the page it now opens over. */
const CASES: { kind: string; id: string; page: string; parent: string }[] = [
  {
    kind: 'technique',
    id: 'core:great_fireball',
    page: 'core:entity.skill',
    parent: '#/skill/katon',
  },
  { kind: 'recipe', id: content.recipes[0]?.id ?? '', page: 'core:entity.skill', parent: '' },
  { kind: 'item', id: 'core:mint', page: 'core:entity.skill', parent: '#/skill/herb' },
  { kind: 'gear', id: content.gear[0]?.id ?? '', page: 'core:shop', parent: '#/shop' },
  { kind: 'building', id: 'core:forge', page: 'core:village', parent: '#/village' },
  { kind: 'exercise', id: content.exercises[0]?.id ?? '', page: 'core:entity.skill', parent: '' },
  { kind: 'practice', id: content.practices[0]?.id ?? '', page: 'core:entity.skill', parent: '' },
  { kind: 'obstacle', id: content.obstacles[0]?.id ?? '', page: 'core:entity.skill', parent: '' },
];

describe('the parent of each kind', () => {
  it('is the page of the skill for techniques, exercises, practices, obstacles and recipes', () => {
    expect(sheetParents.technique('core:great_fireball', content)).toBe('#/skill/katon');
    const recipe = content.recipes[0];
    expect(sheetParents.recipe(recipe?.id ?? '', content)).toBe(`#/skill/${recipe?.skill}`);
    expect(sheetParents.exercise(content.exercises[0]?.id ?? '', content)).toMatch(/^#\/skill\//);
    expect(sheetParents.practice(content.practices[0]?.id ?? '', content)).toMatch(/^#\/skill\//);
    expect(sheetParents.obstacle(content.obstacles[0]?.id ?? '', content)).toMatch(/^#\/skill\//);
  });

  it('is the gathering skill for a herb and the bank for any other item', () => {
    expect(sheetParents.item('core:mint', content)).toBe('#/skill/herb');
    const plain = content.items.find((i) => !content.herbs.some((h) => h.id === i.id));
    expect(sheetParents.item(plain?.id ?? '', content)).toBe('#/bank');
  });

  it('is nothing for an id the content does not have', () => {
    expect(sheetParents.technique('core:nope', content)).toBeNull();
    expect(sheetParents.recipe('core:nope', content)).toBeNull();
  });
});

describe('a leaf entity opens over its parent with the tile highlighted', () => {
  for (const c of CASES) {
    it(`${c.kind} ${c.id}`, async () => {
      setRevealDisabled(true);
      booted = await bootApp([coreUi], open(), `#/${c.kind}/${c.id}`);
      await wait();
      flushSync();
      const sheet = q('[data-ui="sheet"]');
      expect(sheet, 'the sheet is open').not.toBeNull();
      expect(sheet?.getAttribute('data-entity')).toBe(`${c.kind}:${c.id}`);
      expect(sheet?.getAttribute('role')).toBe('dialog');
      expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe(c.page);
      if (c.parent) expect(booted.target.querySelector(`[data-page="${c.page}"]`)).not.toBeNull();
      // The details are in the sheet, not on a page of their own.
      expect(sheet?.querySelector('[data-ui="entity-page"]')).not.toBeNull();
      const marked = tile();
      expect(marked, 'a tile is highlighted').not.toBeNull();
      expect(marked?.getAttribute('data-entity')).toBe(`${c.kind}:${c.id}`);
      expect(sheet?.contains(marked)).toBe(false);
    });
  }
});

describe('closing the sheet', () => {
  it('Escape and the close control leave the parent page and take the highlight away', async () => {
    setRevealDisabled(true);
    booted = await bootApp([coreUi], open(), '#/skill/katon');
    await booted.go('#/technique/core:great_fireball');
    expect(q('[data-ui="sheet"]')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait();
    flushSync();
    expect(location.hash).toBe('#/skill/katon');
    expect(q('[data-ui="sheet"]')).toBeNull();
    expect(tile()).toBeNull();
    expect(q('[data-page="core:entity.skill"]')).not.toBeNull();

    await booted.go('#/item/core:mint');
    expect(q('[data-ui="sheet"]')).not.toBeNull();
    q('[data-sheet-close]')?.click();
    await wait();
    flushSync();
    expect(q('[data-ui="sheet"]')).toBeNull();
    expect(location.hash).toBe('#/skill/herb');
  });

  it('the browser Back button closes it and stays on the parent', async () => {
    setRevealDisabled(true);
    booted = await bootApp([coreUi], open(), '#/skill/katon');
    await booted.go('#/technique/core:great_fireball');
    expect(q('[data-ui="sheet"]')).not.toBeNull();
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync();
    expect(location.hash).toBe('#/skill/katon');
    expect(q('[data-ui="sheet"]')).toBeNull();
    expect(q('[data-page="core:entity.skill"]')).not.toBeNull();
  });

  it('does not rebuild the parent page when the sheet opens and closes', async () => {
    setRevealDisabled(true);
    booted = await bootApp([coreUi], open(), '#/skill/katon');
    const page = q('[data-ui="entity-page"][data-entity="skill:katon"]');
    expect(page).not.toBeNull();
    await booted.go('#/technique/core:great_fireball');
    expect(q('[data-ui="entity-page"][data-entity="skill:katon"]')).toBe(page);
    q('[data-sheet-close]')?.click();
    await wait();
    flushSync();
    expect(q('[data-ui="entity-page"][data-entity="skill:katon"]')).toBe(page);
  });
});

describe('focus', () => {
  it('moves into the sheet, stays there on Tab, and returns to the opener on close', async () => {
    setRevealDisabled(true);
    booted = await bootApp([coreUi], open(), '#/skill/katon');
    const opener = q<HTMLAnchorElement>(
      '[data-entity="technique:core:great_fireball"] a[href="#/technique/core:great_fireball"]',
    );
    expect(opener, 'the tile title is a link to the technique').not.toBeNull();
    opener?.focus();
    await booted.go('#/technique/core:great_fireball');
    const sheet = q('[data-ui="sheet"]');
    flushSync();
    expect(sheet?.contains(document.activeElement)).toBe(true);

    const items = [...(sheet?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
    const last = items[items.length - 1];
    last?.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait();
    flushSync();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves Tab and Escape to a modal drawn above the sheet', async () => {
    setRevealDisabled(true);
    booted = await bootApp([coreUi], open(), '#/skill/katon');
    await booted.go('#/technique/core:great_fireball');
    flushSync();
    const modal = document.createElement('div');
    modal.setAttribute('data-ui', 'modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const input = document.createElement('input');
    modal.append(input, document.createElement('button'));
    document.body.append(modal);
    try {
      input.focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      input.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait();
      flushSync();
      expect(q('[data-ui="sheet"]'), 'Escape in the modal does not close the sheet').not.toBeNull();
    } finally {
      modal.remove();
    }
  });

  it('a second Escape before the first close lands does not leave the parent page', async () => {
    setRevealDisabled(true);
    booted = await bootApp([coreUi], open(), '#/skill/katon');
    await booted.go('#/technique/core:great_fireball');
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync();
    expect(location.hash).toBe('#/skill/katon');
    expect(q('[data-ui="sheet"]')).toBeNull();
  });
});

describe('the pack slots and kinds', () => {
  it('draws the widgets of entity.sections inside the sheet', async () => {
    setRevealDisabled(true);
    const pack: UiPack = {
      id: 'sec',
      setup(ui) {
        ui.addWidget('entity.sections', (el, _api, ctx) => {
          const mark = document.createElement('p');
          mark.setAttribute('data-sec', `${ctx.ref.kind}:${ctx.ref.id}`);
          el.append(mark);
        });
      },
    };
    booted = await bootApp([coreUi, pack], open(), '#/technique/core:great_fireball');
    await wait();
    flushSync();
    const mark = q('[data-sec]');
    expect(mark?.getAttribute('data-sec')).toBe('technique:core:great_fireball');
    expect(q('[data-ui="sheet"]')?.contains(mark)).toBe(true);
  });

  it('opens a kind that a pack gave a parent as a sheet, and the others as the generic page', async () => {
    setRevealDisabled(true);
    const pack: UiPack = {
      id: 'kinds',
      setup(ui) {
        ui.addSheet('status', { parent: '#/rank' });
      },
    };
    booted = await bootApp([coreUi, pack], open(), '#/status/burn');
    await wait();
    flushSync();
    expect(q('[data-ui="sheet"]')?.getAttribute('data-entity')).toBe('status:burn');
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:rank');
    expect(q('[data-ui="breadcrumb"]')).toBeNull();

    // A kind with no parent keeps the generic page, with a breadcrumb.
    await booted.go('#/combo/fanBurn');
    expect(q('[data-ui="sheet"]')).toBeNull();
    expect(q('[data-page="core:entity"]')).not.toBeNull();
    const crumbs = q('[data-ui="breadcrumb"]');
    expect(crumbs).not.toBeNull();
    expect(crumbs?.querySelector('a')?.getAttribute('href')).toBe('#/');
  });

  it('a computed parent that returns nothing falls back to the home of the kind', async () => {
    setRevealDisabled(true);
    const pack: UiPack = {
      id: 'home',
      setup(ui) {
        ui.addSheet('status', { parent: () => null, home: '#/bank' });
      },
    };
    booted = await bootApp([coreUi, pack], open(), '#/status/burn');
    await wait();
    flushSync();
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:bank');
    expect(q('[data-ui="sheet"]')).not.toBeNull();
  });

  it('refuses a computed parent without a home', () => {
    const pack: UiPack = {
      id: 'bad',
      setup(ui) {
        ui.addSheet('status', { parent: () => '#/bank' });
      },
    };
    return bootApp([coreUi, pack], open(), '#/').then((app) => {
      booted = app;
      expect(app.ui.registry.disabled.map((d) => d.packId)).toContain('bad');
    });
  });
});

describe('breadcrumbs on the pages that stay', () => {
  it('a mission page has the section of the board above it', async () => {
    setRevealDisabled(true);
    const id = content.missions[0]?.id ?? '';
    booted = await bootApp([coreUi], open(), `#/mission/${id}`);
    await wait();
    flushSync();
    const crumbs = q('[data-ui="breadcrumb"]');
    expect(crumbs).not.toBeNull();
    expect(crumbs?.querySelector('a')?.getAttribute('href')).toBe('#/missions');
    expect(crumbs?.textContent).toContain('Місії');
    expect(q('[data-ui="sheet"]')).toBeNull();
  });

  it('has none on the pages of a section, on the map or on a sheet', async () => {
    booted = await bootApp([coreUi], open(), '#/missions');
    expect(q('[data-ui="breadcrumb"]')).toBeNull();
    await booted.go('#/skill/katon');
    expect(q('[data-ui="breadcrumb"]')).toBeNull();
  });
});

describe('the reveal rule carries over', () => {
  it('a hidden entity opens the parent of its kind with the not-revealed sheet and no id in the page', async () => {
    const state = open();
    booted = await bootApp([coreUi], state, '#/item/core:nope_not_there');
    await wait();
    flushSync();
    expect(q('[data-ui="sheet"] [data-not-revealed]')).not.toBeNull();
    expect(q('[data-ui="sheet"]')?.hasAttribute('data-entity')).toBe(false);
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:bank');
    expect(booted.target.innerHTML).not.toContain('nope_not_there');
    expect(tile()).toBeNull();
  });

  it('a hidden technique opens over the skill list, not over the page of its skill', async () => {
    // Every technique of the slice is offered by its skill page, so none is hidden from a fresh
    // student; an id the player cannot know stands for a hidden one (its real parent would leak it).
    const hidden = { id: 'core:nope_hidden_tech' };
    booted = await bootApp([coreUi], open(), `#/technique/${hidden.id}`);
    await wait();
    flushSync();
    const sheet = q('[data-ui="sheet"]');
    expect(sheet).not.toBeNull();
    expect(
      sheet?.querySelector('[data-not-revealed]'),
      'the technique is not revealed',
    ).not.toBeNull();
    expect(q('[data-ui="page"]')?.getAttribute('data-page')).toBe('core:skills');
    expect(booted.target.innerHTML).not.toContain('nope_hidden_tech');
  });
});
