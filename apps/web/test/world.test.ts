// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import {
  autoPlan,
  createState,
  hexesWithin,
  hexInfo,
  hexKey,
  xpAt,
  type GameState,
} from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { revealOffHooks } from './helpers/reveal.ts';

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
  // The full panel of a hex is behind «Деталі» of its card: these tests read it.
  target
    .querySelector('[data-hex-details]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();
}

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

/** The coordinates of a cell hex as the map names them. */
const coordOf = (id: string): string => {
  const [x, y] = cellOf(id).hex;
  return `${x},${y}`;
};
const hexEl = (coord: string) =>
  target.querySelector<SVGElement>(`[data-ui="hex"][data-hex="${coord}"]`);
const tile = (id: string) => hexEl(coordOf(id));
/** Puts the player on a cell's hex and marks it surveyed, as walking there would have. */
function stand(state: GameState, id: string): void {
  state.world.location = id;
  state.world.surveyed[coordOf(id)] = true;
}
const click = (el: Element | null) => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();
  // The full panel of a hex is behind «Деталі» of its card: these tests read it.
  if (el?.getAttribute('data-ui') === 'hex' && !target.querySelector('[data-hex-details-body]')) {
    target
      .querySelector('[data-hex-details]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
  }
};

describe('A3: the map follows the core', () => {
  it('a survey that finishes updates the hex', () => {
    // The cell is three hexes from the start: the range at Scouting 30.
    game.state.skills.scout!.xp = xpAt(30);
    show();
    expect(tile(PLAIN_CELL)?.getAttribute('data-state')).toBe('marked');
    expect(tile(PLAIN_CELL)?.querySelectorAll('.pip')).toHaveLength(
      content.balance.K.scouting.plainMaxLevel,
    );
    expect(tile(PLAIN_CELL)?.querySelectorAll('.pip.on')).toHaveLength(0);

    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'explore', id: PLAIN_CELL }).ok,
    ).toBe(true);
    game.devAdvance((FIRST_LEVEL + 2) * 5000);
    flushSync();

    expect(tile(PLAIN_CELL)?.getAttribute('data-state')).toBe('partial');
    expect(tile(PLAIN_CELL)?.querySelectorAll('.pip.on')).toHaveLength(1);
    expect(game.state.currencies.intel ?? 0).toBe(content.balance.K.intel.perCellLevel);
  });

  it('travel moves the player token', () => {
    const state = genin();
    explored(state, PLAIN_CELL);
    game.replaceState(state);
    show();
    expect(tile(HOME)?.getAttribute('data-state')).toBe('here');
    expect(tile(PLAIN_CELL)?.getAttribute('data-state')).not.toBe('here');

    expect(game.dispatch({ type: 'world.travel', cell: PLAIN_CELL, mode: 'walk' }).ok).toBe(true);
    game.devAdvance(2 * 60 * 60_000);
    flushSync();

    expect(tile(HOME)?.getAttribute('data-state')).not.toBe('here');
    expect(tile(PLAIN_CELL)?.getAttribute('data-state')).toBe('here');
  });

  it('a claim pays into the bank and removes the claim button', () => {
    const state = genin();
    state.skills.scout!.xp = xpAt(20);
    explored(state, CACHE_CELL);
    state.world.location = CACHE_CELL;
    game.replaceState(state);
    show({ cell: CACHE_CELL, region: VALLEY });
    expect(tile(CACHE_CELL)?.querySelector('.poi-cache')).not.toBeNull();

    q('[data-claim]')?.click();
    flushSync();

    expect(game.state.bank['core:coin']).toBe(5);
    expect(q('[data-claimed]')).not.toBeNull();
    expect(q('[data-claim]')).toBeNull();
  });

  it('marks a hex surveyed to its highest level as full', () => {
    const state = genin();
    state.world.explores[PLAIN_CELL] = content.balance.K.cellExplores[2] ?? 0;
    game.replaceState(state);
    show();
    expect(tile(PLAIN_CELL)?.getAttribute('data-state')).toBe('full');
    expect(tile(PLAIN_CELL)?.querySelectorAll('.pip.on')).toHaveLength(3);
  });

  it('draws the surveyed land and the fog apart, and only the first has a terrain', () => {
    show();
    const states = new Set(
      [...target.querySelectorAll('[data-ui="hex"]')].map((h) => h.getAttribute('data-state')),
    );
    expect(states.has('here')).toBe(true);
    expect(states.has('fog')).toBe(true);
    // A fog hex has no terrain mark, and its label says only that it is fog.
    const fog = target.querySelector('[data-ui="hex"][data-state="fog"]');
    expect(fog?.querySelector('.glyph, .place')).toBeNull();
    expect(fog?.getAttribute('aria-label')).toContain(name('map.hex.fog'));
  });
});

