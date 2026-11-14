import { content } from '@shinobi/content';
import { createState, levelAt, levelCap, xpAt } from '@shinobi/core';

/** Placeholder game state for the app shell. The reactive store arrives with the stage 1 core. */
export const state = createState(1, content);

export interface SkillProgress {
  level: number;
  /** Fraction of the current level, 0..1. */
  fraction: number;
}

export function skillProgress(skill: keyof typeof state.skills): SkillProgress {
  const xp = state.skills[skill].xp;
  const cap = levelCap(content);
  const level = levelAt(xp, cap);
  if (level >= cap) return { level, fraction: 1 };
  const from = xpAt(level);
  const to = xpAt(level + 1);
  return { level, fraction: (xp - from) / (to - from) };
}
