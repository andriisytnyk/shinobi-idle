// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, xpAt, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ScoutPanel from '../src/components/ScoutPanel.svelte';
import { masteryRef } from '../src/lib/entities.ts';
import { MASK } from '../src/lib/reveal.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import WorldPage from '../src/pages/WorldPage.svelte';
import { coreContext } from './helpers/core-registry.ts';

const RUINS = 'core:war_fort_ruins';
const SEARCH = 'core:search_war_fort_ruins';
const SULPHUR = 'core:gather_hell_valley_sulphur';
const FIRST = content.balance.K.cellExplores[0] ?? 0;

const name = (key: string): string => ukLocale[key] ?? key;
const place = content.places.find((p) => p.id === RUINS)!;
const coord = `${place.hex[0]},${place.hex[1]}`;

function genin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  return state;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;
const q = (selector: string) => target.querySelector<HTMLElement>(selector);

beforeEach(() => {
  settings.hints = false;
  target = document.createElement('div');
  document.body.append(target);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
});

const showScout = (): void => {
  app = mount(ScoutPanel, { target, context: coreContext(), props: { skill: 'scout' } });
  flushSync();
};

describe('the work that found points open, on the Scouting page', () => {
  it('lists both works, locked and unnamed while their points are not found', () => {
    game.replaceState(genin());
    showScout();
    const tiles = [...target.querySelectorAll('[data-scout-works] [data-ui="action-tile"]')];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.classList.contains('locked')).toBe(true);
      expect(tile.textContent).toContain(MASK);
    }
    // The reveal rule: nothing of the places or the works leaks into the page.
    expect(target.innerHTML).not.toContain('war_fort_ruins');
    expect(target.innerHTML).not.toContain('hell_valley');
    expect(target.textContent).not.toContain(name(`fieldwork.${SEARCH}.name`));
  });

  it('opens the ruin search once the point is found and the level is there', () => {
    const state = genin();
    state.skills.scout = { xp: xpAt(10) };
    state.world.pois[RUINS] = true;
    game.replaceState(state);
    showScout();
    const tile = q(`[data-action="${SEARCH}"]`);
    expect(tile).not.toBeNull();
    expect(tile?.classList.contains('locked')).toBe(false);
    expect(tile?.textContent).toContain(name(`fieldwork.${SEARCH}.name`));
    // The deposit of Hell Valley is still locked, and still unnamed.
    const other = q(`[data-action="${SULPHUR}"]`);
    expect(other).toBeNull();
    expect(target.textContent).not.toContain(name(`fieldwork.${SULPHUR}.name`));
  });
});

describe('the point on the map says what it opens', () => {
  const openHex = (state: GameState): void => {
    const cell = content.cells.find((c) => `${c.hex[0]},${c.hex[1]}` === coord);
    if (cell) state.world.explores[cell.id] = FIRST;
    state.world.surveyed[coord] = true;
    game.replaceState(state);
    app = mount(WorldPage, {
      target,
      context: coreContext(),
      props: { focus: { cell: null, region: 'core:forest' } },
    });
    flushSync();
    q(`[data-ui="hex"][data-hex="${coord}"]`)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    flushSync();
  };

  it('masks the work exactly while the Scouting tile masks it, then links it', () => {
    const state = genin();
    openHex(state);
    const opens = q('[data-point-opens]');
    expect(opens?.textContent).toContain(name('map.point.opens'));
    expect(opens?.querySelector('[data-masked]')).not.toBeNull();
    expect(opens?.textContent).not.toContain(name(`fieldwork.${SEARCH}.name`));
    unmount(app!);
    app = null;
    target.replaceChildren();
    const found = genin();
    found.world.pois[RUINS] = true;
    openHex(found);
    const link = q('[data-point-opens] a');
    expect(link?.getAttribute('href')).toBe(`#/fieldwork/${SEARCH}`);
    expect(link?.textContent).toContain(name(`fieldwork.${SEARCH}.name`));
  });
});

describe('the mastery of a work', () => {
  it('belongs to the work: its own name and page, no missing text', () => {
    expect(masteryRef(SEARCH, content)).toEqual({ kind: 'fieldwork', id: SEARCH });
    expect(ukLocale[`fieldwork.${SEARCH}.name`]).toBeDefined();
  });
});
