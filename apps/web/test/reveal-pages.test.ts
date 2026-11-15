// @vitest-environment happy-dom
import {
  createState,
  noteFight,
  noteSighting,
  refreshRegions,
  revealOf,
  syncVillage,
  updateQuests,
  xpAt,
  type GameState,
} from '@shinobi/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

/*
 * R1. The reveal rule in the interface. Every route `#/<kind>/<id>` of every core entity is opened
 * on a fresh save and on a save that has gone some way; what the rule hides is not in the page —
 * not the name, not the description, not the id — and what it shows by name only has no description.
 * A scripted run then collects every text the app prints and finds no name of an entity that is
 * still hidden (toasts, requirement trees, the links sections, the goal panel, the mission board,
 * the Now bar and the pages in between).
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

type Kind = { id: string; list: string | null };
type Entity = { kind: string; id: string };

const content = game.content;
const lists = content as unknown as Record<string, readonly { id: string }[] | undefined>;
const uk = content.locales.uk;

/** Every entity of the core pack, of every kind that has a page (a point of interest is nested in its cell). */
function allEntities(): Entity[] {
  const out: Entity[] = [];
  for (const kind of content.entityKinds as readonly Kind[]) {
    if (kind.list !== null)
      for (const e of lists[kind.list] ?? []) out.push({ kind: kind.id, id: e.id });
  }
  for (const cell of content.cells)
    for (const poi of cell.pois) out.push({ kind: 'poi', id: poi.id });
  return out;
}

/** The texts of an entity as the locale has them, whatever the reveal rule says. */
function textsOf({ kind, id }: Entity): { name: string; desc: string } {
  const kinds = kind === 'status' ? ['state', 'status'] : [kind];
  const pick = (field: string): string => {
    for (const k of kinds) {
      const text = uk[`${k}.${id}.${field}`];
      if (text) return text;
    }
    return '';
  };
  return { name: pick('name'), desc: pick(kind === 'cell' ? 'note' : 'desc') };
}

const freshState = (): GameState => {
  const state = createState(1, content);
  state.player.name = 'Тест';
  return state;
};

/** A genin with Scouting for the second region, three zone enemies fought, one boss beaten, two regions explored. */
function progressedState(): GameState {
  const state = freshState();
  state.player.rank = 'genin';
  state.skills.scout!.xp = xpAt(10);
  syncVillage(state, content);
  refreshRegions(state, content, true);
  updateQuests(state, content);
  const first = content.balance.K.cellExplores[0] ?? 1;
  for (const region of ['core:forest', 'core:plains']) {
    for (const cell of content.regions.find((r) => r.id === region)?.cells.slice(0, 3) ?? []) {
      state.world.explores[cell] = first;
      for (const poi of content.cells.find((c) => c.id === cell)?.pois ?? []) {
        state.world.pois[poi.id] = true;
      }
    }
  }
  for (const enemy of ['core:wolf', 'core:bandit', 'core:arsonist']) {
    noteSighting(state, enemy, content);
    noteFight(state, enemy, 'win', content);
  }
  noteSighting(state, 'core:boss_wolf', content);
  noteFight(state, 'core:boss_wolf', 'win', content);
  return state;
}

let booted: BootedApp | null = null;

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

/** Whether another text of the game (a client, a place named in a mission) is the very same words as this name. */
const bornElsewhere = (name: string, { kind, id }: Entity): boolean =>
  Object.entries(uk).some(([key, value]) => value === name && !key.startsWith(`${kind}.${id}.`));

/** The words around the first place a name occurs in a text, for a failure message. */
const snippet = (text: string, needle: string): string => {
  const at = text.indexOf(needle);
  return text.slice(Math.max(0, at - 60), at + needle.length + 60);
};

/** How many times a text occurs in another. */
const count = (haystack: string, needle: string): number =>
  needle === '' ? 0 : haystack.split(needle).length - 1;

/**
 * Opens every route of every entity and checks the page against the rule. `baseline` is the page the
 * app shows with no entity route open: what the chrome says anyway is not counted as a leak.
 */
async function walk(state: GameState): Promise<{ levels: Record<string, string[]> }> {
  booted = await bootApp([coreUi], state, '#/');
  const app = booted;
  const html = () => app.target.innerHTML;
  const text = () => app.target.textContent ?? '';
  const chromeText = text();
  const chromeHtml = html();
  const levels: Record<string, string[]> = { hidden: [], name: [], full: [] };
  const names = allEntities().map((e) => textsOf(e).name);
  for (const entity of allEntities()) {
    const level = revealOf(game.state, entity, content, game.rules);
    levels[level]!.push(`${entity.kind}:${entity.id}`);
    await app.go(`#/${entity.kind}/${encodeURIComponent(entity.id).replace(/%3A/gi, ':')}`);
    const { name, desc } = textsOf(entity);
    const here = `${entity.kind} ${entity.id} (${level})`;
    const page = text();
    if (level === 'hidden') {
      // Nothing: not the name (past what the chrome says), not the description, not the id.
      expect(app.target.querySelector('[data-not-revealed]'), here).not.toBeNull();
      expect(count(page, name), `${here}: name`).toBeLessThanOrEqual(count(chromeText, name));
      if (desc !== '') expect(page, `${here}: description`).not.toContain(desc);
      expect(count(html(), entity.id), `${here}: id`).toBeLessThanOrEqual(
        count(chromeHtml, entity.id),
      );
    } else if (level === 'name') {
      if (desc !== '') expect(page, `${here}: description`).not.toContain(desc);
    } else if (desc !== '' && names.filter((n) => n === name).length === 1) {
      // Shown in full, the page of an entity that has a page of its own says what it is.
      expect(app.target.querySelector('[data-not-revealed], [data-name-only]'), here).toBeNull();
    }
  }
  return { levels };
}

