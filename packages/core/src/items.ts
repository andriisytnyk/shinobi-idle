import type { ContentDb } from '@shinobi/content';
import { addItem, hasItem, removeItem } from './bank.ts';
import { useTonic } from './buffs.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { indexOf } from './lookup.ts';
import { grantMastery } from './progression.ts';
import type { GameState } from './state.ts';

/**
 * Uses one item from the bank on `target`. Every failure returns a localization key and changes
 * nothing: the item must exist, be in the bank, be usable, and the target must suit its use.
 */
export function useItem(
  state: GameState,
  id: string,
  target: string | undefined,
  content: ContentDb,
): CommandResult {
  const index = indexOf(content);
  const item = index.items.get(id);
  if (!item) return { ok: false, reason: 'error.unknownItem' };
  if ((state.bank[id] ?? 0) < 1) return { ok: false, reason: 'error.noItem' };
  // A tonic needs no target: it starts a buff on its own skill.
  if (item.fx?.kind === 'tonic') return useTonic(state, id, content);
  const use = item.use;
  if (!use) return { ok: false, reason: 'error.itemNotUsable' };
  const technique = target === undefined ? undefined : index.techniques.get(target);
  if (!technique || technique.mentor !== use.mentor) {
    return { ok: false, reason: 'error.invalidTarget' };
  }
  removeItem(state, id, 1);
  // One hour of practice, as the balance defines it.
  grantMastery(state, technique.id, technique.skill, content.balance.K.masteryPerHour, content);
  emit(state, { type: 'itemUsed', id, target: technique.id });
  return { ok: true };
}

/**
 * Coats a batch of `base` with `poison`: one poison and the batch of the product's `madeFrom`
 * become that batch of the coated product. The pair must be one of the content's `coat` entries.
 * A failure changes nothing.
 */
export function coatItem(
  state: GameState,
  poison: string,
  base: string,
  content: ContentDb,
): CommandResult {
  const index = indexOf(content);
  const coat = content.coat.find((c) => c.poison === poison && c.base === base);
  if (!coat) return { ok: false, reason: 'error.invalidCoat' };
  const product = index.items.get(coat.product);
  const need = product?.madeFrom ?? [];
  const batch = need.find((m) => m.item === base)?.n;
  const dose = need.find((m) => m.item === poison)?.n;
  if (!product || batch === undefined || dose === undefined) {
    return { ok: false, reason: 'error.invalidCoat' };
  }
  if (!hasItem(state, poison, dose) || !hasItem(state, base, batch)) {
    return { ok: false, reason: 'error.missingIngredient' };
  }
  removeItem(state, poison, dose);
  removeItem(state, base, batch);
  addItem(state, product.id, batch);
  return { ok: true };
}
