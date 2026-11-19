// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { dispatch, growSlots, MISSION_KIND, createState, syncVillage } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import CrashScreen from '../src/components/CrashScreen.svelte';
import ReqTree from '../src/components/ReqTree.svelte';
import { actionRef, fightTargetRef, masteryRef } from '../src/lib/entities.ts';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { highlightTile } from '../src/lib/ext/highlight.ts';
import { actionEntity } from '../src/lib/missions.ts';
import { t } from '../src/lib/i18n.ts';
import { setRevealDisabled } from '../src/lib/reveal.ts';
import { game } from '../src/lib/store.ts';
import { toasts } from '../src/lib/toasts.svelte.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { able, player } from './helpers/missions.ts';

/*
 * W2. The small UI problems of the review leftovers: the names a zone fight shows, the sheets, the
 * focus, the goal panel on a phone, the hint wording of a clone.
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  toasts.clear();
  setRevealDisabled(false);
});

describe('a zone fight is named by its enemy', () => {
  it('maps a fight whose id is a zone to the enemy of the zone, not to an «enemy» of the zone id', () => {
    const zone = content.zones.find((z) => z.id === 'core:zone_wolfmask');
    expect(zone).toBeDefined();
    expect(actionRef({ kind: 'fight', id: 'core:zone_wolfmask' })).toEqual({
      kind: 'enemy',
      id: zone?.enemy,
    });
    expect(actionEntity({ kind: 'fight', id: 'core:zone_wolfmask' })).toEqual({
      kind: 'enemy',
      id: zone?.enemy,
    });
  });

  it('gives a boss zone the boss kind and keeps an unknown id as an enemy id', () => {
    const boss = content.zones.find((z) => z.region === 'boss');
    expect(boss).toBeDefined();
    expect(fightTargetRef(boss?.id ?? '')).toEqual({ kind: 'boss', id: boss?.enemy });
    expect(fightTargetRef('core:nope')).toBeNull();
    expect(actionEntity({ kind: 'fight', id: 'core:wolf' })).toEqual({
      kind: 'enemy',
      id: 'core:wolf',
    });
  });

  it('shows the enemy name in the Now bar for a zone fight', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/skills');
    const result = dispatch(
      game.state,
      { type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_dummy' },
      content,
    );
    expect(result.ok).toBe(true);
    booted.advance(1);
    const text = q('[data-ui="now-slot"]')?.textContent ?? '';
    expect(text).toContain(t('enemy.core:dummy.name'));
    expect(text).not.toMatch(/Zone/i);
  });
});

describe('a mastery is named by what it belongs to', () => {
  it('sends gathering and crafting masteries to the item and the recipe, not to a technique', () => {
    const recipe = content.recipes[0];
    expect(masteryRef('core:mint', content)).toEqual({ kind: 'item', id: 'core:mint' });
    expect(masteryRef(recipe?.id ?? '', content)).toEqual({ kind: 'recipe', id: recipe?.id });
    const technique = content.techniques[0];
    expect(masteryRef(technique?.id ?? '', content)).toEqual({
      kind: 'technique',
      id: technique?.id,
    });
  });
});

describe('the highlight of a tile', () => {
  it('marks a tile that is drawn again after the first mark', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const make = () => {
      const el = document.createElement('li');
      el.setAttribute('data-entity', 'item:core:mint');
      return el;
    };
    const first = make();
    root.append(first);
    const stop = highlightTile(root, 'item:core:mint');
    expect(first.hasAttribute('data-highlighted')).toBe(true);
    // The list is drawn again: the old tile leaves, a new one takes its place.
    first.remove();
    const second = make();
    root.append(second);
    await wait();
    expect(second.hasAttribute('data-highlighted')).toBe(true);
    stop();
    expect(second.hasAttribute('data-highlighted')).toBe(false);
    root.remove();
  });
});

describe('the technique sheet', () => {
  it('writes «Перериває (проти: …)» with no stray spaces', async () => {
    setRevealDisabled(true);
    const withTraits = content.techniques.find((tech) =>
      tech.tags.some((tag) => content.traits.some((trait) => trait.answer === tag)),
    );
    expect(withTraits).toBeDefined();
    const state = able();
    syncVillage(state, content);
    booted = await bootApp([coreUi], state, `#/technique/${withTraits?.id}`);
    await wait();
    flushSync();
    const dd = [...(booted.target.querySelectorAll('dt') ?? [])].find(
      (el) => el.textContent?.trim() === t('technique.answers'),
    )?.nextElementSibling;
    const text = (dd?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toMatch(/\S \(.+:\s?\S[^)]*\S\)/);
    expect(text).not.toMatch(/\( /);
    expect(text).not.toMatch(/ \)/);
    expect(text).not.toMatch(/\S\(/);
    expect(text).not.toMatch(/ ,/);
  });
});

describe('the building sheet', () => {
  it('says the name of the building once', async () => {
    setRevealDisabled(true);
    const state = createState(1, content);
    state.player.name = 'Тест';
    state.player.rank = 'genin';
    syncVillage(state, content);
    booted = await bootApp([coreUi], state, '#/building/core:forge');
    await wait();
    flushSync();
    const sheet = q('[data-ui="sheet"]');
    expect(sheet).not.toBeNull();
    const name = t('building.core:forge.name');
    const mentions = (sheet?.textContent ?? '').split(name).length - 1;
    // The title, and the description may use the word; the card header must not repeat it.
    expect(sheet?.querySelectorAll('h1, h2, h3')).toBeDefined();
    const headings = [...(sheet?.querySelectorAll('h1, h3') ?? [])].filter(
      (h) => h.textContent?.trim() === name,
    );
    expect(headings.length).toBe(1);
    expect(mentions).toBeGreaterThanOrEqual(1);
    expect(sheet?.querySelector('[data-name]')).toBeNull();
  });
});

describe('the crash screen', () => {
  it('moves the focus to its title', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const app = mount(CrashScreen, { target });
    flushSync();
    await wait();
    flushSync();
    expect(document.activeElement).toBe(target.querySelector('h1'));
    unmount(app);
    target.remove();
  });
});

describe('the goal panel on a phone', () => {
  it('closes when the player follows a link to another page', async () => {
    const matches = (query: string) => query.includes('max-width: 768px');
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: matches(query),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    try {
      booted = await bootApp([coreUi], able(), '#/skills');
      // On a phone the panel starts closed; the top bar opens it.
      expect(q('.meta')).toBeNull();
      const open = q('button.meta-toggle');
      expect(open).not.toBeNull();
      (open as HTMLButtonElement).click();
      flushSync();
      expect(q('.meta')).not.toBeNull();
      await booted.go('#/bank');
      expect(q('.meta')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('a requirement about a point that is only veiled', () => {
  it('says «???» and the vague hint of the place', async () => {
    const valley = 'core:valley_of_the_end';
    const place = content.places.find((p) => p.id === valley);
    expect(place).toBeDefined();
    const state = player();
    const hex = `${place?.hex[0]},${place?.hex[1]}`;
    const cell = content.cells.find((c) => `${c.hex[0]},${c.hex[1]}` === hex)?.id;
    if (cell) state.world.explores[cell] = content.balance.K.cellExplores[0] ?? 0;
    state.world.surveyed[hex] = true;
    game.replaceState(state);
    const target = document.createElement('div');
    document.body.append(target);
    const node = {
      req: { t: 'flag' as const, id: `point.${valley}` },
      met: false,
      current: 0,
      target: 1,
      ref: null,
      children: [],
    };
    const app = mount(ReqTree, { target, props: { node } });
    flushSync();
    expect(target.textContent).toContain(t('req.pointHidden'));
    expect(target.querySelector('[data-point-req-hint]')?.textContent).toBe(
      t(`place.${valley}.hint`),
    );
    // A point nothing is known of keeps both the name and the hint to itself.
    game.replaceState(player());
    flushSync();
    expect(target.querySelector('[data-point-req-hint]')).toBeNull();
    unmount(app);
    target.remove();
  });
});

describe('a clone that runs a mission', () => {
  it('is named as the clone in the Now bar, not as «Ти»', async () => {
    const state = able();
    growSlots(state, content);
    booted = await bootApp([coreUi], state, '#/skills');
    const result = dispatch(
      game.state,
      { type: 'action.start', slot: 1, kind: MISSION_KIND, id: 'core:cat' },
      content,
    );
    expect(result.ok).toBe(true);
    booted.advance(1);
    expect(q('[data-slot="1"] [data-now-who="self"]')?.textContent?.trim()).toBe(
      t('mission.who.clone'),
    );
  });
});

describe('a clone and a fight held by the character', () => {
  it('is not refused for the fight: every performer has a fight of its own', async () => {
    const state = able();
    growSlots(state, content);
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:thief' },
      content,
    );
    booted = await bootApp([coreUi], state, '#/mission/core:caravan');
    expect(q('[data-clone-why]')).toBeNull();
    (q('[data-mission-actions] [data-ui="start-split"] .chevron') as HTMLButtonElement).click();
    flushSync();
    const button = q('[data-mission-actions] [data-ui="clone-start"]') as HTMLButtonElement | null;
    expect(button?.disabled).toBe(false);
  });
});
