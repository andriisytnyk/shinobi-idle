import type { ContentDb, SkillId } from '@shinobi/content';
import { indexOf } from './lookup.ts';
import type { GameState } from './state.ts';
import { levelAt } from './xp.ts';

/** Unit conversion, not a balance number. */
export const SECONDS_PER_HOUR = 3600;
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = SECONDS_PER_HOUR * MS_PER_SECOND;

/** Skill XP per hour of an action unlocked at `actionLevel`. */
export function rate(actionLevel: number, content: ContentDb): number {
  const K = content.balance.K;
  const level = Math.min(Math.max(actionLevel, 1), K.cap);
  return K.rateBase * K.rateGrowth ** level;
}

/** Mastery level of a mastery key (0 xp is level 1). */
export function masteryLevel(state: GameState, key: string, content: ContentDb): number {
  return levelAt(state.mastery[key]?.xp ?? 0, content.balance.K.masteryCap);
}

/**
 * How much longer a technique of a non-native nature casts: 1 + K.nonNativeCast at skill level 1,
 * shrinking linearly to 1 at the level the penalty ends (50).
 */
export function nonNativeCastMult(skillLvl: number, content: ContentDb): number {
  const K = content.balance.K;
  const end = K.natures.penaltyEnd;
  const left = Math.min(1, Math.max(0, (end - skillLvl) / (end - 1)));
  return 1 + K.nonNativeCast * left;
}

/**
 * Cast time in seconds. Mastery trims the seal count, but a technique with seals keeps at least
 * one. `nonNativeLevel` is the skill level of a technique of a non-native nature (see
 * `nonNativeLevel` in natures.ts); it stretches the cast. Practice and fights both come through here.
 */
export function techniqueCastSeconds(
  sealCount: number,
  masteryLvl: number,
  content: ContentDb,
  nonNativeLevel?: number,
): number {
  const K = content.balance.K;
  const stretch = nonNativeLevel === undefined ? 1 : nonNativeCastMult(nonNativeLevel, content);
  if (sealCount === 0) return K.castBase * stretch;
  const trimmed = sealCount * (1 - (K.masteryCast * masteryLvl) / K.masteryCap);
  return (K.castBase + K.castPerSeal * Math.max(1, trimmed)) * stretch;
}

/** Seconds between completions of a practice with the given cast time. */
export function practiceIntervalSeconds(castSeconds: number, content: ContentDb): number {
  const K = content.balance.K;
  return Math.max(K.practiceMin, castSeconds + K.practiceRecovery);
}

/** Mastery XP earned by one completed action of `intervalSeconds`. */
export function masteryXpPerAction(intervalSeconds: number, content: ContentDb): number {
  return (content.balance.K.masteryPerHour * intervalSeconds) / SECONDS_PER_HOUR;
}

/** Pool XP that flows into the skill pool for a given amount of mastery XP. */
export function poolGain(masteryXp: number, content: ContentDb): number {
  return masteryXp * content.balance.K.poolShare;
}

/** Pool capacity of a skill: a fixed amount per mastery the skill owns. */
export function poolCapacity(skill: SkillId, content: ContentDb): number {
  return content.balance.K.poolCapPerItem * (indexOf(content).masteryCount.get(skill) ?? 0);
}
