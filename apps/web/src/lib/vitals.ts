import type { ContentDb } from '@shinobi/content';
import { currentHp, performerHpRegen, type GameState, type Rules } from '@shinobi/core';
import { formatHpRate, formatInt } from './format.ts';
import { t } from './i18n.ts';

/** The health of a performer for the screens: what it has, the most it can have, and what it regenerates per second. */
export interface Vitals {
  hp: number;
  max: number;
  /** Health per second out of a fight. */
  regen: number;
}

export function vitalsOf(state: GameState, slot: number, content: ContentDb, rules: Rules): Vitals {
  const { hp, max } = currentHp(state, slot, content);
  return { hp, max, regen: performerHpRegen(state, content, rules) };
}

/** `34 / 120`: the health as a pair of whole numbers (a fraction of a point is not shown). */
export const hpText = (v: Vitals): string =>
  `${formatInt(Math.floor(v.hp))} / ${formatInt(Math.round(v.max))}`;

/** `+0,4/с`: the regeneration, or an empty text when there is none. */
export const regenText = (v: Vitals): string =>
  v.regen > 0 ? t('vitals.regen', { rate: formatHpRate(v.regen) }) : '';
