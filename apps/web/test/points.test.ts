// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, xpAt, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import NowBar from '../src/components/NowBar.svelte';
import ScoutPanel from '../src/components/ScoutPanel.svelte';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toastFor as toastForIn } from '../src/lib/toasts.svelte.ts';
import WorldPage from '../src/pages/WorldPage.svelte';
import { coreContext } from './helpers/core-registry.ts';

const toastFor = (event: Parameters<typeof toastForIn>[0]) => toastForIn(event, content);

const FIRST = content.balance.K.cellExplores[0] ?? 0;
const TG44 = 'core:training_ground_44';
const TG44_CELL = 'core:polihon_44_lis_smerti';
const VALLEY = 'core:valley_of_the_end';
const JOFUKU = 'core:jofuku_forest';

const place = (id: string) => {
  const p = content.places.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};
const coordOf = (id: string): string => `${place(id).hex[0]},${place(id).hex[1]}`;
const cellAtPlace = (id: string): string | undefined =>
  content.cells.find((c) => `${c.hex[0]},${c.hex[1]}` === coordOf(id))?.id;
const name = (key: string): string => ukLocale[key] ?? key;

function genin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  return state;
}

/** Makes the hex of a place surveyed and known (its cell explored to level 1). */
function reveal(state: GameState, id: string): void {
  const cell = cellAtPlace(id);
  if (cell) state.world.explores[cell] = FIRST;
  state.world.surveyed[coordOf(id)] = true;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

function show(): void {
  app = mount(WorldPage, {
    target,
    context: coreContext(),
    props: { focus: { cell: null, region: 'core:forest' } },
  });
  flushSync();
}

const q = (selector: string) => target.querySelector<HTMLElement>(selector);
const click = (el: Element | null) => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();
};
const select = (id: string) => click(q(`[data-ui="hex"][data-hex="${coordOf(id)}"]`));

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

describe('points of interest in the hex panel', () => {
  it('a point that is open shows what it gives, but not the reward; a found one shows both', () => {
    const state = genin();
    reveal(state, TG44);
    game.replaceState(state);
    show();
    select(TG44);
    const row = q('[data-ui="point-row"]');
    expect(row?.getAttribute('data-point-status')).toBe('open');
    expect(row?.getAttribute('data-point')).toBe(TG44);
    expect(row?.textContent).toContain(name(`place.${TG44}.name`));
    expect(row?.textContent).toContain(name('map.point.power'));
    expect(row?.textContent).toContain('+5%');
    expect(row?.textContent).toContain(name('map.point.rewardUnknown'));
    expect(row?.querySelector('[data-point-reward]')).toBeNull();
    // On the map the hex carries a marker.
    expect(q(`[data-hex="${coordOf(TG44)}"] [data-ui="map-point"]`)).not.toBeNull();

    unmount(app!);
    app = null;
    state.world.pois[TG44] = true;
    state.world.location = TG44_CELL;
    game.replaceState(state);
    show();
    select(TG44);
    const found = q('[data-ui="point-row"]');
    expect(found?.getAttribute('data-point-status')).toBe('found');
    expect(found?.querySelector('[data-point-active]')).not.toBeNull();
    expect(found?.querySelector('[data-point-reward]')?.textContent).toContain('40');
  });

  it('a point with a requirement shows a vague hint and leaves no id in the page', () => {
    const state = genin();
    reveal(state, VALLEY);
    game.replaceState(state);
    show();
    select(VALLEY);
    const row = q('[data-ui="point-row"]');
    expect(row?.getAttribute('data-point-status')).toBe('veiled');
    expect(row?.hasAttribute('data-point')).toBe(false);
    expect(row?.querySelector('[data-point-hint]')?.textContent).toBe(name(`place.${VALLEY}.hint`));
    expect(target.innerHTML).not.toContain('valley_of_the_end');
    // The region of the hex carries the same name; the place itself is not listed.
    expect(q('[data-places]')).toBeNull();
  });

  it('a hidden point leaves no trace until it is revealed', () => {
    const state = genin();
    reveal(state, JOFUKU);
    game.replaceState(state);
    show();
    select(JOFUKU);
    expect(q('[data-ui="point-row"]')).toBeNull();
    expect(target.innerHTML).not.toContain('jofuku');
    expect(target.textContent).not.toContain(name(`place.${JOFUKU}.name`));
  });

  it('offers to travel on foot and for ryo with the price, and for nothing between outposts', () => {
    const state = genin();
    reveal(state, TG44);
    state.currencies.ryo = 100;
    game.replaceState(state);
    show();
    select(TG44);
    expect(q('[data-travel-walk]')?.textContent).toContain(name('map.act.walk'));
    const paid = q('[data-travel-paid]');
    expect(paid?.textContent).toContain(name('map.act.paid'));
    expect(paid?.textContent).toMatch(/\d+/);
    expect((paid as HTMLButtonElement).disabled).toBe(false);
    expect(q('[data-travel-free]')).toBeNull();
    expect(q('[data-route-line]')?.textContent).toContain('1');
    click(paid);
    expect(game.state.world.location).toBe(TG44_CELL);
    expect(game.state.currencies.ryo).toBeLessThan(100);
  });

  it('says why the trip for ryo cannot be made when the purse is thin', () => {
    const state = genin();
    reveal(state, TG44);
    game.replaceState(state);
    show();
    select(TG44);
    expect((q('[data-travel-paid]') as HTMLButtonElement).disabled).toBe(true);
    expect(q('[data-why="paid"]')?.textContent).toContain('Бракує рьо');
  });

  it('the free trip between outposts is offered from a found outpost to another', () => {
    const state = genin();
    reveal(state, 'core:caravan_yard');
    state.world.pois['core:caravan_yard'] = true;
    game.replaceState(state);
    show();
    select('core:caravan_yard');
    const free = q('[data-travel-free]');
    expect(free).not.toBeNull();
    click(free);
    expect(game.state.world.location).toBe('core:karavannyi_shliakh');
  });
});

