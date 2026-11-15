import { content } from '@shinobi/content';
import { createState, xpAt, type GameState } from '../src/index.ts';
import type { SkillId } from '@shinobi/content';

export const HOUR = 3_600_000;

/** A genin, so the Academy slowdown stays out of the way. */
export function genin(seed = 1): GameState {
  const state = createState(seed, content);
  state.player.rank = 'genin';
  return state;
}

export function setLevel(state: GameState, skill: SkillId, level: number): void {
  state.skills[skill].xp = xpAt(level);
}

export function start(kind: string, id: string, slot = 0) {
  return { type: 'action.start', slot, kind, id } as const;
}
