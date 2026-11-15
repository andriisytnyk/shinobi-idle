import type { ContentDb } from '@shinobi/content';
import { indexOf } from './lookup.ts';
import type { GameState } from './state.ts';

/*
 * Read-only views of the open vocabularies of the composed content: the order of the player
 * ranks, the currency that does each job, the skill that each activity trains, the natures.
 * The rules ask these instead of naming a skill, a rank or a currency of one pack.
 */

/** The position of a player rank in the order of ranks, lowest first; -1 for a rank the content does not know. */
export function rankIndex(content: ContentDb, rank: string): number {
  return indexOf(content).rankIndex.get(rank) ?? -1;
}

/** Whether `rank` is an Academy rank (held before graduation). An unknown rank is not. */
export function isAcademyRank(content: ContentDb, rank: string): boolean {
  return content.playerRanks[rankIndex(content, rank)]?.academy === true;
}

/** The first rank that is not an Academy rank (the graduation), or null when every rank is one. */
export function graduateRank(content: ContentDb): string | null {
  return indexOf(content).graduateRank;
}

/** The currency that has the role (`money`, `renown`, `study`), or null when none has it. */
export function currencyOf(content: ContentDb, role: string): string | null {
  return indexOf(content).currencyByRole.get(role) ?? null;
}

/** The currency that pays for things and that loot and missions pay: the one with the role `money`. */
export function moneyOf(content: ContentDb): string {
  const money = currencyOf(content, 'money');
  if (money === null) throw new Error('the content has no currency with the role money');
  return money;
}

/**
 * The skill that the action kind of an activity trains: the first skill of the content whose
 * `activity` it is (`drill`, `insight`, `course`, `patch`, `map`). Null when no skill has it.
 */
export function activitySkill(content: ContentDb, activity: string): string | null {
  return indexOf(content).activitySkill.get(activity) ?? null;
}

/** Whether `id` is a chakra nature of the content. */
export function isNature(content: ContentDb, id: string): boolean {
  return indexOf(content).natures.has(id);
}

/** Whether the skill trains techniques (its activity is `tech`). */
export function isTechSkill(content: ContentDb, id: string): boolean {
  return indexOf(content).techSkills.has(id);
}

/**
 * The XP record of a skill in the state; undefined for a skill the state does not have (the pack
 * of the skill is missing). Skill ids come from the content, whose ids are never names of `Object`. The widening keeps the narrow legacy keys of the state type out of the way.
 */
export function skillEntry(state: GameState, id: string): { xp: number } | undefined {
  const skills: Record<string, { xp: number }> = state.skills;
  return skills[id];
}

/** The pool record of a skill in the state; see `skillEntry`. */
export function poolEntry(state: GameState, id: string): { xp: number } | undefined {
  const pools: Record<string, { xp: number }> = state.pools;
  return pools[id];
}

/** Whether the player owns the nature. */
export function ownsNature(state: GameState, nature: string): boolean {
  const owned: readonly string[] = state.player.natures;
  return owned.includes(nature);
}

/** The pack that owns an id: the part before the colon, or `core` for a bare id. */
export function packOfId(id: string): string {
  const colon = id.indexOf(':');
  return colon < 0 ? 'core' : id.slice(0, colon);
}
