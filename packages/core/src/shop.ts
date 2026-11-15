import type { ContentDb } from '@shinobi/content';
import { addItem, hasItem, removeCurrency, addCurrency, removeItem } from './bank.ts';
import type { CommandResult } from './engine.ts';
import { indexOf } from './lookup.ts';
import { computeMod } from './modifiers.ts';
import { evalReq } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { moneyOf } from './vocab.ts';

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;

/**
 * Base buy price of one unit, or null when the item has no price (it is not for sale). A library
 * scroll costs `K.scroll[level]`, everything else `K.goods[key]`.
 */
export function buyPrice(itemId: string, content: ContentDb): number | null {
  const item = indexOf(content).items.get(itemId);
  if (item?.scroll?.source.t === 'library') {
    return content.balance.K.scroll[String(item.scroll.source.level)] ?? null;
  }
  const key = item?.buy;
  return key === undefined ? null : (content.balance.K.goods[key] ?? null);
}

/**
 * What n units cost the player now: the base price times n with the shop-price modifiers (the
 * Market) applied to the whole stack, so a small discount is not lost to rounding on a cheap good; at least 1.
 */
export function shopTotal(
  state: GameState,
  itemId: string,
  n: number,
  content: ContentDb,
  rules: Rules = defaultRules,
): number | null {
  const base = buyPrice(itemId, content);
  if (base === null) return null;
  const mod = computeMod(rules.modifierProviders, state, 'shop.price', content).total;
  return Math.max(1, Math.round(base * n * mod));
}

/** What one unit costs the player now (the total of a stack of one). */
export const shopPrice = (
  state: GameState,
  itemId: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): number | null => shopTotal(state, itemId, 1, content, rules);

/** What one unit of an item is worth for the sell formula: a herb by its level, a good by its price, else nothing. */
function unitValue(itemId: string, content: ContentDb): number {
  const index = indexOf(content);
  const herb = index.herbs.get(itemId);
  if (herb) {
    const shop = content.balance.K.shop;
    return shop.herbBase + shop.herbPerLevel * herb.level;
  }
  return buyPrice(itemId, content) ?? 0;
}

/**
 * Ryo paid for one unit, or null when the shop does not buy it. Trophies pay their table price; a
 * craft product pays `K.shop.craftSellFactor` of the value of its ingredients per unit made.
 */
export function sellPrice(itemId: string, content: ContentDb): number | null {
  const K = content.balance.K;
  const trophy = indexOf(content).items.get(itemId)?.sell;
  if (trophy !== undefined) return K.sell[trophy] ?? null;
  const recipe = indexOf(content).recipeByOutput.get(itemId);
  if (!recipe) return null;
  const value = recipe.ingredients.reduce((sum, i) => sum + unitValue(i.item, content) * i.n, 0);
  return Math.max(1, Math.floor((value / recipe.output.n) * K.shop.craftSellFactor));
}

/** Buys `n` of an item the shop stocks, if its requirement holds and the ryo is there. */
export function shopBuy(
  state: GameState,
  itemId: string,
  n: number,
  content: ContentDb,
  rules: Rules = defaultRules,
): CommandResult {
  if (!isCount(n)) return { ok: false, reason: 'error.invalidAmount' };
  const entry = indexOf(content).shop.get(itemId);
  const total = shopTotal(state, itemId, n, content, rules);
  if (!entry || total === null) return { ok: false, reason: 'error.notForSale' };
  if (!evalReq(state, entry.req, content).met) {
    return { ok: false, reason: 'error.requirementsNotMet' };
  }
  // The price is paid in the currency the shop entry names, by default the money of the game.
  const currency = entry.currency ?? moneyOf(content);
  if (!Number.isSafeInteger(total) || !removeCurrency(state, currency, total)) {
    // The old key still says it for the money of the game; any other currency is named in the params.
    return currency === moneyOf(content)
      ? { ok: false, reason: 'error.notEnoughRyo' }
      : { ok: false, reason: 'error.notEnoughCurrency', params: { currency } };
  }
  addItem(state, itemId, n);
  return { ok: true };
}

/** Sells `n` of an item from the bank; items the shop does not buy are refused. */
export function shopSell(
  state: GameState,
  itemId: string,
  n: number,
  content: ContentDb,
): CommandResult {
  if (!isCount(n)) return { ok: false, reason: 'error.invalidAmount' };
  const price = sellPrice(itemId, content);
  if (price === null) return { ok: false, reason: 'error.notSellable' };
  if (!hasItem(state, itemId, n)) return { ok: false, reason: 'error.noItem' };
  removeItem(state, itemId, n);
  addCurrency(state, moneyOf(content), price * n);
  return { ok: true };
}
