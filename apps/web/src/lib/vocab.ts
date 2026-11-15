import type { ContentDb } from '@shinobi/content';
import { moneyOf, rankIndex, type GameState } from '@shinobi/core';
import { localeKey } from '@shinobi/content';
import { humanId } from './entities.ts';
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

/** The name of a mission rank: its own text, or its readable id. */
export const missionRankName = (id: string): string =>
  textOf([`mission.rank.${id}.name`, `missionRank.${id}.name`], {}, humanId(id));

/** The description of a mission rank, when its pack wrote one (a pack's key is `missionRank.<id>.desc`). */
export const missionRankDesc = (id: string): string | null => {
  const key = [`mission.rank.${id}.desc`, `missionRank.${id}.desc`].find(hasKey);
  return key ? t(key) : null;
};

/** The text of `key`, or the readable id when no locale has it: a pack entity never shows a raw key. */
const textOrId = (key: string, id: string): string => (hasKey(key) ? t(key) : humanId(id));

/** The name of a village resource. */
export const resourceName = (id: string): string => textOrId(`resource.${id}.name`, id);

/** The name of a teammate. */
export const teammateName = (id: string): string => textOrId(`teammate.${id}.name`, id);

/** The name of an item kind (`ingredient`, a pack's own). */
export const itemKindName = (id: string): string => textOrId(`item.kind.${id}`, id);

/** The heading of a shop section: the building's slug, with the core's own words for the old ones. */
export const shopSectionName = (id: string): string => textOrId(`shop.section.${id}`, id);

/** The name of a modifier key a pack declares: `modifier.<key>` in its locale, else the readable key. */
export const modifierName = (key: string): string => textOrId(`modifier.${key}`, key);

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

/** The rank after `id` that has an exam to take, or null when none is left. */
export function nextExamRank(content: ContentDb, id: string): string | null {
  const from = rankIndex(content, id);
  for (const rank of content.playerRanks.slice(from + 1)) {
    if (content.exams.some((e) => e.rank === rank.id)) return rank.id;
  }
  return null;
}

/** What the core says about the currency roles, natures and activities: the interface asks it. */
export {
  activitySkill as skillByActivity,
  currencyOf,
  graduateRank,
  isAcademyRank,
  isNature,
  moneyOf,
  rankIndex,
} from '@shinobi/core';

/** The name of the money currency, in the nominative: «Рьо» in «Рьо у тебе: 5». */
export const moneyName = (content: ContentDb): string => currencyName(moneyOf(content));

/** How much of a currency the player holds; a currency the save does not know holds none. */
export const held = (state: GameState, id: string): number =>
  (state.currencies as Record<string, number | undefined>)[id] ?? 0;

/**
 * A short Ukrainian phrase for why a rule of a pack was switched off, for the reasons that are
 * known; the technical text stays in the detail.
 */
export function ruleReasonText(reason: string): string {
  if (/cannot read|undefined|is not a function|is not iterable|null/i.test(reason))
    return t('settings.why.data');
  if (/stack|stuck|loop|too many|timeout/i.test(reason)) return t('settings.why.stuck');
  return t('settings.why.other');
}
