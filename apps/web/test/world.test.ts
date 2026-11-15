// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, xpAt, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CellPanel from '../src/components/CellPanel.svelte';
import Hint from '../src/components/Hint.svelte';
import NowBar from '../src/components/NowBar.svelte';
import ZoneWhere from '../src/components/ZoneWhere.svelte';
import { createGame } from '../src/lib/game.svelte.ts';
import { nextStateHint } from '../src/lib/hints.ts';
import { flagPage, objectiveTarget } from '../src/lib/next-step.ts';
import { parseHash } from '../src/lib/route.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toastFor as toastForIn } from '../src/lib/toasts.svelte.ts';
import { isWorldRoute, worldFocus } from '../src/lib/world.ts';
import EntityPage from '../src/pages/EntityPage.svelte';
import SkillPage from '../src/pages/SkillPage.svelte';
import CombatPage from '../src/pages/CombatPage.svelte';
import WorldPage from '../src/pages/WorldPage.svelte';
import { coreContext } from './helpers/core-registry.ts';

/** The toast of an event, for the content of the game under test. */
const toastFor = (event: Parameters<typeof toastForIn>[0]) => toastForIn(event, content);

const FOREST = 'core:forest';
const PLAINS = 'core:plains';
const VALLEY = 'core:valley';
const HOME = 'core:okolytsi_sela';
const PLAIN_CELL = 'core:rysovi_polia';
const KEYED = 'core:skelia_nad_vodospadom';
const TRAINING_CELL = 'core:polihon_44_lis_smerti';
const CACHE_CELL = 'core:stare_pole_boiu';

const cellOf = (id: string) => {
  const cell = content.cells.find((c) => c.id === id);
  if (!cell) throw new Error(id);
  return cell;
};
const FIRST_LEVEL = content.balance.K.cellExplores[0] ?? 0;

/** A genin standing in the first cell, with nothing explored. */
function genin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  return state;
}

/** Makes a cell explored to level 1, with its points of interest found. */
function explored(state: GameState, id: string): void {
  state.world.explores[id] = FIRST_LEVEL;
  for (const poi of cellOf(id).pois) state.world.pois[poi.id] = true;
}

const name = (key: string): string => ukLocale[key] ?? key;

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

function show(
  focus: { cell: string | null; region: string | null } = { cell: null, region: FOREST },
): void {
  app = mount(WorldPage, { target, context: coreContext(), props: { focus } });
  flushSync();
}

const tile = (id: string) => target.querySelector<HTMLElement>(`[data-cell="${id}"]`);
const q = (selector: string) => target.querySelector<HTMLElement>(selector);
const reason = (which: string) => q(`[data-why="${which}"]`)?.textContent?.trim() ?? null;

beforeEach(() => {
  settings.hints = false;
  target = document.createElement('div');
  document.body.append(target);
  game.replaceState(genin());
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
});

