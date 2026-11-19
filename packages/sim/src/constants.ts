import type { ContentDb, NatureId, SkillId } from '@shinobi/content';
import { graduateRank, type Rank } from '@shinobi/core';

/*
 * The ids the sim package names on purpose. Everything else comes from the content database or
 * from the engine's own exports. These are the action kinds and skills the engine's rules refer to
 * by name (the basic attack, the field kinds) and the level at which a yardstick character is a Chunin.
 */

/** Action kinds of the engine's rule set the bots start. */
export const KIND_FIGHT = 'fight';
export const KIND_GATHER = 'gather';
export const KIND_CRAFT = 'craft';

/** The skills the engine's basic attack and its damage formulas read (`basicAttackOf`): the `tech` skills that no nature owns. */
export const basicSkills = (content: ContentDb): SkillId[] =>
  content.skills
    .filter((s) => s.activity === 'tech' && !content.natures.some((n) => n.id === s.id))
    .map((s) => s.id);

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

/** The ranks of the content, lowest first. */
export const ranksOf = (content: ContentDb): Rank[] => content.playerRanks.map((r) => r.id);

/** The rank of a player still at the Academy: the first of the content. */
export function studentRank(content: ContentDb): Rank {
  const first = content.playerRanks[0];
  if (!first) throw new Error('content lists no ranks');
  return first.id;
}

/** The first rank after the Academy: what the graduation exam grants. */
export function geninRank(content: ContentDb): Rank {
  const rank = graduateRank(content);
  if (rank === null) throw new Error('content lists no rank after the Academy');
  return rank;
}

/** The rank a yardstick character of a high level holds: the one after the graduation rank, or that one when there is none. */
export function chuninRank(content: ContentDb): Rank {
  const graduate = geninRank(content);
  const at = content.playerRanks.findIndex((r) => r.id === graduate);
  return content.playerRanks[at + 1]?.id ?? graduate;
}

/** The nature a yardstick character has when none is given: the first the content lists. */
export function defaultNature(content: ContentDb): NatureId {
  const first = content.natures[0];
  if (!first) throw new Error('content lists no natures');
  return first.id as NatureId;
}

/** Skills that earn their XP only in combat (vitality, evasion), from the content's skill groups. */
export const combatSkills = (content: ContentDb): SkillId[] =>
  content.skills.filter((s) => s.group === 'combat').map((s) => s.id);

/** Skills trained by casting techniques (taijutsu, ninjutsu, the natures), from the content's activities. */
export const styleSkills = (content: ContentDb): SkillId[] =>
  content.skills.filter((s) => s.activity === 'tech').map((s) => s.id);
