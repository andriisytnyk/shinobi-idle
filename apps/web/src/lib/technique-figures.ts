import type { ContentDb, Technique } from '@shinobi/content';
import { techniqueNumbers, type GameState, type Rules, type TechniqueNumbers } from '@shinobi/core';
import { skillProgress } from './progress.ts';

/** One factor of a figure: a text key for its name and its value (a multiplier, or a base amount for the first row). */
export interface Factor {
  key: string;
  value: number;
  /** The first row is the base amount, the others multiply it. */
  base?: boolean;
}

export interface TechniqueFigures {
  numbers: TechniqueNumbers;
  /** What the damage is made of; null for a technique that does none. */
  damage: Factor[] | null;
  /** What the cost is made of; `other` carries what the rows do not name (the chakra-control skill, gear, mods). */
  cost: Factor[];
  /** The mastery level these figures were computed for, and its cap. */
  mastery: { level: number; cap: number };
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/**
 * The fight numbers of a technique for the player as he is now, with the factors that make them up.
 * The totals come from the core (`techniqueNumbers`); the rows only split them, and what the rows
 * do not explain is shown as one more factor, so the rows always multiply out to the total.
 */
export function techniqueFigures(
  state: GameState,
  tech: Technique,
  content: ContentDb,
  rules: Rules,
  masteryLevel: number,
): TechniqueFigures {
  const K = content.balance.K;
  const numbers = techniqueNumbers(state, tech, content, rules);
  const share = masteryLevel / K.masteryCap;
  const role = K.role[tech.role];
  const rank = tech.rank;

  let damage: Factor[] | null = null;
  if (rank !== null && !tech.noDamage && role && numbers.damage > 0) {
    const level = skillProgress(state, tech.skill).level;
    damage = [
      { key: 'technique.factor.power', value: K.power[rank] ?? 0, base: true },
      { key: 'technique.factor.role', value: role.m },
      { key: 'technique.factor.tier', value: K.tierMult[`${tech.tier}`] ?? 1 },
      { key: 'technique.factor.level', value: 1 + K.levelScale * level },
      { key: 'technique.factor.mastery', value: 1 + K.masteryDmg * share },
    ];
    const product = damage.reduce((acc, f) => acc * f.value, 1);
    if (!near(product, numbers.damage) && product > 0) {
      damage.push({ key: 'technique.factor.other', value: numbers.damage / product });
    }
  }

  const cost: Factor[] = [];
  if (rank !== null && role && numbers.cost > 0) {
    const table = numbers.pool === 'stamina' ? K.staminaCost : K.chakraCost;
    cost.push(
      { key: 'technique.factor.baseCost', value: table[rank] ?? 0, base: true },
      { key: 'technique.factor.role', value: role.c },
      { key: 'technique.factor.mastery', value: 1 - K.masteryCost * share },
    );
    const product = cost.reduce((acc, f) => acc * f.value, 1);
    if (!near(product, numbers.cost) && product > 0) {
      cost.push({ key: 'technique.factor.other', value: numbers.cost / product });
    }
  }

  return { numbers, damage, cost, mastery: { level: masteryLevel, cap: K.masteryCap } };
}
