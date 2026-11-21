import type { ContentDb } from '@shinobi/content';
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
  tech: { cast: number },
  masteryLvl: number,
  content: ContentDb,
  nonNativeLevel?: number,
): number {
  const K = content.balance.K;
  const stretch = nonNativeLevel === undefined ? 1 : nonNativeCastMult(nonNativeLevel, content);
  // The cast is a number of the technique: mastery shortens it down to the floor, the seals do not count.
  const trimmed = tech.cast * (1 - (K.masteryCast * masteryLvl) / K.masteryCap);
  return Math.max(K.castFloor, trimmed) * stretch;
}

/** Seconds of focus before the cast when practising a technique that needs `level`: later techniques ask for more. */
export function practiceFocusSeconds(level: number, content: ContentDb): number {
  const f = content.balance.K.practiceFocus;
  return f.base + f.perLevel * Math.max(0, level - 1);
}

/** Seconds between completions of a practice with the given cast time, of a technique that needs `level`. */
export function practiceIntervalSeconds(
  castSeconds: number,
  content: ContentDb,
  level = 1,
): number {
  const K = content.balance.K;
  return Math.max(
    K.practiceMin,
    castSeconds * K.practiceCast + practiceFocusSeconds(level, content),
  );
}

/**
 * Mastery XP per second of an action whose mastery is at `level`: after Melvor's formula, an action pays
 * more the higher its own mastery level is (`K.mastery`: `perSecond × (base + level)`).
 */
export function masteryXpPerSecond(level: number, content: ContentDb): number {
  const m = content.balance.K.mastery;
  return m.perSecond * (m.base + Math.max(1, level));
}

/** Mastery XP earned by one completed action of `seconds` (unmodified cycle) while its mastery is at `level`. */
export function masteryXpPerAction(level: number, seconds: number, content: ContentDb): number {
  return masteryXpPerSecond(level, content) * seconds;
}

/** Mastery XP of one hour of an action at mastery `level`. */
export function masteryXpPerHour(level: number, content: ContentDb): number {
  return masteryXpPerSecond(level, content) * SECONDS_PER_HOUR;
}

/** The kinds of action whose cycle and XP are data: `K.<kind>` is the first-tier cycle of each. */
export type PacedKind = 'drill' | 'meditate' | 'gather' | 'obstacle' | 'craft';

/** The pace facts an entity of a paced kind carries in its data. */
export interface Paced {
  level: number;
  cycle?: number | undefined;
  xp?: number | undefined;
}

/** Seconds of one cycle before modifiers: the explicit number of the action, else the first-tier cycle of its kind. */
export function cycleSeconds(kind: PacedKind, action: Paced, content: ContentDb): number {
  return action.cycle ?? content.balance.K[kind];
}

/**
 * Herbs a bush of `size` gives over a long session of steady gathering at `cycle` seconds per herb: it regrows one
 * herb every `K.field.regrowEachMs` meanwhile, so it holds out `size / (1 - cycle / each)` herbs before it is empty.
 * A cycle not shorter than the regrow never empties it (Infinity).
 */
export function gatherRunLength(cycle: number, size: number, content: ContentDb): number {
  const ratio = (cycle * MS_PER_SECOND) / content.balance.K.field.regrowEachMs;
  return ratio >= 1 ? Infinity : size / (1 - ratio);
}

/** Seconds of the empty-bush pause that fall on one herb over a long session: `K.field.regrowMs` shared by the run. */
export function gatherPauseShare(cycle: number, size: number, content: ContentDb): number {
  return content.balance.K.field.regrowMs / MS_PER_SECOND / gatherRunLength(cycle, size, content);
}

/**
 * Skill XP one completed cycle pays before modifiers: the explicit number of the action, else the
 * pace of its level times its cycle (a craft pays `K.craftXpMult` times that; a herb also its share of
 * the regrow pause of a first-size bush). It never depends on mastery.
 */
export function cycleXp(kind: PacedKind, action: Paced, content: ContentDb): number {
  if (action.xp !== undefined) return action.xp;
  const K = content.balance.K;
  const cycle = cycleSeconds(kind, action, content);
  const pause = kind === 'gather' ? gatherPauseShare(cycle, K.field.stockBase + 1, content) : 0;
  const mult = kind === 'craft' ? K.craftXpMult : 1;
  return (rate(action.level, content) * (cycle + pause) * mult) / SECONDS_PER_HOUR;
}

/** The practice cycle of a technique at mastery 1 of the player's own nature, in seconds: what its XP is set against. */
export function practiceReferenceSeconds(
  tech: { level: number; cast: number },
  content: ContentDb,
): number {
  return practiceIntervalSeconds(techniqueCastSeconds(tech, 1, content), content, tech.level);
}

/** Skill XP one completed practice cycle pays before modifiers: the technique's explicit number, else the pace of its level times its reference cycle. */
export function practiceXp(
  tech: { level: number; cast: number; practiceXp?: number | undefined },
  content: ContentDb,
): number {
  return (
    tech.practiceXp ??
    (rate(tech.level, content) * practiceReferenceSeconds(tech, content)) / SECONDS_PER_HOUR
  );
}

/** Pool XP that flows into the skill pool for a given amount of mastery XP. */
export function poolGain(masteryXp: number, content: ContentDb): number {
  return masteryXp * content.balance.K.poolShare;
}

/** Pool capacity of a skill: a fixed amount per mastery the skill owns. */
export function poolCapacity(skill: string, content: ContentDb): number {
  return content.balance.K.poolCapPerItem * (indexOf(content).masteryCount.get(skill) ?? 0);
}
