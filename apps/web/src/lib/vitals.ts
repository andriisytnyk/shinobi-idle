import type { ContentDb } from '@shinobi/content';
import {
  asPerformer,
  currentHp,
  fightOf,
  performerHpRegen,
  type GameState,
  type Rules,
} from '@shinobi/core';
import { formatHpRate, formatInt } from './format.ts';
import { t } from './i18n.ts';

/** The health of a performer for the screens: what it has, the most it can have, and what it regenerates per second. */
export interface Vitals {
  hp: number;
  max: number;
  /** Health per second now: out of a fight the whole rate, in a fight its share (`combat.hpRegenShare`). */
  regen: number;
}

export function vitalsOf(state: GameState, slot: number, content: ContentDb, rules: Rules): Vitals {
  const { hp, max } = currentHp(state, slot, content);
  // A clone's rate is read as the clone: its own modifiers (the character's tonics are not its).
  const rate =
    slot > 0
      ? asPerformer(state, slot, () => performerHpRegen(state, content, rules))
      : performerHpRegen(state, content, rules);
  const fighting = fightOf(state, slot)?.phase === 'fight';
  return { hp, max, regen: fighting ? rate * content.balance.K.combat.hpRegenShare : rate };
}

/** `34 / 120`: the health as a pair of whole numbers (a fraction of a point is not shown). */
export const hpText = (v: Vitals): string =>
  `${formatInt(Math.floor(v.hp))} / ${formatInt(Math.round(v.max))}`;

/** `+0,4/с`: the regeneration, or an empty text when there is none. */
export const regenText = (v: Vitals): string =>
  v.regen > 0 ? t('vitals.regen', { rate: formatHpRate(v.regen) }) : '';