describe('the rest of the interface', () => {
  it('names the sources of a place of power in the breakdown', async () => {
    const state = genin();
    state.world.pois[TG44] = true;
    state.world.location = TG44_CELL;
    state.skills.scout = { xp: xpAt(5) };
    game.replaceState(state);
    const { default: ModBreakdown } = await import('../src/components/ModBreakdown.svelte');
    app = mount(ModBreakdown, {
      target,
      context: coreContext(),
      props: { keys: ['xp.skill.tai'], display: '1,05' },
    });
    flushSync();
    click(q('.figure'));
    expect(target.textContent).toContain(name(`place.${TG44}.name`));
    expect(target.textContent).toContain('+5%');
  });

  it('the Scouting page shows the map mastery with its tiers', () => {
    app = mount(ScoutPanel, { target, context: coreContext(), props: { skill: 'scout' } });
    flushSync();
    const block = q('[data-ui="map-mastery"]');
    expect(block).not.toBeNull();
    expect(block?.querySelectorAll('[data-tier-reached]')).toHaveLength(
      content.balance.K.map.mastery.length,
    );
    expect(block?.textContent).toContain(name('map.mastery.title'));
  });

  it('the Now bar names a standing clone', () => {
    const state = genin();
    state.known['core:shadow_clone'] = true;
    state.slots.push({
      action: { kind: 'stand', id: 'here' },
      progress: 0,
      share: 500,
      data: null,
    });
    state.slots[0]!.share = 500;
    state.world.figures = { 1: 'core:rysovi_polia' };
    game.replaceState(state);
    app = mount(NowBar, { target, context: coreContext() });
    flushSync();
    expect(target.textContent).toContain(name('now.doing.stand'));
    // It is not the auto-survey: no such name (a place in fog is only «a hex in fog»).
    expect(target.textContent).not.toContain(name('map.auto.name'));
  });

  it('the Now bar names the surveyed place a clone stands on, as a link', () => {
    const state = genin();
    const cellId = 'core:rysovi_polia';
    const cell = content.cells.find((c) => c.id === cellId)!;
    state.world.surveyed[`${cell.hex[0]},${cell.hex[1]}`] = true;
    state.world.explores[cellId] = FIRST;
    state.known['core:shadow_clone'] = true;
    state.slots.push({
      action: { kind: 'stand', id: 'here' },
      progress: 0,
      share: 500,
      data: null,
    });
    state.slots[0]!.share = 500;
    state.world.figures = { 1: cellId };
    game.replaceState(state);
    app = mount(NowBar, { target, context: coreContext() });
    flushSync();
    expect(target.textContent).not.toContain(name('map.auto.name'));
    expect(target.querySelector(`a[href$="${cellId}"]`)?.textContent).toBe(
      name(`cell.${cellId}.name`),
    );
  });

  it('shows the reward of a found point with the skill and items as links, and tells them in the toasts', () => {
    const state = genin();
    reveal(state, TG44);
    state.world.pois[TG44] = true;
    game.replaceState(state);
    show();
    select(TG44);
    const reward = q('[data-point-reward]');
    expect(reward?.querySelector('[data-reward="xp"] a.entity-link')?.getAttribute('href')).toMatch(
      /tai$/,
    );
    const found = toastFor({
      type: 'pointFound',
      at: 0,
      place: TG44,
      hex: coordOf(TG44),
      slot: 0,
      reward: { ryo: 0, items: [], currencies: {}, xp: { skill: 'tai', amount: 40 } },
    });
    expect(found?.gains?.xp).toEqual({ skill: 'tai', amount: 40 });
    const rare = toastFor({
      type: 'wayFound',
      at: 0,
      hex: '10,16',
      place: 'core:war_fort_ruins',
      items: [{ id: 'core:note', n: 1 }],
      currencies: {},
      slot: 0,
    });
    // The items travel as data, so the toast renders them as entity links.
    expect(rare?.gains?.items).toEqual([{ id: 'core:note', n: 1 }]);
    expect(rare?.params).toEqual({});
  });

  it('tells a point found and a rare find in a toast, and keeps the small finds quiet', () => {
    const found = toastFor({
      type: 'pointFound',
      at: 0,
      place: TG44,
      hex: coordOf(TG44),
      slot: 0,
      reward: { ryo: 5, items: [], currencies: {}, xp: null },
    });
    expect(found?.key).toBe('toast.pointFound');
    expect(found?.params.name).toBe(name(`place.${TG44}.name`));
    expect(found?.gains?.ryo).toBe(5);
    const rare = toastFor({
      type: 'wayFound',
      at: 0,
      hex: '10,16',
      place: 'core:hunter_lodge',
      items: [],
      currencies: { intel: 2 },
      slot: 0,
    });
    expect(rare?.key).toBe('toast.wayFound');
    expect(
      toastFor({
        type: 'wayFound',
        at: 0,
        hex: '10,16',
        place: '',
        items: [{ id: 'core:mint', n: 1 }],
        currencies: {},
        slot: 0,
      }),
    ).toBeNull();
  });
});
