import type { ContentDb } from '@shinobi/content';
import type { GameState } from '@shinobi/core';
import { localeKey } from '@shinobi/content';
import { hasKey, t, textOf } from './i18n.ts';

/*
 * What the interface says and shows about the vocabularies of the content: ranks, currencies,
 * natures and skill groups. Each of them is a list of the running game's content, so the interface
 * iterates the list and never names a member.
 */

/** The text of a rank: `rank.<id>`. */
export const rankName = (id: string): string => textOf([`rank.${id}`]);

/** The name of a currency: `currency.<id>`. */
export const currencyName = (id: string): string => textOf([`currency.${id}`]);

/** The name of a nature: its own text, or the text of the skill that carries the nature's name. */
export const natureName = (id: string): string => textOf([`nature.${id}.name`, `skill.${id}.name`]);

/** The name of a skill group. */
export const groupName = (id: string): string => t(localeKey('group', id, 'name'));

/** The one-line character of a nature, when its pack wrote one. */
export function natureCharacter(id: string): string | null {
  const key = `nature.character.${id}`;
  return hasKey(key) ? t(key) : null;
}

/**
 * The colour of a nature as a CSS value: the token its data names, or the neutral token for an id
 * that is no nature. A token that the page does not define makes the declaration invalid at
 * computed-value time, so text and icons inherit and the styles that read it give a neutral
 * fallback (`var(--nature-color, var(--steel))`).
 */
export function natureColor(content: ContentDb, id: string): string {
  const nature = content.natures.find((n) => n.id === id);
  return nature ? `var(${nature.color})` : 'var(--steel)';
}

/** The entity whose icon a nature wears: the skill of its id when there is one, else the nature itself. */
export const natureIconRef = (
  content: ContentDb,
  id: string,
): { kind: 'skill' | 'nature'; id: string } =>
  content.skills.some((s) => s.id === id) ? { kind: 'skill', id } : { kind: 'nature', id };

/** Whether `id` is a nature of the content (a skill of the same id is the nature's skill). */
export const isNature = (content: ContentDb, id: string): boolean =>
  content.natures.some((n) => n.id === id);

/** The ranks in order, as ids. */
export const rankIds = (content: ContentDb): string[] => content.playerRanks.map((r) => r.id);

/** Position of a rank in the list; -1 for one that is not in it. */
export const rankIndex = (content: ContentDb, id: string): number =>
  content.playerRanks.findIndex((r) => r.id === id);

/** The rank after `id` that has an exam to take, or null when none is left. */
export function nextExamRank(content: ContentDb, id: string): string | null {
  const from = rankIndex(content, id);
  for (const rank of content.playerRanks.slice(from + 1)) {
    if (content.exams.some((e) => e.rank === rank.id)) return rank.id;
  }
  return null;
}

/** The first rank: where a new player starts. */
export const startRank = (content: ContentDb): string => content.playerRanks[0]?.id ?? '';

/**
 * The rank a player reaches by the first promotion. Trainer techniques of mentors away from the
 * Academy, the pouch and the natures wait for it (the core rule: «not the starting rank»).
 */
export const promotedRank = (content: ContentDb): string =>
  content.playerRanks[1]?.id ?? startRank(content);

/** The currency that shops, the village and gear are priced in: the first of the list. */
export const moneyOf = (content: ContentDb): string => content.currencies[0]?.id ?? '';

/** The name of the money currency in running text (lower case): «рьо» in «У тебе 5 рьо». */
export const moneyName = (content: ContentDb): string =>
  currencyName(moneyOf(content)).toLowerCase();

/**
 * The currency the map rules pay for exploring. The core names it in its state and balance
 * (`K.intel`) but not in data yet, so the interface follows the core here: this is the one place.
 */
export const INTEL = 'intel';

/** The first skill that trains by this activity (`skill.activity`): the skill whose page holds that kind of action. */
export const skillByActivity = (content: ContentDb, activity: string): string | null =>
  content.skills.find((s) => s.activity === activity)?.id ?? null;

/** How much of a currency the player holds; a currency the save does not know holds none. */
export const held = (state: GameState, id: string): number =>
  (state.currencies as Record<string, number | undefined>)[id] ?? 0;
