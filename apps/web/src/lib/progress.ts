import { content, type SkillId } from '@shinobi/content';
import { levelAt, levelCap, xpAt, type GameState } from '@shinobi/core';

export interface SkillProgress {
  level: number;
  /** Fraction of the current level, 0..1. */
  fraction: number;
}

/** Level and progress to the next level of a skill. */
export function skillProgress(state: GameState, skill: SkillId): SkillProgress {
  const xp = state.skills[skill].xp;
  const cap = levelCap(content);
  const level = levelAt(xp, cap);
  if (level >= cap) return { level, fraction: 1 };
  const from = xpAt(level);
  const to = xpAt(level + 1);
  return { level, fraction: (xp - from) / (to - from) };
}
