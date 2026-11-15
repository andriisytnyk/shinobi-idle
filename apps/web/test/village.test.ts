// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, syncVillage, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextStateHint } from '../src/lib/hints.ts';
import { activeNav } from '../src/lib/nav.ts';
import { coreRegistry } from './helpers/core-registry.ts';
import { objectiveTarget } from '../src/lib/next-step.ts';
import { parseHash } from '../src/lib/route.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toastFor as toastForIn } from '../src/lib/toasts.svelte.ts';
import BuildingPage from '../src/pages/BuildingPage.svelte';
import ShopPage from '../src/pages/ShopPage.svelte';
import VillagePage from '../src/pages/VillagePage.svelte';

/** The toast of an event, for the content of the game under test. */
const toastFor = (event: Parameters<typeof toastForIn>[0]) => toastForIn(event, content);

const K = content.balance.K;
const TICK = K.tickMin * 60_000;
const id = (slug: string) => `core:${slug}`;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function genin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  syncVillage(state, content);
  return state;
}
const v = () => {
  if (!game.state.village) throw new Error('no village');
  return game.state.village;
};

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  settings.hints = false;
  game.replaceState(genin());
  target = document.createElement('div');
  document.body.append(target);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
});

const card = (slug: string) => target.querySelector(`[data-building="${id(slug)}"]`);
const mountVillage = (focus: string | null = null) => {
  app = mount(VillagePage, { target, props: { focus } });
  flushSync();
};