describe('A3: the map follows the core', () => {
  it('an exploration that finishes updates the cell tile', () => {
    show();
    expect(tile(PLAIN_CELL)?.getAttribute('data-level')).toBe('0');
    expect(tile(PLAIN_CELL)?.querySelectorAll('.pip')).toHaveLength(0);

    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'explore', id: PLAIN_CELL }).ok,
    ).toBe(true);
    game.devAdvance((FIRST_LEVEL + 2) * 5000);
    flushSync();

    expect(tile(PLAIN_CELL)?.getAttribute('data-level')).toBe('1');
    expect(tile(PLAIN_CELL)?.querySelectorAll('.pip.on')).toHaveLength(1);
    expect(game.state.currencies.intel).toBe(content.balance.K.intel.perCellLevel);
  });

  it('travel moves the location marker', () => {
    const state = genin();
    explored(state, PLAIN_CELL);
    state.currencies.ryo = 100;
    game.replaceState(state);
    show();
    expect(tile(HOME)?.querySelector('[data-here]')).not.toBeNull();
    expect(tile(PLAIN_CELL)?.querySelector('[data-here]')).toBeNull();

    expect(game.dispatch({ type: 'world.travel', cell: PLAIN_CELL, mode: 'instant' }).ok).toBe(
      true,
    );
    flushSync();

    expect(tile(HOME)?.querySelector('[data-here]')).toBeNull();
    expect(tile(PLAIN_CELL)?.querySelector('[data-here]')).not.toBeNull();
  });

  it('a claim pays into the bank and removes the loot marker', () => {
    const state = genin();
    state.skills.scout.xp = xpAt(20);
    explored(state, CACHE_CELL);
    state.world.location = CACHE_CELL;
    game.replaceState(state);
    show({ cell: CACHE_CELL, region: VALLEY });
    expect(tile(CACHE_CELL)?.querySelector('[data-loot]')).not.toBeNull();

    q('[data-claim]')?.click();
    flushSync();

    expect(game.state.bank['core:coin']).toBe(5);
    expect(tile(CACHE_CELL)?.querySelector('[data-loot]')).toBeNull();
    expect(q('[data-claimed]')).not.toBeNull();
    expect(q('[data-claim]')).toBeNull();
  });

  it('a region that opens is shown as open', () => {
    const state = genin();
    state.skills.scout.xp = xpAt(9);
    game.replaceState(state);
    show({ cell: null, region: PLAINS });
    expect(q(`[data-region="${PLAINS}"]`)?.getAttribute('data-open')).toBe('false');
    expect(q('[data-region-closed]')).not.toBeNull();

    game.state.skills.scout.xp = xpAt(10);
    game.devAdvance(1000);
    flushSync();

    expect(q(`[data-region="${PLAINS}"]`)?.getAttribute('data-open')).toBe('true');
    expect(q('[data-region-closed]')).toBeNull();
  });

  it('shows the tile of a cell at its highest level as maxed', () => {
    const state = genin();
    state.world.explores[PLAIN_CELL] = content.balance.K.cellExplores[2] ?? 0;
    game.replaceState(state);
    show();
    expect(tile(PLAIN_CELL)?.getAttribute('data-maxed')).toBe('true');
    expect(tile(PLAIN_CELL)?.querySelector('[data-max]')).not.toBeNull();
  });
});

describe('A4: names are entity links', () => {
  const href = (kind: string, id: string) => `a[href="#/${kind}/${id}"]`;

  it('links the regions and the cells of the map', () => {
    show();
    for (const id of [FOREST, PLAINS, VALLEY]) {
      expect(q(`nav ${href('region', id)}`)?.textContent).toBe(name(`region.${id}.name`));
    }
    expect(tile(HOME)?.querySelector(href('cell', HOME))?.textContent).toBe(
      name(`cell.${HOME}.name`),
    );
  });

  it('links the cell, its points, the zone enemy and the key requirement in the panel', () => {
    const state = genin();
    explored(state, TRAINING_CELL);
    game.replaceState(state);
    show({ cell: TRAINING_CELL, region: FOREST });
    const panel = q('[data-cell-panel]');
    expect(panel?.querySelector(href('cell', TRAINING_CELL))).not.toBeNull();
    for (const poi of cellOf(TRAINING_CELL).pois) {
      expect(panel?.querySelector(href('poi', poi.id))?.textContent).toBe(
        name(`poi.${poi.id}.name`),
      );
    }
    expect(panel?.querySelector(href('skill', 'herb'))).not.toBeNull();
    expect(panel?.querySelector(href('enemy', 'core:centipede'))).not.toBeNull();

    unmount(app!);
    app = null;
    show({ cell: KEYED, region: FOREST });
    const req = q('[data-key-req]');
    expect(req?.querySelector(href('skill', 'cc'))).not.toBeNull();
  });

  it('puts the cell of a fight zone on the enemy page, as links', () => {
    app = mount(EntityPage, { target, context: coreContext(), props: { entity: { kind: 'enemy', id: 'core:wolf' } } });
    flushSync();
    const where = q('[data-zone-where]');
    expect(where?.querySelector(href('cell', 'core:prykordonnyi_lis_okolytsia'))).not.toBeNull();
    expect(where?.querySelector(href('region', FOREST))).not.toBeNull();
    expect(where?.getAttribute('data-zone-available')).toBe('false');
  });

  it('says a zone is available once its cell is explored', () => {
    const state = genin();
    explored(state, 'core:prykordonnyi_lis_okolytsia');
    game.replaceState(state);
    app = mount(ZoneWhere, { target, props: { zone: 'core:zone_wolf' } });
    flushSync();
    expect(q('[data-zone-where]')?.getAttribute('data-zone-available')).toBe('true');
  });

  it('shows the training bonus source as a link in the skill breakdown', () => {
    const state = genin();
    explored(state, TRAINING_CELL);
    state.world.location = TRAINING_CELL;
    game.replaceState(state);
    app = mount(SkillPage, { target, context: coreContext(), props: { id: 'herb' } });
    flushSync();
    // The breakdown lives behind the figure; opening it lists the training spot as a poi link.
    const trainingPoi = cellOf(TRAINING_CELL).pois.find((p) => p.kind === 'training');
    for (const figure of target.querySelectorAll<HTMLElement>('.figure')) figure.click();
    flushSync();
    expect(q(`a[href="#/poi/${trainingPoi?.id}"]`)).not.toBeNull();
    expect(target.textContent).toContain('+10%');
  });
});

