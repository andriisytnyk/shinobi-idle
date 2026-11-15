import type { Boss, Enemy } from '@shinobi/content';
import { addCurrency, addItem } from '../bank.ts';
import { emit } from '../events.ts';
import { nextFloat, nextInt } from '../rng.ts';
import type { GameState } from '../state.ts';
import { isFirstWin } from './bingo.ts';

/** What one win pays. */
export interface Loot {
  ryo: number;
  bounty: number;
  /** Trophies and scroll parts, by item id. */
  items: Record<string, number>;
}

/** The loot stream of the game: loot never touches the stream that decides fights. */
const STREAM = 'loot';

/**
 * Rolls what a defeated enemy leaves, on the `loot` stream: ryo in the enemy's range, each
 * trophy by its chance, and the scroll part of the technique it carries (an enemy by chance, a
 * boss in a fixed count). A boss with a bounty pays it in full for the first win and at the
 * repeat share afterwards. The same number of draws is made whatever the results are.
 */
export function rollLoot(state: GameState, entry: Enemy | Boss): Loot {
  const loot: Loot = { ryo: 0, bounty: 0, items: {} };
  const [low, high] = entry.ryo;
  loot.ryo = low + nextInt(state.rng, STREAM, Math.max(1, high - low + 1));
  for (const drop of entry.drops) {
    if (nextFloat(state.rng, STREAM) < drop.chance) {
      loot.items[drop.item] = (loot.items[drop.item] ?? 0) + 1;
    }
  }
  const part = entry.scrollPart;
  if (part) {
    if ('count' in part) loot.items[part.item] = (loot.items[part.item] ?? 0) + part.count;
    else if (nextFloat(state.rng, STREAM) < part.chance) {
      loot.items[part.item] = (loot.items[part.item] ?? 0) + 1;
    }
  }
  if (entry.bounty) {
    const { first, repeatShare } = entry.bounty;
    loot.bounty = isFirstWin(state, entry.id) ? first : Math.round(first * repeatShare);
  }
  return loot;
}

/** Puts a loot in the bank and the purse, and tells the UI. */
export function grantLoot(state: GameState, enemy: string, loot: Loot): void {
  addCurrency(state, 'ryo', loot.ryo + loot.bounty);
  const items = Object.entries(loot.items).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [id, n] of items) addItem(state, id, n);
  emit(state, {
    type: 'loot',
    enemy,
    ryo: loot.ryo,
    bounty: loot.bounty,
    items: items.map(([id, n]) => ({ id, n })),
  });
}
