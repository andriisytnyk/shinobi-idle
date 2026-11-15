import { scrollPartId, type ContentDb, type Operation } from '@shinobi/content';
import { addCurrency, addItem } from '../bank.ts';
import { currencyFor } from './currency.ts';
import { need } from './need.ts';
import { emit } from '../events.ts';
import { nextFloat } from '../rng.ts';
import type { GameState } from '../state.ts';
import { recordLoot } from './report.ts';

/**
 * Pays what a cleared operation gives, from its content data: the first clear and every repeat
 * have their own ryo, reputation and scroll parts (each part by its chance, on the `loot` stream).
 * An operation with no rewards (its pay comes from a quest chain) pays nothing.
 */
export function payOperation(
  state: GameState,
  op: Operation,
  first: boolean,
  content: ContentDb,
): void {
  const pay = op.rewards ? (first ? op.rewards.first : op.rewards.repeat) : null;
  if (!pay) return;
  const items: Record<string, number> = {};
  for (const part of pay.parts) {
    if (
      nextFloat(state.rng, 'loot') <
      need(content.balance.K.partDrop[part.chance], `partDrop.${part.chance}`)
    ) {
      const id = scrollPartId(part.technique);
      items[id] = (items[id] ?? 0) + 1;
    }
  }
  addCurrency(state, currencyFor(content, 'money', pay.currency), pay.ryo);
  addCurrency(state, currencyFor(content, 'renown', pay.repCurrency), pay.rep);
  const list = Object.entries(items).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [id, n] of list) addItem(state, id, n);
  recordLoot(state, op.id, { ryo: pay.ryo, bounty: 0, items });
  emit(state, {
    type: 'operationPaid',
    op: op.id,
    first,
    ryo: pay.ryo,
    rep: pay.rep,
    items: list.map(([id, n]) => ({ id, n })),
  });
}