describe('every route of every core entity (R1, T2)', () => {
  it('on a fresh save: the hidden ones leak nothing, the ones shown by name have no description', async () => {
    const { levels } = await walk(freshState());
    expect(levels.hidden!.length).toBeGreaterThan(40);
    expect(levels.name!.length).toBeGreaterThan(40);
    expect(levels.hidden).toEqual(
      expect.arrayContaining(['boss:core:boss_ren2', 'region:core:valley', 'enemy:core:wolf']),
    );
  }, 300_000);

  it('after some progress: what has been met is shown, the rest still is not', async () => {
    const state = progressedState();
    const { levels } = await walk(state);
    expect(levels.full).toEqual(
      expect.arrayContaining([
        'enemy:core:wolf',
        'enemy:core:bandit',
        'boss:core:boss_wolf',
        'region:core:forest',
        'region:core:plains',
      ]),
    );
    // The next region is by name, the one after the plains is not; the last boss and enemies not met stay hidden.
    expect(levels.name).toContain('region:core:valley');
    expect(levels.hidden).toEqual(
      expect.arrayContaining([
        'boss:core:boss_ren2',
        'boss:core:boss_nameless',
        'enemy:core:hunter',
      ]),
    );
    expect(levels.full).not.toContain('boss:core:boss_ren2');
  }, 300_000);
});

describe('a name-only page still says what opens the entity', () => {
  it('shows the requirement of a mission the rank does not allow yet, and no description', async () => {
    booted = await bootApp([coreUi], freshState(), '#/mission/core:cat');
    const page = booted.target.querySelector('[data-name-only]');
    expect(page).not.toBeNull();
    expect(page?.querySelector('[data-entity-req]')).not.toBeNull();
    expect(page?.textContent).not.toContain(textsOf({ kind: 'mission', id: 'core:cat' }).desc);
  });
});

describe('what the app prints during a run (R1, T3)', () => {
  it('never prints the name of an entity that is still hidden', async () => {
    const state = freshState();
    booted = await bootApp([coreUi], state, '#/');
    const app = booted;
    let toastsSeen = 0;
    const seen: { at: string; text: string }[] = [];
    const collect = () => {
      const at = location.hash;
      seen.push({ at, text: app.target.textContent ?? '' });
      toastsSeen += app.target.querySelectorAll('[data-ui="toast"]').length;
      for (const el of app.target.querySelectorAll('[title], [aria-label]')) {
        seen.push({ at, text: el.getAttribute('title') ?? '' });
        seen.push({ at, text: el.getAttribute('aria-label') ?? '' });
      }
    };
    const pages = [
      '#/',
      '#/skills',
      '#/quests',
      '#/missions',
      '#/village',
      '#/world',
      '#/combat',
      '#/shop',
      '#/bank',
      '#/rank',
      '#/nature',
      '#/skill/tai',
      '#/skill/scout',
      '#/skill/alch',
      '#/skill/herb',
      '#/technique/core:great_fireball',
      '#/quest/core:graduation',
      '#/mission/core:cat',
      '#/enemy/core:dummy',
    ];
    const walkPages = async () => {
      for (const hash of pages) {
        await app.go(hash);
        collect();
      }
    };
    await walkPages();
    // Pin a goal so the goal panel names something, and let the game run so toasts and the Now bar speak.
    game.dispatch({ type: 'goal.set', ref: { kind: 'quest', id: 'core:graduation' } });
    game.dispatch({ type: 'action.start', slot: 0, kind: 'drill', id: content.exercises[0]!.id });
    for (let i = 0; i < 6; i++) {
      app.advance(600_000);
      collect();
    }
    // The run goes on as a genin with the world open; the pages are walked again.
    game.state.player.rank = 'genin';
    game.state.skills.scout!.xp = xpAt(10);
    app.advance(1000);
    for (const zone of ['core:zone_dummy']) {
      game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: zone });
    }
    for (let i = 0; i < 5; i++) {
      app.advance(120_000);
      collect();
    }
    await walkPages();

    expect(toastsSeen, 'the run made toasts').toBeGreaterThan(0);
    const shownNames = new Set(
      allEntities()
        .filter((e) => revealOf(game.state, e, content, game.rules) !== 'hidden')
        .map((e) => textsOf(e).name),
    );
    const hidden = allEntities().filter(
      (e) => revealOf(game.state, e, content, game.rules) === 'hidden',
    );
    expect(hidden.length).toBeGreaterThan(40);
    for (const entity of hidden) {
      const { name, desc } = textsOf(entity);
      // A name that a shown entity also bears (or a word of the chrome) is not told apart here.
      if (name.length < 4 || shownNames.has(name) || bornElsewhere(name, entity)) continue;
      for (const { at, text } of seen) {
        expect(
          text.includes(name) ? snippet(text, name) : '',
          `${entity.kind} ${entity.id} name on ${at}`,
        ).toBe('');
        if (desc.length > 20)
          expect(text.includes(desc), `${entity.kind} ${entity.id} desc on ${at}`).toBe(false);
      }
    }
  }, 300_000);
});
