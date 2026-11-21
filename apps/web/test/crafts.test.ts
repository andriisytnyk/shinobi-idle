// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { actionInfo, createState, syncVillage, xpAt, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BuffStrip from '../src/components/BuffStrip.svelte';
import GearLine from '../src/components/GearLine.svelte';
import HerbTile from '../src/components/HerbTile.svelte';
import RecipeTile from '../src/components/RecipeTile.svelte';
import { bankTab, itemPlace, itemSource, reqItemIds } from '../src/lib/crafts.ts';
import { goalItemIds } from '../src/lib/goal.ts';
import { nextStateHint } from '../src/lib/hints.ts';
import { parseHash, hrefFor, type EntityRef } from '../src/lib/route.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toastFor as toastForIn } from '../src/lib/toasts.svelte.ts';
import BankPage from '../src/pages/BankPage.svelte';
import RecipeSheet from '../src/sheets/RecipeSheet.svelte';
import ShopPage from '../src/pages/ShopPage.svelte';
import SkillPage from '../src/pages/SkillPage.svelte';
import { coreContext } from './helpers/core-registry.ts';

/** The toast of an event, for the content of the game under test. */
const toastFor = (event: Parameters<typeof toastForIn>[0]) => toastForIn(event, content);

const MINT = 'core:mint';
const NETTLE = 'core:nettle';
const OIL = 'core:oil';
const OINTMENT = 'core:tsiliushcha_maz';
const TONIC = 'core:tonik_iasnoho_rozumu';
const GEAR_SICKLE = 'core:serp_i_rukavytsi_travnyka';

const name = (ref: EntityRef) =>
  ukLocale[`${ref.kind === 'status' ? 'state' : ref.kind}.${ref.id}.name`] ?? ref.id;

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The anchors `<a href="#/kind/id">Name</a>` in the mounted view that point at the entity. */
const linkTo = (ref: EntityRef) =>
  [...target.querySelectorAll('a')].filter(
    (a) => a.getAttribute('href') === hrefFor(ref) && text(a) === name(ref),
  );

/** How often the entity's name stands in the view outside of any link. */
function bare(ref: EntityRef): number {
  const copy = target.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('a').forEach((a) => a.remove());
  return (copy.textContent ?? '').split(name(ref)).length - 1;
}

function genin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  syncVillage(state, content);
  state.player.name = 'Тест';
  state.skills.herb!.xp = xpAt(10);
  state.skills.alch!.xp = xpAt(10);
  state.skills.prov!.xp = xpAt(10);
  state.skills.med!.xp = xpAt(10);
  state.currencies.ryo = 500;
  return state;
}

function info(id: string, kind: 'gather' | 'craft') {
  const found = actionInfo(game.state, { kind, id }, content, game.rules);
  if (!found) throw new Error(`no action ${id}`);
  return found;
}

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

