import type { ContentDb } from '@shinobi/content';
import { addItem, removeItem } from '../bank.ts';
import type { CommandResult } from '../engine.ts';
import { emit } from '../events.ts';
import { indexOf } from '../lookup.ts';
import { nextFloat, nextInt } from '../rng.ts';
import type { GameState } from '../state.ts';

/**
 * Opens one merchant crate from the bank: each good of `K.crate.goods` in a whole number of units
 * between its bounds, and a gem with the chance `K.crate.gem.chance`. Drawn on the loot stream.
 */
export function openCrate(state: GameState, id: string, content: ContentDb): CommandResult {
  const fx = indexOf(content).items.get(id)?.fx;
  if (fx?.kind !== 'crate') return { ok: false, reason: 'error.itemNotUsable' };
  if (!removeItem(state, id, 1)) return { ok: false, reason: 'error.noItem' };
  const { goods, gem } = content.balance.K.crate;
  const give = (item: string, n: number): void => {
    if (n > 0 && addItem(state, item, n)) emit(state, { type: 'itemGained', id: item, n });
  };
  for (const [item, [min, max]] of Object.entries(goods)) {
    give(item, min + nextInt(state.rng, 'loot', max - min + 1));
  }
  if (nextFloat(state.rng, 'loot') < gem.chance) give(gem.item, 1);
  emit(state, { type: 'itemUsed', id, target: 'crate' });
  return { ok: true };
}
