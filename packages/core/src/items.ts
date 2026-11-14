import type { ContentDb } from '@shinobi/content';
import { removeItem } from './bank.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { indexOf } from './lookup.ts';
import { gainMasteryXp } from './progression.ts';
import type { GameState } from './state.ts';

/**
 * Uses one item from the bank on `target`. Every failure returns a localization key and changes
 * nothing: the item must exist, be in the bank, be usable, and the target must suit its use.
 */
export function useItem(
  state: GameState,
  id: string,
  target: string,
  content: ContentDb,
): CommandResult {
  const index = indexOf(content);
  const item = index.items.get(id);
  if (!item) return { ok: false, reason: 'error.unknownItem' };
  if ((state.bank[id] ?? 0) < 1) return { ok: false, reason: 'error.noItem' };
  const use = item.use;
  if (!use) return { ok: false, reason: 'error.itemNotUsable' };
  const technique = index.techniques.get(target);
  if (!technique || technique.mentor !== use.mentor) {
    return { ok: false, reason: 'error.invalidTarget' };
  }
  removeItem(state, id, 1);
  // One hour of practice, as the balance defines it.
  gainMasteryXp(state, target, content.balance.K.masteryPerHour, content);
  emit(state, { type: 'itemUsed', id, target });
  return { ok: true };
}