describe('A3: views follow the core without a reload', () => {
  it('a finished craft changes the have and need counts and flags the missing ingredient', () => {
    game.state.bank[NETTLE] = 2;
    game.state.bank[OIL] = 1;
    app = mount(SkillPage, { target, context: coreContext(), props: { id: 'alch' } });
    flushSync();
    const row = (item: string) =>
      target.querySelector(`[data-recipe="${OINTMENT}"] [data-input="${item}"]`);
    expect(text(row(NETTLE)?.querySelector('.count'))).toBe('2/2');
    expect(row(NETTLE)?.getAttribute('data-missing')).toBe('false');

    expect(game.dispatch({ type: 'action.start', slot: 0, kind: 'craft', id: OINTMENT }).ok).toBe(
      true,
    );
    game.devAdvance(info(OINTMENT, 'craft').intervalMs);
    flushSync();

    expect(game.state.bank[NETTLE]).toBeUndefined();
    expect(text(row(NETTLE)?.querySelector('.count'))).toBe('0/2');
    expect(row(NETTLE)?.getAttribute('data-missing')).toBe('true');
    // The shortcuts lead to the herb page and to the shop.
    expect(row(NETTLE)?.querySelector('[data-source]')?.getAttribute('href')).toBe('#/skill/herb');
    expect(row(OIL)?.querySelector('[data-source]')?.getAttribute('href')).toBe('#/shop');
  });

  it('buying updates the ryo and the owned count', () => {
    app = mount(ShopPage, { target, props: {} });
    flushSync();
    const owned = () => text(target.querySelector(`[data-good="${OIL}"] [data-have]`));
    expect(text(target.querySelector('[data-purse]'))).toContain('500');
    expect(owned()).toContain('0');

    target.querySelector<HTMLElement>(`[data-good="${OIL}"] [data-inc]`)?.click();
    flushSync();
    target.querySelector<HTMLButtonElement>(`[data-buy="${OIL}"]`)?.click();
    flushSync();

    // Oil costs 4 ryo; two units.
    expect(game.state.currencies.ryo ?? 0).toBe(492);
    expect(text(target.querySelector('[data-purse]'))).toContain('492');
    expect(owned()).toContain('2');
  });

  it('using a tonic shows the buff with its charges', () => {
    game.state.bank[TONIC] = 1;
    const strip = document.createElement('div');
    document.body.append(strip);
    const buffs = mount(BuffStrip, { target: strip });
    app = mount(BankPage, { target });
    flushSync();
    expect(strip.querySelector('[data-buff]')).toBeNull();

    target.querySelector<HTMLButtonElement>(`[data-drink="${TONIC}"]`)?.click();
    flushSync();

    const buff = strip.querySelector(`[data-buff="${TONIC}"]`);
    expect(buff).not.toBeNull();
    expect(game.state.buffs[TONIC]?.charges).toBeGreaterThan(0);
    expect(text(buff?.querySelector('.charges'))).toContain(
      String(game.state.buffs[TONIC]?.charges),
    );
    expect(buff?.querySelector('a')?.getAttribute('href')).toBe(`#/item/${TONIC}`);
    // The tonic left the bank and the page follows.
    expect(target.querySelector(`[data-item="${TONIC}"]`)).toBeNull();
    unmount(buffs);
    strip.remove();
  });

  it('the herb tile shows the bush emptying and regrowing', () => {
    app = mount(SkillPage, { target, context: coreContext(), props: { id: 'herb' } });
    flushSync();
    const stock = () => text(target.querySelector(`[data-herb="${MINT}"] [data-stock]`));
    const size = game.read((gs) => gs.bushes[MINT]?.size ?? 5 + 1);
    expect(stock()).toMatch(/^\d+\/\d+$/);
    game.dispatch({ type: 'action.start', slot: 0, kind: 'gather', id: MINT });
    game.devAdvance(info(MINT, 'gather').intervalMs);
    flushSync();
    const [now, of] = stock().split('/').map(Number);
    expect(of).toBeGreaterThan(0);
    expect(now).toBe(game.state.bushes[MINT]?.stock ?? 0);
    expect(now).toBeLessThan(size);
    // Empty the bush: the tile says it regrows.
    for (let i = 0; i < 50 && (game.state.bushes[MINT]?.stock ?? 1) > 0; i++) {
      game.devAdvance(info(MINT, 'gather').intervalMs);
    }
    expect(game.state.bushes[MINT]?.stock).toBe(0);
    flushSync();
    expect(target.querySelector(`[data-herb="${MINT}"] [data-regrow]`)).not.toBeNull();
  });
});

describe('A4: names are entity links', () => {
  it('herb, recipe, input and output names', () => {
    app = mount(HerbTile, { target, props: { info: info(MINT, 'gather') } });
    flushSync();
    expect(linkTo({ kind: 'item', id: MINT })).toHaveLength(1);
    expect(bare({ kind: 'item', id: MINT })).toBe(0);
    unmount(app);
    app = mount(RecipeTile, { target, props: { info: info(OINTMENT, 'craft') } });
    flushSync();
    expect(linkTo({ kind: 'recipe', id: OINTMENT })).toHaveLength(1);
    expect(linkTo({ kind: 'item', id: NETTLE })).toHaveLength(1);
    expect(linkTo({ kind: 'item', id: OIL })).toHaveLength(1);
    // The output is a link to the item, besides the recipe's own link.
    expect(linkTo({ kind: 'item', id: OINTMENT })).toHaveLength(1);
    // No entity name stands outside a link.
    for (const id of [NETTLE, OIL, OINTMENT]) expect(bare({ kind: 'item', id })).toBe(0);
  });

  it('shop good, gear and bank item names', () => {
    app = mount(ShopPage, { target, props: {} });
    flushSync();
    expect(linkTo({ kind: 'item', id: OIL }).length).toBeGreaterThan(0);
    expect(linkTo({ kind: 'gear', id: GEAR_SICKLE }).length).toBeGreaterThan(0);
    expect(bare({ kind: 'item', id: OIL })).toBe(0);
    unmount(app);
    game.state.bank[MINT] = 3;
    app = mount(BankPage, { target });
    flushSync();
    expect(linkTo({ kind: 'item', id: MINT })).toHaveLength(1);
    expect(target.querySelector(`[data-item="${MINT}"] a`)?.getAttribute('href')).toBe(
      `#/item/${MINT}`,
    );
  });

  it('the recipe sheet shows the ingredients, the output and the tier of the tile', () => {
    app = mount(RecipeSheet, { target, props: { id: OINTMENT } });
    flushSync();
    expect(target.querySelector('[data-recipe-page]')).not.toBeNull();
    expect(
      target.querySelector(`[data-recipe-page="${OINTMENT}"] [data-inputs] [data-input]`),
    ).not.toBeNull();
    expect(target.querySelector('[data-recipe-page] [data-outputs] li')).not.toBeNull();
    expect(target.querySelector('[data-recipe-page] [data-tier]')).not.toBeNull();
  });
});

