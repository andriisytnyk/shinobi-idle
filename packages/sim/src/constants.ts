import { NATURE_IDS, type ContentDb, type NatureId, type SkillId } from '@shinobi/content';
import { RANK_ORDER, type Rank } from '@shinobi/core';

/*
 * The ids the sim package names on purpose. Everything else comes from the content database or
 * from the engine's own exports. These are the action kinds and skills the engine's rules refer to
 * by name (the basic attack, the field kinds) and the level at which a yardstick character is a Chunin.
 */

/** Action kinds of the engine's rule set the bots start. */
export const KIND_FIGHT = 'fight';
export const KIND_GATHER = 'gather';
export const KIND_CRAFT = 'craft';

/** The skills the engine's basic attack and its damage formulas read (`basicAttackOf`). */
export const BASIC_SKILLS: readonly SkillId[] = ['tai', 'nin'];

/** Level from which a yardstick character is a Chunin (the content has no Chunin exam yet). */
export const CHUNIN_FROM_LEVEL = 40;

/** Report thresholds of `pnpm sim fight`. They mark rows for a human to look at; they are not balance. */
export const REPORT = {
  /** Engine mean fight time over the model's time to kill: inside this band a row is not marked. */
  ratioBand: [0.6, 1.6] as const,
  /** An ordinary enemy is marked below this win rate. */
  enemyMinWin: 0.9,
  /** A boss is marked outside this win-rate band. */
  bossWinBand: [0.6, 0.95] as const,
  /** A ratio resting on fewer won fights than this is printed in brackets and marked. */
  minWinsForRatio: 5,
} as const;

/** The ranks, lowest first, from the engine. */
export const RANKS: readonly Rank[] = RANK_ORDER;
export const RANK_STUDENT: Rank = RANK_ORDER[0] ?? 'student';
export const RANK_GENIN: Rank = RANK_ORDER[1] ?? 'genin';
export const RANK_CHUNIN: Rank = RANK_ORDER[2] ?? 'chunin';

/** The nature a yardstick character has when none is given: the first the content lists. */
export function defaultNature(): NatureId {
  const first = NATURE_IDS[0];
  if (!first) throw new Error('content lists no natures');
  return first;
}

/** Skills that earn their XP only in combat (vitality, evasion), from the content's skill groups. */
export const combatSkills = (content: ContentDb): SkillId[] =>
  content.skills.filter((s) => s.group === 'combat').map((s) => s.id);

/** Skills trained by casting techniques (taijutsu, ninjutsu, the natures), from the content's activities. */
export const styleSkills = (content: ContentDb): SkillId[] =>
  content.skills.filter((s) => s.activity === 'tech').map((s) => s.id);