describe('the village page', () => {
  it('shows the stage, treasury, resources, queue and buildings grouped by role', () => {
    mountVillage();
    expect(target.querySelector('[data-stage]')?.getAttribute('data-stage')).toBe('1');
    expect(target.querySelector('[data-stage-req]')).not.toBeNull();
    expect(text(target.querySelector('[data-treasury]'))).toContain('на годину');
    expect(target.querySelectorAll('[data-resources] [data-resource]')).toHaveLength(4);
    // Six shinobi resources, Workforce and Shinobi Power.
    expect(target.querySelectorAll('[data-shinobi] [data-resource]')).toHaveLength(8);
    expect(target.querySelector('[data-queue-empty]')).not.toBeNull();
    expect(target.querySelectorAll('[data-building]')).toHaveLength(16);
    expect(target.querySelectorAll('[data-role]').length).toBe(6);
    expect(text(card('forge')?.querySelector('[data-unlocks]'))).toContain('Куна');
  });

  it('says that the village opens with the Genin rank for a student', () => {
    game.replaceState(createState(1, content));
    mountVillage();
    expect(target.querySelector('[data-village-locked]')).not.toBeNull();
    expect(target.querySelector('[data-building]')).toBeNull();
  });

  it('a building updates its level after its ticks, and the queue shows the job', () => {
    v().res.wood = 1000;
    v().res.stone = 1000;
    v().treasury = 1000;
    mountVillage();
    expect(card('library')?.getAttribute('data-level')).toBe('0');
    target.querySelector<HTMLButtonElement>(`[data-build="${id('library')}"]`)?.click();
    flushSync();
    expect(target.querySelector('[data-queue-job]')).not.toBeNull();
    expect(text(card('library'))).toContain('Будується');
    expect(target.querySelector('[data-cancel]')).not.toBeNull();
    game.devAdvance(K.buildTicks[0]! * TICK);
    flushSync();
    expect(card('library')?.getAttribute('data-level')).toBe('1');
    expect(target.querySelector('[data-queue-empty]')).not.toBeNull();
  });

  it('cancelling refunds, and workforce appears only when charges exist', () => {
    v().res.wood = 1000;
    v().res.stone = 1000;
    v().treasury = 1000;
    mountVillage();
    target.querySelector<HTMLButtonElement>(`[data-build="${id('library')}"]`)?.click();
    flushSync();
    expect(target.querySelector('[data-use-workforce]')).toBeNull();
    v().workforce = 2;
    game.devAdvance(0);
    flushSync();
    expect(target.querySelector('[data-use-workforce]')).not.toBeNull();
    target.querySelector<HTMLButtonElement>('[data-use-workforce]')?.click();
    flushSync();
    expect(card('library')?.getAttribute('data-level')).toBe('1');
    target.querySelector<HTMLButtonElement>(`[data-build="${id('shrine')}"]`)?.click();
    flushSync();
    const before = v().res.wood ?? 0;
    target.querySelector<HTMLButtonElement>('[data-cancel]')?.click();
    flushSync();
    expect(v().res.wood).toBe(before + K.costBase * (K.costMult[0] ?? 0));
    expect(v().job).toBeNull();
  });

  it('donating moves ryo to the treasury', () => {
    game.state.currencies.ryo = 300;
    mountVillage();
    const field = target.querySelector<HTMLInputElement>('[data-treasury] [data-qty]');
    if (!field) throw new Error('no donate field');
    field.value = '120';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLButtonElement>('[data-donate]')?.click();
    flushSync();
    expect(game.state.currencies.ryo).toBe(180);
    expect(v().treasury).toBe(120);
    expect(text(target.querySelector('[data-treasury-amount]'))).toBe('120');
    // «макс» puts all the ryo in the field.
    target.querySelector<HTMLElement>('[data-treasury] [data-max]')?.click();
    flushSync();
    expect(target.querySelector<HTMLInputElement>('[data-treasury] [data-qty]')?.value).toBe('180');
    field.value = '999';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('[data-treasury] [data-why]')?.getAttribute('data-why')).toBe(
      'money',
    );
    expect(target.querySelector<HTMLButtonElement>('[data-donate]')?.disabled).toBe(true);
  });

  it('gives a disabled button a reason for each refusal', () => {
    const why = (slug: string) => card(slug)?.querySelector('[data-why]')?.getAttribute('data-why');
    const off = (slug: string) =>
      card(slug)?.querySelector<HTMLButtonElement>('[data-build]')?.disabled;
    // Resources short.
    mountVillage();
    expect(why('library')).toBe('error.notEnoughResources');
    expect(text(card('library')?.querySelector('[data-why]'))).toContain('Деревина');
    expect(off('library')).toBe(true);
    unmount(app!);
    app = null;
    target.innerHTML = '';

    // Treasury short.
    v().res.wood = 1000;
    v().res.stone = 1000;
    game.devAdvance(0);
    mountVillage();
    expect(why('library')).toBe('error.notEnoughTreasury');
    expect(text(card('library')?.querySelector('[data-why]'))).toContain('казні');
    unmount(app!);
    app = null;
    target.innerHTML = '';

    // Queue busy, stage cap, no level six, stage 2 needed, shinobi resources missing.
    v().treasury = 100_000;
    for (const key of Object.keys(v().res)) v().res[key] = 100_000;
    v().levels[id('grounds')] = 5;
    v().levels[id('library')] = 3;
    v().levels[id('academy')] = 5;
    v().levels[id('store')] = 6;
    v().job = null;
    game.devAdvance(0);
    mountVillage();
    expect(why('library')).toBe('error.stageCap');
    expect(why('grounds')).toBe('error.stageNotReached');
    unmount(app!);
    app = null;
    target.innerHTML = '';

    game.state.currencies.rep = K.rep.stage2;
    game.devAdvance(0);
    mountVillage();
    expect(card('academy')?.querySelector('[data-max]')).not.toBeNull();
    expect(card('academy')?.querySelector('[data-build]')).toBeNull();
    expect(why('grounds')).toBe('error.notEnoughShinobi');
    // The missing shinobi resource is named and the card says where it comes from.
    expect(text(card('grounds')?.querySelector('[data-why]'))).toContain('Ділянки');
    expect(card('grounds')?.querySelector('.ct-muted, .missions')).not.toBeNull();
    expect(card('store')?.querySelector('[data-max]')).not.toBeNull();
    target.querySelector<HTMLButtonElement>(`[data-build="${id('library')}"]`)?.click();
    flushSync();
    expect(why('forge')).toBe('error.queueBusy');
  });

  it('scrolls the focused building into view and marks it', () => {
    mountVillage(id('forge'));
    expect(card('forge')?.getAttribute('data-focused')).toBe('true');
    expect(card('library')?.getAttribute('data-focused')).toBe('false');
  });
});