describe('A5: the bank filter «потрібне для мети»', () => {
  it('lists exactly the items of the requirement tree', () => {
    expect(
      reqItemIds({
        t: 'all',
        of: [
          { t: 'item', id: MINT, n: 2 },
          {
            t: 'any',
            of: [
              { t: 'item', id: OIL, n: 1 },
              { t: 'rank', rank: 'genin' },
            ],
          },
          { t: 'item', id: MINT, n: 1 },
        ],
      }),
    ).toEqual([MINT, OIL]);
  });

  it('shows the goal item even when none is held, and nothing else', () => {
    game.state.bank[MINT] = 3;
    game.state.bank[NETTLE] = 2;
    game.dispatch({ type: 'goal.pin', ref: { kind: 'item', id: OIL } });
    expect(goalItemIds(game.state, content, game.rules)).toEqual([OIL]);
    app = mount(BankPage, { target });
    flushSync();
    const ids = () =>
      [...target.querySelectorAll('[data-item]')].map((e) => e.getAttribute('data-item'));
    expect(ids().sort()).toEqual([MINT, NETTLE].sort());

    target.querySelector<HTMLInputElement>('[data-goal-filter]')?.click();
    flushSync();
    expect(ids()).toEqual([OIL]);

    game.dispatch({ type: 'goal.pin', ref: { kind: 'item', id: NETTLE } });
    flushSync();
    expect(ids().sort()).toEqual([NETTLE, OIL].sort());
  });

  it('tabs and search narrow the list', () => {
    game.state.bank[MINT] = 3;
    game.state.bank[TONIC] = 1;
    app = mount(BankPage, { target });
    flushSync();
    target.querySelector<HTMLElement>('[data-tab="products"]')?.click();
    flushSync();
    expect(
      [...target.querySelectorAll('[data-item]')].map((e) => e.getAttribute('data-item')),
    ).toEqual([TONIC]);
    target.querySelector<HTMLElement>('[data-tab="all"]')?.click();
    const search = target.querySelector<HTMLInputElement>('[data-search]');
    if (!search) throw new Error('no search');
    const ids = () =>
      [...target.querySelectorAll('[data-item]')].map((e) => e.getAttribute('data-item'));
    flushSync();
    expect(ids().sort()).toEqual([MINT, TONIC].sort());
    // A part of a name, in any case, keeps only the items that carry it.
    search.value = name({ kind: 'item', id: TONIC }).slice(1, 6).toUpperCase();
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(ids()).toEqual([TONIC]);
    search.value = 'такого немає';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(ids()).toEqual([]);
    expect(target.querySelector('[data-empty]')).not.toBeNull();
    expect(bankTab(content.items.find((i) => i.id === MINT)!)).toBe('ingredients');
  });
});

