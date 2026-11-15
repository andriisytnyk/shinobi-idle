import type { ContentDb } from '@shinobi/content';
import { removeItem } from '../bank.ts';
import type { CommandResult } from '../engine.ts';
import { emit } from '../events.ts';
import { indexOf } from '../lookup.ts';
import type { GameState } from '../state.ts';

/** The buff entry a ration leaves: it is no skill's, so no tonic reads it. */
export const RATION_BUFF = 'mission';

/**
 * The share (negative) that the armed ration takes off the next mission; 0 with none armed. It is
 * not a modifier: the run that begins next takes it once and keeps it for its whole length, and
 * forecasts take it from here, so the ration enters a duration in exactly one place.
 */
export function armedRation(state: GameState, content: ContentDb): number {
  const items = indexOf(content).items;
  for (const [id, buff] of Object.entries(state.buffs)) {
    const fx = items.get(id)?.fx;
    if (fx?.kind === 'ration' && buff.charges >= 1) return fx.duration;
  }
  return 0;
}

/** Uses a ration from the bank: it is armed for the next mission, and one already armed is not doubled. */
export function useRation(state: GameState, id: string, content: ContentDb): CommandResult {
  const fx = indexOf(content).items.get(id)?.fx;
  if (fx?.kind !== 'ration') return { ok: false, reason: 'error.itemNotUsable' };
  const have = state.buffs[id]?.charges ?? 0;
  if (have >= fx.missions) return { ok: false, reason: 'error.rationArmed' };
  if (!removeItem(state, id, 1)) return { ok: false, reason: 'error.noItem' };
  state.buffs[id] = { skill: RATION_BUFF, charges: Math.min(fx.missions, have + fx.missions) };
  emit(state, { type: 'itemUsed', id, target: 'missions' });
  return { ok: true };
}
