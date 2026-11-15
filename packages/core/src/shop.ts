import type { ContentDb } from '@shinobi/content';
import { addItem, hasItem, removeCurrency, addCurrency, removeItem } from './bank.ts';
import type { CommandResult } from './engine.ts';
import { waiveBuildings } from './gate.ts';
import { indexOf } from './lookup.ts';
import { evalReq } from './requirements.ts';
import type { GameState } from './state.ts';

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;

/** Buy price of one unit, or null when the item has no price (it is not for sale). */
export function buyPrice(itemId: string, content: ContentDb): number | null {
  const key = indexOf(content).items.get(itemId)?.buy;
  return key === undefined ? null : (content.balance.K.goods[key] ?? null);
}

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
  if (trophy !== undefined) return K.sell[trophy];
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
): CommandResult {
  if (!isCount(n)) return { ok: false, reason: 'error.invalidAmount' };
  const entry = indexOf(content).shop.get(itemId);
  const price = buyPrice(itemId, content);
  if (!entry || price === null) return { ok: false, reason: 'error.notForSale' };
  if (!evalReq(state, waiveBuildings(entry.req), content).met) {
    return { ok: false, reason: 'error.requirementsNotMet' };
  }
  const total = price * n;
  if (!Number.isSafeInteger(total) || !removeCurrency(state, 'ryo', total)) {
    return { ok: false, reason: 'error.notEnoughRyo' };
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
  addCurrency(state, 'ryo', price * n);
  return { ok: true };
}