describe('A6: a disabled control says why', () => {
  /** Every disabled button of the mounted view points at a visible reason. */
  function everyDisabledHasReason(): void {
    const disabled = [...target.querySelectorAll<HTMLButtonElement>('button:disabled')];
    expect(disabled.length).toBeGreaterThan(0);
    for (const button of disabled) {
      const id = button.getAttribute('aria-describedby');
      expect(id, text(button)).toBeTruthy();
      expect(
        target.querySelector(`#${CSS.escape(id ?? '')}`)?.getAttribute('data-why'),
      ).toBeTruthy();
    }
  }

  it('not enough ryo, and a rank that is too low', () => {
    game.state.currencies.ryo = 0;
    game.state.player.rank = 'student';
    app = mount(ShopPage, { target, props: {} });
    flushSync();
    // One notice for the whole shop, no reason or tree repeated on the rows.
    expect(text(target.querySelector('[data-shop-locked]'))).toBe(
      'Крамниці відкриються зі званням Геніна.',
    );
    expect(target.querySelector('[data-good] [data-why]')).toBeNull();
    expect(target.querySelector('[data-good] .why-box')).toBeNull();
    expect(target.querySelector('[data-gear] [data-why]')?.getAttribute('data-why')).toBe('rank');
    everyDisabledHasReason();

    game.state.player.rank = 'genin';
    game.devAdvance(0);
    flushSync();
    expect(target.querySelector(`[data-good="${OIL}"] [data-why]`)?.getAttribute('data-why')).toBe(
      'money',
    );
    expect(text(target.querySelector(`[data-good="${OIL}"] [data-why]`))).toContain(
      'Не вистачає: Рьо',
    );
    everyDisabledHasReason();
  });

  it('a level that is too low, and a missing ingredient', () => {
    game.state.skills.alch!.xp = 0;
    app = mount(SkillPage, { target, context: coreContext(), props: { id: 'alch' } });
    flushSync();
    const why = (id: string) =>
      target.querySelector(`[data-recipe="${id}"] [data-why]`)?.getAttribute('data-why');
    expect(why(OINTMENT)).toBe('level');
    expect(
      target.querySelector(`[data-recipe="${OINTMENT}"] .ct-action`)?.hasAttribute('disabled'),
    ).toBe(true);

    game.state.skills.alch!.xp = xpAt(10);
    game.devAdvance(0);
    flushSync();
    expect(why(OINTMENT)).toBe('missing');
    everyDisabledHasReason();
    game.state.bank[NETTLE] = 2;
    game.state.bank[OIL] = 1;
    game.devAdvance(0);
    flushSync();
    expect(why(OINTMENT)).toBeUndefined();
  });

  it('a gear tier that the level or the ryo does not allow', () => {
    game.state.skills.herb!.xp = 0;
    const line = content.gear.find((g) => g.id === GEAR_SICKLE);
    if (!line) throw new Error('no sickle');
    game.state.currencies.ryo = 0;
    app = mount(GearLine, { target, props: { line } });
    flushSync();
    expect(target.querySelector('[data-why]')?.getAttribute('data-why')).toBe('money');
    everyDisabledHasReason();
  });
});

describe('the quantity field', () => {
  const type = (selector: string, value: string) => {
    const input = target.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };
  const good = `[data-good="${OIL}"]`;

  it('buys a typed amount, with +10 and «макс», and says why when it is not possible', () => {
    game.state.currencies.ryo = 100;
    app = mount(ShopPage, { target, props: {} });
    flushSync();
    // Oil costs 4: 100 ryo afford 25.
    target.querySelector<HTMLElement>(`${good} [data-max]`)?.click();
    flushSync();
    expect(target.querySelector<HTMLInputElement>(`${good} [data-qty]`)?.value).toBe('25');
    expect(target.querySelector<HTMLButtonElement>(`[data-buy="${OIL}"]`)?.disabled).toBe(false);

    type(`${good} [data-qty]`, '26');
    expect(target.querySelector<HTMLButtonElement>(`[data-buy="${OIL}"]`)?.disabled).toBe(true);
    expect(target.querySelector(`${good} [data-why]`)?.getAttribute('data-why')).toBe('money');

    type(`${good} [data-qty]`, 'abc');
    expect(target.querySelector(`${good} [data-why]`)?.getAttribute('data-why')).toBe('qty');
    expect(target.querySelector<HTMLButtonElement>(`[data-buy="${OIL}"]`)?.disabled).toBe(true);

    type(`${good} [data-qty]`, '7');
    target.querySelector<HTMLElement>(`${good} [data-ten]`)?.click();
    flushSync();
    expect(target.querySelector<HTMLInputElement>(`${good} [data-qty]`)?.value).toBe('17');
    // Enter in the field buys.
    target
      .querySelector(`${good} [data-qty]`)
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(game.state.bank[OIL]).toBe(17);
    // The Market's 2% comes off the whole stack: 68 ryo become 67.
    expect(game.state.currencies.ryo ?? 0).toBe(100 - Math.round(17 * 4 * 0.98));
  });

  it('arrow keys step the amount', () => {
    app = mount(ShopPage, { target, props: {} });
    flushSync();
    const field = target.querySelector(`${good} [data-qty]`);
    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    flushSync();
    expect(target.querySelector<HTMLInputElement>(`${good} [data-qty]`)?.value).toBe('3');
  });

  it('sells everything with «макс» and refuses more than the bank holds', () => {
    game.state.bank[OINTMENT] = 60;
    app = mount(ShopPage, { target, props: {} });
    flushSync();
    const row = `[data-sell="${OINTMENT}"]`;
    type(`${row} [data-qty]`, '61');
    expect(target.querySelector(`${row} [data-why]`)?.getAttribute('data-why')).toBe('qty');
    expect(target.querySelector<HTMLButtonElement>(`${row} [data-sell-button]`)?.disabled).toBe(
      true,
    );
    target.querySelector<HTMLElement>(`${row} [data-max]`)?.click();
    flushSync();
    target.querySelector<HTMLButtonElement>(`${row} [data-sell-button]`)?.click();
    flushSync();
    expect(game.state.bank[OINTMENT]).toBeUndefined();
  });
});