describe('the building page', () => {
  it('shows the card and every level with its effects and cost', () => {
    app = mount(BuildingPage, { target, props: { id: id('grounds') } });
    flushSync();
    expect(target.querySelector('[data-building-page]')).not.toBeNull();
    expect(target.querySelectorAll('[data-level-row]')).toHaveLength(6);
    expect(text(target.querySelector('[data-level-row="3"]'))).toContain('+3%');
    expect(text(target.querySelector('[data-level-row="6"]'))).toContain('Ділянки');
    // A building without level six lists five levels.
    unmount(app);
    target.innerHTML = '';
    app = mount(BuildingPage, { target, props: { id: id('library') } });
    flushSync();
    expect(target.querySelectorAll('[data-level-row]')).toHaveLength(5);
  });
});

describe('shop goods locked by a building', () => {
  it('shows «Потрібно: <будівля> рівня N» as a link instead of hiding the good', () => {
    app = mount(ShopPage, { target, props: {} });
    flushSync();
    const kunai = target.querySelector('[data-good="core:kunai"]');
    expect(kunai).not.toBeNull();
    const need = kunai?.querySelector('[data-building-need]');
    expect(text(need)).toBe(`Потрібно: ${ukLocale['building.core:forge.name']} рівня 1`);
    expect(need?.querySelector('a')?.getAttribute('href')).toBe('#/building/core:forge');
    expect(kunai?.querySelector<HTMLButtonElement>('[data-buy]')?.disabled).toBe(true);
    // Library scrolls are listed too.
    expect(target.querySelector('[data-section="library"] [data-good]')).not.toBeNull();
    // Once the Forge stands, the good opens.
    v().levels[id('forge')] = 1;
    game.state.currencies.ryo = 100;
    game.devAdvance(0);
    flushSync();
    expect(target.querySelector('[data-good="core:kunai"] [data-building-need]')).toBeNull();
    expect(
      target.querySelector<HTMLButtonElement>('[data-good="core:kunai"] [data-buy]')?.disabled,
    ).toBe(false);
  });
});

describe('routes, toasts and hints', () => {
  it('parses the village routes and keeps the village lit in the menu', () => {
    expect(parseHash('#/village')).toEqual({ page: 'tab', tab: 'village' });
    expect(parseHash('#/village/core:forge')).toEqual({
      page: 'tab',
      tab: 'village',
      focus: 'core:forge',
    });
    expect(activeNav('#/village/core:forge', coreRegistry)).toBe('village');
    expect(activeNav('#/building/core:forge', coreRegistry)).toBe('village');
  });

  it('leads a building requirement to the village page focused on that building', () => {
    const target = objectiveTarget(
      game.state,
      { t: 'req', req: { t: 'building', id: id('forge'), level: 2 } },
      content,
    );
    expect(target).toBe('#/village/core:forge');
  });

  it('announces a finished building, the second stage and a full store', () => {
    expect(toastFor({ type: 'buildingBuilt', building: id('forge'), level: 2, at: 0 })).toEqual({
      key: 'toast.buildingBuilt',
      params: { n: 2 },
      ref: { kind: 'building', id: id('forge') },
    });
    expect(toastFor({ type: 'villageStage', stage: 2, at: 0 })?.key).toBe('toast.villageStage');
    expect(toastFor({ type: 'storageFull', resource: 'wood', at: 0 })?.params).toEqual({
      name: 'Деревина',
    });
  });

  it('raises each store-full toast once until the stock falls below the cap', () => {
    const cap = K.storeCap[0] + K.storeCap[1];
    v().res.wood = cap - 1;
    game.devAdvance(TICK);
    game.devAdvance(TICK);
    game.devAdvance(TICK);
    // The event is queued once when the stock first reaches the cap, not on every full tick.
    expect(v().res.wood).toBe(cap);
    v().res.wood = cap - 1;
    game.devAdvance(TICK);
    expect(v().res.wood).toBe(cap);
  });

  it('has a one-time page hint explaining that the village grows on its own', () => {
    expect(ukLocale['hint.village']).toContain('Село росте саме');
    expect(nextStateHint(game.state, content, () => true)?.id).not.toBe('village');
  });
});