describe('the map page', () => {
  it('opens the panel of a hex when it is clicked and closes it with the button', () => {
    show();
    expect(q('[data-hex-panel]')).toBeNull();
    click(tile(PLAIN_CELL));
    expect(q('[data-hex-panel]')?.getAttribute('data-hex-panel')).toBe(coordOf(PLAIN_CELL));
    expect(tile(PLAIN_CELL)?.getAttribute('aria-pressed')).toBe('true');
    click(q('[data-hex-panel] .close'));
    expect(q('[data-hex-panel]')).toBeNull();
  });

  it('draws the route to the chosen hex with its time, the same as the button says', () => {
    show();
    click(tile(PLAIN_CELL));
    expect(q('[data-route]')).not.toBeNull();
    const time = q('[data-route-label]')?.textContent?.trim() ?? '';
    expect(time).not.toBe('');
    expect(q('[data-travel-walk]')?.textContent).toContain(time);
  });

  it('draws no route to a hex in fog, and the panel says why the trip cannot be made', () => {
    show();
    click(hexEl('10,13'));
    expect(q('[data-route]')).toBeNull();
    expect(q('[data-travel-walk]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('walk')).toBe(name('error.cellNotReachable'));
  });

  it('refuses to survey a hex behind fog until surveyed land reaches it', () => {
    const state = genin();
    // Scouting 45 reaches four hexes; this hex lies four away with only fog round it.
    state.skills.scout!.xp = xpAt(45);
    game.replaceState(state);
    show();
    click(hexEl('10,13'));
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.cutOff'));
  });

  it('surveys a hex that touches surveyed land once it is in range, and the fog lifts', () => {
    show();
    const edge = '10,14';
    expect(hexEl(edge)?.getAttribute('data-state')).toBe('fog');
    click(hexEl(edge));
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.outOfRange'));
    // From the edge of the start area it is in range.
    game.state.world.location = 'core:prykordonnyi_lis_okolytsia';
    game.devAdvance(10);
    flushSync();
    expect(hexEl(edge)?.getAttribute('data-state')).toBe('reach');
    click(q('[data-explore]'));
    game.devAdvance(60 * 60_000);
    flushSync();
    expect(hexEl(edge)?.getAttribute('data-state')).not.toMatch(/fog|reach/);
  });

  it('starts and stops the auto-survey from the strip', () => {
    show();
    click(q('[data-map-status] [data-auto]'));
    expect(game.state.slots[0]?.action?.kind).toBe('autosurvey');
    click(q('[data-map-status] [data-auto-stop]'));
    expect(game.state.slots[0]?.action).toBeNull();
  });

  it('zooms with the buttons and moves between hexes with the arrow keys', () => {
    show();
    const scale = () =>
      /scale\(([\d.]+)\)/.exec(q('svg.canvas > g')?.getAttribute('transform') ?? '')?.[1];
    const before = scale();
    click(q('[data-zoom="in"]'));
    expect(scale()).not.toBe(before);
    const here = target.querySelector<SVGElement>('[data-ui="hex"][data-state="here"]');
    expect(here?.getAttribute('tabindex')).toBe('0');
    here?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    const [x, y] = (here?.getAttribute('data-hex') ?? '0,0').split(',').map(Number);
    expect(target.querySelector(`[data-hex="${(x ?? 0) + 1},${y}"]`)).not.toBeNull();
  });

  it('puts the extension parts on the map, the hexes, the token and the panel', () => {
    show();
    click(tile(PLAIN_CELL));
    for (const part of ['map', 'hex', 'hex-panel', 'map-token']) {
      expect(q(`[data-ui="${part}"]`), part).not.toBeNull();
    }
  });
});

describe('A4: names are entity links', () => {
  // The links of the map are checked with everything discovered; what stays hidden has its own test below.
  revealOffHooks({ beforeEach, afterEach });

  const href = (kind: string, id: string) => `a[href="#/${kind}/${id}"]`;

  it('links the region and the cell in the panel of a cell hex', () => {
    show({ cell: HOME, region: FOREST });
    const panel = q('[data-hex-panel]');
    expect(panel?.querySelector(href('cell', HOME))?.textContent).toBe(name(`cell.${HOME}.name`));
    expect(panel?.querySelector(href('region', FOREST))?.textContent).toBe(
      name(`region.${FOREST}.name`),
    );
  });

  it('links the cell, its points, the zone enemy and the key requirement in the panel', () => {
    const state = genin();
    explored(state, TRAINING_CELL);
    game.replaceState(state);
    show({ cell: TRAINING_CELL, region: FOREST });
    const panel = q('[data-hex-panel]');
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
    const keyed = genin();
    stand(keyed, KEYED);
    game.replaceState(keyed);
    show({ cell: KEYED, region: FOREST });
    expect(q('[data-key-req]')?.querySelector(href('skill', 'cc'))).not.toBeNull();
  });

  it('puts the cell of a fight zone on the enemy page, as links', () => {
    app = mount(EntityPage, {
      target,
      context: coreContext(),
      props: { entity: { kind: 'enemy', id: 'core:wolf' } },
    });
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
    show({ cell: 'core:pivdennyi_trakt', region: PLAINS });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.regionClosed'));
  });

  it('key missing', () => {
    const state = genin();
    stand(state, KEYED);
    game.replaceState(state);
    show({ cell: KEYED, region: FOREST });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.keyMissing'));
  });

  it('Scouting too low for the next level', () => {
    const state = genin();
    explored(state, PLAIN_CELL);
    // Standing on the cell, so that it is in range and only the level is lacking.
    state.world.location = PLAIN_CELL;
    game.replaceState(state);
    show({ cell: PLAIN_CELL, region: FOREST });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.scoutLevelLow'));
  });

  it('out of range, and not in the hex for a claim', () => {
    const state = genin();
    state.skills.scout!.xp = xpAt(20);
    explored(state, CACHE_CELL);
    game.replaceState(state);
    show({ cell: CACHE_CELL, region: VALLEY });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.outOfRange'));
    expect(q('[data-claim]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('claim')).toBe(name('error.notHere'));
  });

  it('a hex that cannot be reached yet', () => {
    show();
    click(tile('core:stezhka_myslyvtsia'));
    expect(q('[data-travel-walk]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('walk')).toBe(name('error.cellNotReachable'));
  });

  it('hex at its highest level', () => {
    const state = genin();
    state.world.explores[PLAIN_CELL] = content.balance.K.cellExplores[2] ?? 0;
    game.replaceState(state);
    show({ cell: PLAIN_CELL, region: FOREST });
    expect(q('[data-explore]')?.hasAttribute('disabled')).toBe(true);
    expect(reason('explore')).toBe(name('error.cellMaxed'));
  });
});

describe('A6: undiscovered points stay hidden', () => {
  it('an unexplored cell shows no point of interest, in the panel or on the hex', () => {
    show({ cell: TRAINING_CELL, region: FOREST });
    const cellName = name(`cell.${TRAINING_CELL}.name`);
    // The name of the cell may contain the name of a point; it is the point itself that must not appear.
    const html = target.innerHTML.replaceAll(cellName, '');
    expect(q('[data-pois]')).toBeNull();
    expect(q('[data-poi]')).toBeNull();
    expect(tile(TRAINING_CELL)?.querySelector('.poi')).toBeNull();
    for (const poi of cellOf(TRAINING_CELL).pois) {
      expect(html).not.toContain(poi.id);
      expect(html).not.toContain(name(`poi.${poi.id}.name`));
    }
    // Not even the short note of the cell, which lists what lies there.
    expect(html).not.toContain(name(`cell.${TRAINING_CELL}.note`));
  });

  it('a cell with a partial count shows a progress bar and no lit pip', () => {
    const state = genin();
    state.world.explores[TRAINING_CELL] = 3;
    game.replaceState(state);
    show({ cell: TRAINING_CELL, region: FOREST });
    expect(tile(TRAINING_CELL)?.querySelectorAll('.pip.on')).toHaveLength(0);
    expect(q('[data-hex-panel] .bar')).not.toBeNull();
  });

  it('surveying reveals the points', () => {
    const state = genin();
    explored(state, TRAINING_CELL);
    game.replaceState(state);
    show({ cell: TRAINING_CELL, region: FOREST });
    expect(target.querySelectorAll('[data-poi]')).toHaveLength(cellOf(TRAINING_CELL).pois.length);
    expect(tile(TRAINING_CELL)?.querySelectorAll('.poi').length).toBeGreaterThan(0);
  });
});

describe('the key-locked state', () => {
  it('shows the key and what opens it in the panel of the cell', () => {
    const state = genin();
    stand(state, KEYED);
    game.replaceState(state);
    show({ cell: KEYED, region: FOREST });
    expect(q('[data-key="rock"]')).not.toBeNull();
    expect(q('[data-key-req]')).not.toBeNull();
  });
});

describe('the hex panel keeps its actions in view', () => {
  it('has a header with the close button and an action row outside the scrolling body', () => {
    show({ cell: PLAIN_CELL, region: FOREST });
    const panel = q('[data-hex-panel]');
    expect(panel?.querySelector(':scope > .head .close')).not.toBeNull();
    expect(panel?.querySelector(':scope > .actions [data-explore]')).not.toBeNull();
    expect(panel?.querySelector(':scope > .body [data-explore]')).toBeNull();
  });

  it('shows every action label in full and lets it wrap instead of cutting it with an ellipsis', () => {
    show({ cell: PLAIN_CELL, region: FOREST });
    const buttons = [
      ...target.querySelectorAll<HTMLElement>('[data-hex-panel] [data-actions] button.main'),
    ];
    const labels = buttons.map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    for (const key of ['map.act.survey', 'map.act.walk', 'map.act.paid', 'map.act.auto'])
      expect(labels.some((l) => l.startsWith(name(key)))).toBe(true);
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    // The button's own style truncates (nowrap + ellipsis); `wrap` is what turns that off, and the
    // layout (a grid that lets the cells be as wide as the panel) is checked in the browser.
    for (const b of buttons) expect(b.classList.contains('wrap')).toBe(true);
    expect(q('[data-hex-panel] [data-route-line]')?.textContent).toContain(
      name('map.route').split('{')[0]!.trim(),
    );
  });
});

describe('P4: what is being surveyed, and the order of the auto-survey', () => {
  it('marks the hex being surveyed with the performer and shows its progress and time left', () => {
    game.state.skills.scout!.xp = xpAt(30);
    show();
    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'explore', id: PLAIN_CELL }).ok,
    ).toBe(true);
    game.devAdvance(1000);
    flushSync();
    const hex = tile(PLAIN_CELL);
    expect(hex?.querySelector('.surveying')).not.toBeNull();
    expect(hex?.querySelector('[data-survey-mark]')?.textContent?.trim()).toBe(name('squad.you'));
    click(hex);
    expect(q('[data-hex-panel] [role="progressbar"][aria-label]')).not.toBeNull();
    expect(q('[data-hex-panel] [data-survey-left]')?.textContent).toContain(
      name('map.surveyLeft').split('{')[0]!.trim(),
    );
    expect(q('[data-surveying-now]')).not.toBeNull();
  });

  it('numbers the next hexes of the auto-survey on the map and marks the current one', () => {
    show();
    expect(target.querySelector('[data-auto-order]')).toBeNull();
    click(q('[data-map-status] [data-auto]'));
    const marks = [...target.querySelectorAll<SVGElement>('[data-auto-order]')].sort(
      (a, b) =>
        Number(a.getAttribute('data-auto-order')) - Number(b.getAttribute('data-auto-order')),
    );
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.map((m) => m.getAttribute('data-auto-order'))).toEqual(
      marks.map((_, i) => String(i + 1)),
    );
    expect(marks.filter((m) => m.classList.contains('current'))).toHaveLength(1);
    expect(marks[0]?.classList.contains('current')).toBe(true);
    // The hex of number 1 is the one the core's plan picks.
    const first = marks[0]?.closest('[data-hex]')?.getAttribute('data-hex');
    const plan = autoPlan(game.state, content);
    expect(first).toBe(`${plan?.subject.hex.q},${plan?.subject.hex.r}`);
  });

  it('keeps the survey ring still when motion is reduced', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/components/HexMap.svelte', 'utf8');
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.surveying\s*\{\s*animation: none/,
    );
  });

  it('says what the auto-survey does, and that a hex of the start zone begins surveyed', () => {
    show();
    const start = cellOf(content.regions[0]?.cells[0] ?? '').hex;
    const plain = hexesWithin({ q: start[0], r: start[1] }, content.balance.K.map.startRadius)
      .map((a) => hexKey(a.q, a.r))
      .find((k) => {
        const i = hexInfo(game.state, k, content, game.rules);
        return i && !i.cell && i.level >= 1;
      });
    expect(plain).toBeDefined();
    click(hexEl(plain ?? ''));
    expect(q('[data-auto-help]')?.textContent).toBe(name('map.auto.help'));
    expect(q('[data-start-zone]')).not.toBeNull();
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
    expect(q('[data-zone="core:zone_wolf"]  [data-start]')?.hasAttribute('disabled')).toBe(false);
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
  it('opens on the map with a compact status row and no list of facts', () => {
    const state = genin();
    state.currencies.intel = 7;
    game.replaceState(state);
    app = mount(SkillPage, { target, context: coreContext(), props: { id: 'scout' } });
    flushSync();
    expect(q('[data-intel]')?.textContent).toBe('7');
    expect(q('[data-ui="map"]')).not.toBeNull();
    expect(q('[data-map-status]')).not.toBeNull();
    expect(q('[data-open-world]')).toBeNull();
    expect(q('[data-scout-works]')).toBeNull();
    expect(q('.facts dt')).toBeNull();
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
    own.dispatch({ type: 'world.travel', cell: PLAIN_CELL, mode: 'walk' });
    own.devAdvance(2 * 60 * 60_000);
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

describe('R1: places the player has not discovered stay hidden on the map', () => {
  /** Cells the player has not met on a new game: not on surveyed land, and not named by any rule. */
  const FAR = ['core:khram_vohniu', 'core:stezhka_myslyvtsia', 'core:pokynutyi_khutir'];

  it('puts no cell, region or place id and no far name in the DOM of a new game', () => {
    show();
    for (const id of FAR) {
      expect(target.innerHTML, id).not.toContain(id);
      expect(target.textContent, id).not.toContain(name(`cell.${id}.name`));
    }
    for (const id of [PLAINS, VALLEY]) {
      expect(target.innerHTML, id).not.toContain(id);
      expect(target.textContent, id).not.toContain(name(`region.${id}.name`));
    }
    expect(target.innerHTML).not.toContain('core:');
  });

  it('shows a hex in fog without its terrain, its cell or its places, even when it is selected', () => {
    const fog = coordOf('core:khram_vohniu');
    show();
    click(hexEl(fog));
    const panel = q('[data-hex-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[data-terrain]')).toBeNull();
    expect(panel?.querySelector('[data-places]')).toBeNull();
    expect(panel?.querySelector('a')).toBeNull();
    expect(panel?.textContent).toContain(name('map.hex.fog'));
    for (const id of FAR) expect(panel?.textContent).not.toContain(name(`cell.${id}.name`));
  });

  it('names the places of a hex only once it is surveyed to its first level', () => {
    // A place the player has not found; the outpost a new game starts with is on the home hex and shows from the start.
    const place = content.places.find((p) => p.id === 'core:salt_pans');
    expect(place).toBeDefined();
    const cell = content.cells.find((c) => c.hex.join() === place?.hex.join());
    expect(cell).toBeDefined();
    const placeName = name(`place.${place?.id}.name`);
    const state = genin();
    state.world.surveyed[cell!.hex.join(',')] = true;
    game.replaceState(state);
    show({ cell: cell!.id, region: cell!.region });
    expect(q('[data-places]')).toBeNull();
    expect(target.textContent).not.toContain(placeName);

    explored(state, cell!.id);
    game.replaceState(state);
    game.devAdvance(10);
    flushSync();
    expect(q('[data-places]')?.textContent).toContain(placeName);
  });

  it('shows a point found at the start on the hex of a new game, before its first level', () => {
    const state = genin();
    expect(state.world.pois['core:west_gate_post']).toBe(true);
    game.replaceState(state);
    show({ cell: HOME, region: FOREST });
    expect(q('[data-places]')?.textContent).toContain(name('place.core:west_gate_post.name'));
  });
});

describe('R2: a hex in fog gives nothing away, wherever the interface speaks of it', () => {
  const FOG_CELL = 'core:khram_vohniu';

  /** A genin who stands next to the fog cell, on surveyed land, with the cell in range. */
  function nextTo(): GameState {
    const state = genin();
    state.skills.scout = { xp: xpAt(10) };
    const [q0, r0] = cellOf(FOG_CELL).hex;
    const key = `${q0 - 1},${r0}`;
    state.world.surveyed[key] = true;
    state.world.location = key;
    return state;
  }

  it('names a survey of it "a hex in fog" in the Now bar, without the cell, its link or its pace', () => {
    game.replaceState(nextTo());
    app = mount(NowBar, { target });
    const started = game.dispatch({ type: 'action.start', slot: 0, kind: 'explore', id: FOG_CELL });
    expect(started).toEqual({ ok: true });
    flushSync();
    const row = q('.slot');
    expect(row?.textContent).toContain(name('map.hex.fog'));
    expect(row?.textContent).not.toContain(name(`cell.${FOG_CELL}.name`));
    expect(row?.innerHTML).not.toContain(FOG_CELL);
    expect(row?.textContent).not.toMatch(/\d\s*\/\s*год/);
  });

  it('says nothing of the levels or the survey count of a hex in fog in its panel', () => {
    const state = nextTo();
    // Part-way to the first level of the cell: the count must not tell a cell from a plain hex.
    state.world.explores[FOG_CELL] = FIRST_LEVEL - 14;
    game.replaceState(state);
    show({ cell: null, region: FOREST });
    click(hexEl(coordOf(FOG_CELL)));
    const panel = q('[data-hex-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[role="progressbar"]')).toBeNull();
    expect(panel?.textContent).not.toMatch(/\d+ з \d+/);
    expect(panel?.innerHTML).not.toContain(FOG_CELL);
  });

  it('does not repeat "in fog" in the label of a hex, and names no cell on it', () => {
    game.replaceState(nextTo());
    show();
    const label = hexEl(coordOf(FOG_CELL))?.getAttribute('aria-label') ?? '';
    expect(label.match(/тумані/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(label).not.toContain(name(`cell.${FOG_CELL}.name`));
  });

  it('names a stop of a survey of a hex in fog by the hex, not by the cell', () => {
    game.replaceState(nextTo());
    const spec = toastFor({
      type: 'actionStopped',
      at: 0,
      slot: 0,
      kind: 'explore',
      id: FOG_CELL,
      reason: 'requirements',
    });
    expect(spec?.ref).toEqual({ kind: 'hex', id: coordOf(FOG_CELL) });
  });

  it('does not put the map on a cell that is still in fog when the address names it', () => {
    game.replaceState(nextTo());
    show({ cell: FOG_CELL, region: null });
    // The panel stays shut and the hex of the cell is not marked selected.
    expect(q('[data-hex-panel]')).toBeNull();
    expect(hexEl(coordOf(FOG_CELL))?.getAttribute('aria-pressed')).toBe('false');
  });

  it('draws a terrain by the mark its data gives, not by a table of ids in the code', () => {
    game.replaceState(genin());
    show();
    expect(content.terrains.every((x) => x.glyph)).toBe(true);
    const paths = [...target.querySelectorAll('[data-ui="hex"] path.glyph')];
    expect(paths.length).toBeGreaterThan(5);
    const data = new Set(content.terrains.map((x) => x.glyph));
    for (const p of paths) expect(data.has(p.getAttribute('d') ?? '')).toBe(true);
  });

  it('has no terrain id in the source of the interface', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|svelte)$/.test(f) && !f.endsWith('.generated.ts')) files.push(p);
      }
    };
    walk(join(process.cwd(), 'src'));
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const { id } of content.terrains)
        if (new RegExp(`['"\`]${id}['"\`]`).test(text)) found.push(`${file}: ${id}`);
    }
    expect(found).toEqual([]);
  });
});