describe('A5: a disabled control says why', () => {
  it('region closed', () => {
    show({ cell: 'core:khram_vohniu', region: PLAINS });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.regionClosed'));
  });

  it('key missing', () => {
    show({ cell: KEYED, region: FOREST });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.keyMissing'));
  });

  it('Scouting too low for the next level', () => {
    const state = genin();
    explored(state, PLAIN_CELL);
    game.replaceState(state);
    show({ cell: PLAIN_CELL, region: FOREST });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.scoutLevelLow'));
  });

  it('not located in the region, and not in the cell for a claim', () => {
    const state = genin();
    state.skills.scout.xp = xpAt(20);
    explored(state, CACHE_CELL);
    game.replaceState(state);
    show({ cell: CACHE_CELL, region: VALLEY });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.notInRegion'));
    expect(q('[data-claim]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('claim')).toBe(name('error.notHere'));
  });

  it('not enough ryo for an instant trip, while the walk stays open', () => {
    const state = genin();
    explored(state, PLAIN_CELL);
    state.currencies.ryo = 0;
    game.replaceState(state);
    show({ cell: PLAIN_CELL, region: FOREST });
    expect(q('[data-travel-instant]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('instant')).toBe(name('error.notEnoughRyo'));
    expect(q('[data-travel-walk]')?.hasAttribute('disabled')).toBe(false);
  });

  it('a cell that cannot be reached yet', () => {
    show({ cell: 'core:uzlissia', region: FOREST });
    expect(q('[data-travel-instant]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('instant')).toBe(name('error.cellNotReachable'));
    expect(reason('walk')).toBe(name('error.cellNotReachable'));
  });

  it('cell at its highest level', () => {
    const state = genin();
    state.world.explores[PLAIN_CELL] = content.balance.K.cellExplores[2] ?? 0;
    game.replaceState(state);
    show({ cell: PLAIN_CELL, region: FOREST });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.cellMaxed'));
  });

  it('an outpost trip is free and shows it', () => {
    const state = genin();
    state.skills.scout.xp = xpAt(10);
    game.replaceState(state);
    game.devAdvance(1000);
    show({ cell: 'core:pivdennyi_trakt', region: PLAINS });
    expect(q('[data-travel-instant]')?.hasAttribute('disabled')).toBe(false);
    expect(q('[data-travel-instant]')?.textContent).toContain(name('world.travel.free'));
  });
});

describe('A6: undiscovered points stay hidden', () => {
  it('an unexplored cell shows no point of interest, in the panel or the tile', () => {
    show({ cell: TRAINING_CELL, region: FOREST });
    const cellName = name(`cell.${TRAINING_CELL}.name`);
    // The cell's own name may contain a point's name; it is the point itself that must not appear.
    const html = target.innerHTML.replaceAll(cellName, '');
    expect(q('[data-pois]')).toBeNull();
    expect(q('[data-poi]')).toBeNull();
    expect(tile(TRAINING_CELL)?.querySelector('[data-poi-kind]')).toBeNull();
    for (const poi of cellOf(TRAINING_CELL).pois) {
      expect(html).not.toContain(poi.id);
      expect(html).not.toContain(name(`poi.${poi.id}.name`));
    }
    // Not even the short note of the cell, which lists what lies there.
    expect(html).not.toContain(name(`cell.${TRAINING_CELL}.note`));
  });

  it('a cell with a partial count shows only a thin progress bar', () => {
    const state = genin();
    state.world.explores[TRAINING_CELL] = 3;
    game.replaceState(state);
    show();
    expect(tile(TRAINING_CELL)?.querySelector('.pip')).toBeNull();
    expect(tile(TRAINING_CELL)?.querySelector('.bar')).not.toBeNull();
  });

  it('exploring reveals the points', () => {
    const state = genin();
    explored(state, TRAINING_CELL);
    game.replaceState(state);
    show({ cell: TRAINING_CELL, region: FOREST });
    expect(target.querySelectorAll('[data-poi]')).toHaveLength(cellOf(TRAINING_CELL).pois.length);
  });
});

describe('the key-locked state', () => {
  it('keeps the tile short: a key badge and a lock label, no requirement text', () => {
    show();
    const t = tile(KEYED);
    expect(t?.querySelector('[data-key="rock"]')).not.toBeNull();
    expect(t?.querySelector('[data-need]')?.textContent).toContain(name('world.tile.lockedShort'));
    expect(t?.querySelector('a[href="#/skill/cc"]')).toBeNull();
  });
});

describe('entering a newly opened region', () => {
  it('works from the visible controls: go to the region, then explore its first cell', () => {
    const state = genin();
    state.skills.scout.xp = xpAt(10);
    game.replaceState(state);
    game.devAdvance(1000);
    show({ cell: null, region: PLAINS });
    // The entry cell is marked, and the region header offers the trip.
    expect(tile('core:pivdennyi_trakt')?.querySelector('[data-entry]')).not.toBeNull();
    expect(q('[data-region-entry]')).not.toBeNull();
    expect(q('[data-region-walk]')?.textContent).toMatch(/[0-9]/);

    unmount(app!);
    app = null;
    show({ cell: 'core:mistechko_na_rivnynakh', region: PLAINS });
    // Not there yet: exploring says why and names the action that fixes it.
    expect(reason('explore')).toBe(name('error.notInRegion'));
    expect(name('error.notInRegion')).toContain(name('world.entry.go'));
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);

    q('[data-region-enter]')?.click();
    flushSync();
    expect(game.state.world.location).toBe('core:pivdennyi_trakt');
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(false);
    q('[data-explore]')?.click();
    game.devAdvance((FIRST_LEVEL + 2) * 5000);
    flushSync();
    expect(tile('core:mistechko_na_rivnynakh')?.getAttribute('data-level')).toBe('1');
  });
});

describe('the cell panel keeps its actions in view', () => {
  it('has a header with the close button and an action row outside the scrolling body', () => {
    show({ cell: PLAIN_CELL, region: FOREST });
    const panel = q('[data-cell-panel]');
    expect(panel?.querySelector(':scope > .head .close')).not.toBeNull();
    expect(panel?.querySelector(':scope > .actions [data-explore]')).not.toBeNull();
    expect(panel?.querySelector(':scope > .body [data-explore]')).toBeNull();
    expect(q('[data-side]')?.getAttribute('role')).toBe('dialog');
  });
});

describe('hints show one at a time', () => {
  it('lets a second hint wait until the first is dismissed', () => {
    settings.hints = true;
    settings.resetHints();
    const other = document.createElement('div');
    document.body.append(other);
    const first = mount(Hint, { target, props: { id: 'world' } });
    const second = mount(Hint, { target: other, props: { id: 'worldKey' } });
    flushSync();
    expect(document.querySelectorAll('[data-hint]')).toHaveLength(1);
    expect(q('[data-hint="world"]')).not.toBeNull();
    settings.dismissHint('world');
    flushSync();
    expect(other.querySelector('[data-hint="worldKey"]')).not.toBeNull();
    unmount(first);
    unmount(second);
    other.remove();
  });
});

describe('the combat page lists only what is discovered', () => {
  it('shows a found zone with its cell and a startable button, never a locked boss', () => {
    const state = genin();
    explored(state, 'core:prykordonnyi_lis_okolytsia');
    game.replaceState(state);
    app = mount(CombatPage, { target });
    flushSync();
    expect(q('[data-zone="core:zone_wolf"]')).not.toBeNull();
    expect(q('[data-zone="core:zone_wolf"] .start')?.hasAttribute('disabled')).toBe(false);
    expect(q('[data-zone="core:zone_bandit"]')).toBeNull();
    expect(target.innerHTML).not.toContain('core:boss_');
  });
});

describe('the Now bar shows where the player is', () => {
  it('names the cell and the training bonus that works there', () => {
    const state = genin();
    explored(state, TRAINING_CELL);
    state.world.location = TRAINING_CELL;
    game.replaceState(state);
    app = mount(NowBar, { target });
    flushSync();
    expect(q('[data-place-cell] a')?.getAttribute('href')).toBe(`#/cell/${TRAINING_CELL}`);
    expect(q('[data-training-bonus]')?.textContent).toContain('+10%');

    game.state.world.location = HOME;
    game.devAdvance(10);
    flushSync();
    expect(q('[data-training-bonus]')).toBeNull();
  });

  it('shows a walk as an action with the time left', () => {
    const state = genin();
    explored(state, PLAIN_CELL);
    game.replaceState(state);
    app = mount(NowBar, { target });
    expect(game.dispatch({ type: 'world.travel', cell: PLAIN_CELL, mode: 'walk' }).ok).toBe(true);
    flushSync();
    expect(q('[data-walk-left]')?.textContent).toMatch(/ще/);
    expect(q('.slot a')?.getAttribute('href')).toBe(`#/cell/${PLAIN_CELL}`);
  });
});

describe('the Scouting page', () => {
  it('shows Intel, the current action and a link to the map', () => {
    const state = genin();
    state.currencies.intel = 7;
    game.replaceState(state);
    app = mount(SkillPage, { target, context: coreContext(), props: { id: 'scout' } });
    flushSync();
    expect(q('[data-intel]')?.textContent).toBe('7');
    expect(q('[data-open-world]')?.getAttribute('href')).toBe('#/world');
    expect(q('[data-scout-current]')?.textContent).toContain(name('scout.idle'));
    // The gear line of maps and the exploration time breakdown are on the page.
    expect(q('[data-gear-section]')).not.toBeNull();
  });
});

describe('routes', () => {
  it('opens the map for the world page, a cell, a region and a point', () => {
    expect(isWorldRoute(parseHash('#/world'))).toBe(true);
    expect(worldFocus(parseHash(`#/cell/${TRAINING_CELL}`))).toEqual({
      cell: TRAINING_CELL,
      region: FOREST,
    });
    expect(worldFocus(parseHash(`#/region/${PLAINS}`))).toEqual({ cell: null, region: PLAINS });
    const poi = cellOf(TRAINING_CELL).pois[0]?.id ?? '';
    expect(worldFocus(parseHash(`#/poi/${poi}`)).cell).toBe(TRAINING_CELL);
    expect(isWorldRoute(parseHash('#/skill/tai'))).toBe(false);
  });

  it('sends objectives about cells, regions and points to the map', () => {
    const state = genin();
    const poi = cellOf(TRAINING_CELL).pois[0]?.id ?? '';
    expect(flagPage(`poi.${poi}`, content)).toBe(`#/cell/${TRAINING_CELL}`);
    expect(flagPage('region.plains.unlocked', content)).toBe(`#/region/${PLAINS}`);
    expect(flagPage('firstFight', content)).toBeNull();
    expect(
      objectiveTarget(state, { t: 'counter', counter: `explored.${FOREST}`, n: 3 }, content),
    ).toBe(`#/region/${FOREST}`);
  });
});

describe('toasts', () => {
  it('announce a region, a level, a find, a claim and a trip, with links', () => {
    expect(toastFor({ type: 'regionOpened', at: 0, region: PLAINS })?.ref).toEqual({
      kind: 'region',
      id: PLAINS,
    });
    const level = toastFor({ type: 'cellLevelUp', at: 0, cell: HOME, level: 2, max: false });
    expect(level?.key).toBe('toast.cellLevelUp');
    expect(level?.ref).toEqual({ kind: 'cell', id: HOME });
    expect(toastFor({ type: 'cellLevelUp', at: 0, cell: HOME, level: 5, max: true })?.key).toBe(
      'toast.cellMax',
    );
    expect(toastFor({ type: 'poiFound', at: 0, cell: HOME, poi: 'core:poi_x' })?.ref).toEqual({
      kind: 'poi',
      id: 'core:poi_x',
    });
    const cache = cellOf('core:stepovi_zarosti').pois.find((p) => p.kind === 'cache');
    const claimed = toastFor({ type: 'poiClaimed', at: 0, poi: cache?.id ?? '' });
    expect(claimed?.gains?.items.map((i) => i.id)).toEqual(['core:band', 'core:notes']);
    expect(toastFor({ type: 'travelled', at: 0, cell: HOME })?.ref).toEqual({
      kind: 'cell',
      id: HOME,
    });
  });

  it('are raised by the game when the core reports the events', () => {
    const pushed: unknown[] = [];
    const own = createGame({ toasts: { push: (spec) => void pushed.push(spec) } });
    const state = genin();
    explored(state, PLAIN_CELL);
    state.currencies.ryo = 50;
    own.replaceState(state);
    own.dispatch({ type: 'world.travel', cell: PLAIN_CELL, mode: 'instant' });
    expect(pushed.map((p) => (p as { key: string }).key)).toContain('toast.travelled');
    expect(own.signals.travelled).toBe(true);
  });
});

describe('hints of the map', () => {
  /** Only the hints of the map may show; the rest (graduation and so on) wait their turn elsewhere. */
  const none = (id: string) => id.startsWith('world');

  it('waits for a key cell, a training spot and the first trip', () => {
    const state = genin();
    expect(nextStateHint(state, content, none)).toBeNull();

    explored(state, TRAINING_CELL);
    expect(nextStateHint(state, content, none)?.id).toBe('worldTraining');

    const keyed = genin();
    explored(keyed, KEYED);
    expect(nextStateHint(keyed, content, none)?.id).toBe('worldKey');

    expect(nextStateHint(genin(), content, none, { travelled: true })?.id).toBe('worldTravel');
  });

  it('are written to the player as «ти»', () => {
    for (const id of ['world', 'worldKey', 'worldTraining', 'worldTravel']) {
      expect(name(`hint.${id}`)).not.toMatch(/\b(ви|вас|вам|вами|ваш\S*)\b/i);
    }
  });
});

describe('CellPanel on its own', () => {
  it('renders nothing for an unknown cell', () => {
    app = mount(CellPanel, { target, context: coreContext(), props: { id: 'core:nowhere' } });
    flushSync();
    expect(q('[data-cell-panel]')).toBeNull();
  });
});
