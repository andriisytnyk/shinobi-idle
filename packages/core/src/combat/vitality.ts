import type { ContentDb } from '@shinobi/content';
import { MS_PER_SECOND } from '../formulas.ts';
import { bonusOf } from '../modifiers.ts';
import { actingBody, asPerformer, fightOf } from '../performer.ts';
import { skillLevel } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { System } from '../system.ts';
import { woundFactor } from './fight.ts';
import { holdsFight } from './system.ts';
import { VITALITY_SKILL, hpRegenOf, maxHpOf, vitalityLevels, type Levels } from './numbers.ts';

/*
 * The health of a performer is the performer's state, not one fight's: it lives in `state.player.hp` (the character)
 * and `CloneBody.hp` (a clone), carries over from fight to fight and from action to action, and is restored only by
 * regeneration, food and pills. While a fight runs, the fight's own player body holds the live number and the state
 * keeps what it was at the last step of the fight; the fight writes it back at every step (`setPerformerHp`).
 *
 * Regeneration outside a fight is a closed form on whole numbers: health is counted in millionths of a point, the rate
 * is rounded to whole units per millisecond once per span, and a span adds rate x ms. Adding a span in pieces gives
 * the same number, so the result does not depend on how `advance` cut the time. Inside a fight the same rate (HP per
 * second) is applied at every regeneration step of the fight, next to chakra and stamina.
 */

/** Health is kept in whole millionths of a point while it regenerates, so that splitting a span changes nothing. */
const HP_UNIT = 1_000_000;

/** The performer whose state is read: the clone being computed, or the character. */
const holder = (state: GameState): { hp: number } => actingBody(state) ?? state.player;

/** Levels the health numbers read, built from the state (only Vitality counts). */
const vitLevels = (state: GameState, content: ContentDb): Levels =>
  vitalityLevels(skillLevel(state, VITALITY_SKILL, content));

/** The maximum health of the performers now: Vitality, with the Wounds taken off. */
export function performerMaxHp(state: GameState, content: ContentDb): number {
  return maxHpOf(vitLevels(state, content), content) * woundFactor(state.wounds.stacks, content);
}

/** Health regenerated per second: the base and the Vitality gain of the balance, and the `hp.regen` modifiers (flat HP per second). */
export function performerHpRegen(state: GameState, content: ContentDb, rules: Rules): number {
  const bonus = bonusOf(rules, state, 'hp.regen', content);
  return Math.max(0, hpRegenOf(vitLevels(state, content), content) + bonus);
}

/** The health the performer being computed has stored (not the live number of a fight in progress; see `currentHp`). */
export const performerHp = (state: GameState): number => holder(state).hp;

/** Stores the health of the performer being computed, within [0, maximum]. */
export function setPerformerHp(state: GameState, hp: number, content: ContentDb): void {
  holder(state).hp = Math.min(performerMaxHp(state, content), Math.max(0, hp));
}

/**
 * The health of the performer of `slot` right now, and the most it can be: what a fight in progress has, or what is
 * stored (the regeneration that has run since the last event is already counted). The state is read, not changed.
 */
export function currentHp(
  state: GameState,
  slot: number,
  content: ContentDb,
): { hp: number; max: number } {
  const max = performerMaxHp(state, content);
  const fight = fightOf(state, slot);
  if (fight?.phase === 'fight' && holdsFight(state, slot)) {
    return { hp: Math.min(max, Math.max(0, fight.fight.player.hp)), max };
  }
  const stored = slot > 0 ? state.clones[slot]?.hp : state.player.hp;
  return { hp: Math.min(max, Math.max(0, stored ?? max)), max };
}

/** The health after `ms` of regeneration at `perSecond` HP per second, on whole millionths; never above `max`. */
export function regenerated(hp: number, perSecond: number, ms: number, max: number): number {
  const units = Math.round(hp * HP_UNIT) + Math.round((perSecond * HP_UNIT) / MS_PER_SECOND) * ms;
  return Math.min(max, units / HP_UNIT);
}

function regenOf(
  state: GameState,
  slot: number,
  dt: number,
  content: ContentDb,
  rules: Rules,
): void {
  const fight = fightOf(state, slot);
  // The live number of a fight in progress is the fight's: it regenerates on the fight's own steps.
  if (fight?.phase === 'fight' && holdsFight(state, slot)) return;
  const max = performerMaxHp(state, content);
  const own = holder(state);
  if (own.hp >= max) {
    own.hp = max;
    return;
  }
  own.hp = regenerated(own.hp, performerHpRegen(state, content, rules), dt, max);
}

/**
 * Passive health regeneration of every performer that is not in a fight: between fights (the pause before the next
 * one), during any other action, and while the game is closed. It never has an event of its own.
 */
export const vitalitySystem: System = {
  nextEventIn: () => null,

  elapse(state, dt, content, rules) {
    regenOf(state, 0, dt, content, rules);
    for (const key of Object.keys(state.clones)) {
      const slot = Number(key);
      if (state.clones[slot]) {
        asPerformer(state, slot, () => regenOf(state, slot, dt, content, rules));
      }
    }
  },

  run() {},
};