describe('places and hints', () => {
  it('routes the shop and its sell section', () => {
    expect(parseHash('#/shop')).toEqual({ page: 'shop' });
    expect(parseHash('#/shop/sell')).toEqual({ page: 'shop', section: 'sell' });
    expect(parseHash('#/recipe/core:antidote').page).toBe('entity');
  });

  it('the five training skills show their gear line with a link to the shop', () => {
    for (const skill of ['tai', 'herb', 'alch', 'prov', 'scout']) {
      app = mount(SkillPage, { target, context: coreContext(), props: { id: skill } });
      flushSync();
      const section = target.querySelector('[data-gear-section]');
      expect(section, skill).not.toBeNull();
      expect(section?.querySelector('a[href="#/shop"]'), skill).not.toBeNull();
      unmount(app);
      app = null;
    }
  });

  it('sends an item objective to where it is made or bought', () => {
    expect(itemPlace(MINT, content)).toBe('#/skill/herb');
    expect(itemPlace(OIL, content)).toBe('#/shop');
    expect(itemPlace(OINTMENT, content)).toBe('#/skill/alch');
    expect(itemPlace('core:graduate_scroll', content)).toBeNull();
    expect(itemSource(OINTMENT, content).href).toBe(`#/recipe/${OINTMENT}`);
  });

  it('a craft that runs out of an ingredient raises its hint and a toast naming the item', () => {
    game.state.bank[NETTLE] = 2;
    game.state.bank[OIL] = 1;
    game.dispatch({ type: 'action.start', slot: 0, kind: 'craft', id: OINTMENT });
    expect(game.signals.craftStopped).toBeUndefined();
    game.devAdvance(info(OINTMENT, 'craft').intervalMs + 10);
    expect(game.state.slots[0]?.action).toBeNull();
    expect(game.signals.craftStopped).toBe(true);
    const hint = nextStateHint(game.state, content, () => true, game.signals);
    expect(hint?.id).toBe('craftStopped');
    expect(
      toastFor({
        type: 'actionStopped',
        slot: 0,
        kind: 'craft',
        id: OINTMENT,
        reason: 'requirements',
        missing: NETTLE,
        at: 0,
      } as never),
    ).toMatchObject({ key: 'toast.stopped.ingredient', ref: { kind: 'item', id: NETTLE } });
  });

  it('the tonic hint follows the first buff', () => {
    expect(nextStateHint(game.state, content, () => true, {})?.id).not.toBe('tonicUsed');
    game.state.bank[TONIC] = 1;
    game.dispatch({ type: 'item.use', id: TONIC });
    expect(nextStateHint(game.state, content, () => true, {})?.id).toBe('tonicUsed');
  });

  it('the sickle shows in the gather time breakdown once bought', () => {
    game.state.currencies.ryo = 1000;
    const before = info(MINT, 'gather').intervalMs;
    expect(game.dispatch({ type: 'gear.buy', line: GEAR_SICKLE }).ok).toBe(true);
    expect(info(MINT, 'gather').intervalMs).toBeLessThan(before);
    app = mount(HerbTile, { target, props: { info: info(MINT, 'gather') } });
    flushSync();
    target.querySelector<HTMLElement>('.figure')?.click();
    flushSync();
    expect(target.querySelector(`.list a[href="#/gear/${GEAR_SICKLE}"]`)).not.toBeNull();
  });
});
