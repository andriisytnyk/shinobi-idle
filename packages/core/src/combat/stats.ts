import type { ContentDb, SkillId, Technique } from '@shinobi/content';
import { masteryLevel } from '../formulas.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import {
  accuracyOf,
  basicAttackOf,
  chakraRegenOf,
  evasionOf,
  evasionParts,
  type EvasionPart,
  maxChakraOf,
  maxHpOf,
  maxStaminaOf,
  staminaRegenOf,
  techniqueFigures,
  type BasicAttack,
  type TechniqueNumbers,
} from './numbers.ts';
import { levelsOf, planningSnapshot, snapshotPlayer } from './snapshot.ts';

/*
 * The player's combat numbers read straight from a game state. The formulas live in `numbers.ts`
 * and run on a `PlayerSnapshot`; these wrappers only build the levels they need.
 */

export const playerMaxHp = (state: GameState, content: ContentDb): number =>
  maxHpOf(levelsOf(state, content), content);

export const playerMaxChakra = (state: GameState, content: ContentDb): number =>
  maxChakraOf(levelsOf(state, content), content);

export const playerChakraRegen = (state: GameState, content: ContentDb): number =>
  chakraRegenOf(levelsOf(state, content), content);

export const playerMaxStamina = (state: GameState, content: ContentDb): number =>
  maxStaminaOf(levelsOf(state, content), content);

export const playerStaminaRegen = (state: GameState, content: ContentDb): number =>
  staminaRegenOf(levelsOf(state, content), content);

export const playerEvasion = (state: GameState, content: ContentDb, rules?: Rules): number =>
  evasionOf(
    rules ? snapshotPlayer(state, content, rules) : planningSnapshot(state, content),
    content,
  );

/** The parts of the player's evasion rating, each with its source: the rank, every known defensive technique, gear. */
export const playerEvasionParts = (
  state: GameState,
  content: ContentDb,
  rules?: Rules,
): EvasionPart[] =>
  evasionParts(
    rules ? snapshotPlayer(state, content, rules) : planningSnapshot(state, content),
    content,
  );

/** Accuracy rating when attacking with a technique of `skill`. */
export const playerAccuracy = (state: GameState, skill: SkillId, content: ContentDb): number =>
  accuracyOf(levelsOf(state, content), skill, content);

/** The skill level a basic attack uses: the higher of Taijutsu and Ninjutsu. */
export function basicSkillLevel(state: GameState, content: ContentDb): number {
  const levels = levelsOf(state, content);
  return Math.max(levels.tai ?? 1, levels.nin ?? 1);
}

export const basicAttack = (state: GameState, content: ContentDb): BasicAttack =>
  basicAttackOf(levelsOf(state, content), content);

/** Everything a technique does in a fight, for this player. */
export function techniqueNumbers(
  state: GameState,
  tech: Technique,
  content: ContentDb,
  rules: Rules,
): TechniqueNumbers {
  const snapshot = snapshotPlayer(state, content, rules);
  snapshot.mastery[tech.id] = masteryLevel(state, tech.id, content);
  return techniqueFigures(snapshot, tech, content);
}
