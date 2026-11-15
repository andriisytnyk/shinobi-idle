import type { ContentDb } from '@shinobi/content';
import { removeItem } from '../bank.ts';
import type { CommandResult } from '../engine.ts';
import { emit } from '../events.ts';
import { indexOf } from '../lookup.ts';
import type { Modifier, ModifierProvider } from '../modifiers.ts';
import type { GameState } from '../state.ts';

/** The buff entry a ration leaves: it is no skill's, so no tonic reads it. */
export const RATION_BUFF = 'mission';

/**
 * An armed ration shortens the next mission: while its buff is in `state.buffs` it adds its
 * duration share to `mission.duration`, and the next mission to begin takes the charge.
 */
export const rationProvider: ModifierProvider = (state, content) => {
  const out: Modifier[] = [];
  const items = indexOf(content).items;
  for (const [id, buff] of Object.entries(state.buffs)) {
    const fx = items.get(id)?.fx;
    if (fx?.kind !== 'ration' || buff.charges < 1) continue;
    out.push({
      key: 'mission.duration',
      op: 'add',
      value: fx.duration,
      group: 'items',
      source: { kind: 'item', id },
    });
  }
  return out;
};

/** Uses a ration from the bank: it is armed for the next mission, and one already armed is not doubled. */
export function useRation(state: GameState, id: string, content: ContentDb): CommandResult {
  const fx = indexOf(content).items.get(id)?.fx;
  if (fx?.kind !== 'ration') return { ok: false, reason: 'error.itemNotUsable' };
  const have = state.buffs[id]?.charges ?? 0;
  if (have >= fx.missions) return { ok: false, reason: 'error.rationArmed' };
  if (!removeItem(state, id, 1)) return { ok: false, reason: 'error.noItem' };
  state.buffs[id] = { skill: RATION_BUFF, charges: have + fx.missions };
  emit(state, { type: 'itemUsed', id, target: 'missions' });
  return { ok: true };
}
