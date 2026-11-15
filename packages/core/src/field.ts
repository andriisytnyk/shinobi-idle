import type { ContentDb, SkillId } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { addItem, hasItem, removeItem } from './bank.ts';
import {
  MS_PER_SECOND,
  SECONDS_PER_HOUR,
  masteryLevel,
  masteryXpPerAction,
  rate,
} from './formulas.ts';
import { indexOf } from './lookup.ts';
import { computeMod } from './modifiers.ts';
import { gainXp, grantMastery } from './progression.ts';
import type { Req } from './requirements.ts';
import { nextFloat } from './rng.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** One herb's bush: herbs left, how many it held when it last filled, and work kept while it regrows. */
export interface Bush {
  stock: number;
  size: number;
  /** Work done on the regrow cycle when gathering stopped; only an empty bush keeps any. */
  carry: number;
}

/** The bush of a herb as the player left it; a herb never gathered has none. */
export function bushOf(state: GameState, herb: string): Bush | null {
  return state.bushes[herb] ?? null;
}

/** How many herbs a bush yields before it must regrow: the base stock plus the herb's mastery level. */
export function bushSize(state: GameState, herb: string, content: ContentDb): number {
  return content.balance.K.field.stockBase + masteryLevel(state, herb, content);
}

/**
 * Seconds of one gather averaged over a whole bush, before modifiers: the base cycle plus the
 * regrow pause shared among the herbs of the bush. Rewards follow this, so XP per hour equals the
 * rate of the herb's level whatever the pause.
 */
export function gatherAverageSeconds(size: number, content: ContentDb): number {
  const K = content.balance.K;
  return K.gather + K.field.regrowMs / MS_PER_SECOND / size;
}

export const gatherKind: ActionKind = {
  has: (id, content) => indexOf(content).herbs.has(id),
  skill: () => 'herb',
  requirements(_state, id, content) {
    const herb = indexOf(content).herbs.get(id);
    if (!herb) return null;
    const extra: Req[] = herb.req ? [herb.req] : [];
    return { t: 'all', of: [...extra, { t: 'skill', skill: 'herb', level: herb.level }] };
  },
  intervalMs(state, id, content, rules) {
    const K = content.balance.K;
    const mod = computeMod(rules.modifierProviders, state, 'interval.skill.herb', content).total;
    const cycle = Math.max(1, Math.round(K.gather * MS_PER_SECOND * mod));
    // An empty bush regrows before the next herb: the pause is part of that cycle.
    return bushOf(state, id)?.stock === 0 ? cycle + K.field.regrowMs : cycle;
  },
  start(state, slot, id, content) {
    const target = state.slots[slot];
    const bush = bushOf(state, id);
    if (!bush) {
      const size = bushSize(state, id, content);
      state.bushes[id] = { stock: size, size, carry: 0 };
    } else if (target && bush.stock === 0) {
      // Regrowing only moves while the herb is gathered: resume where it was left.
      target.progress = bush.carry;
    }
  },
  stop(state, slot, id) {
    const bush = bushOf(state, id);
    if (bush) bush.carry = bush.stock === 0 ? (state.slots[slot]?.progress ?? 0) : 0;
  },
  complete(state, id, content, rules) {
    const herb = indexOf(content).herbs.get(id);
    if (!herb) return;
    const held = bushOf(state, id);
    // A bush found empty has regrown by now and is full again, to the size its mastery gives now.
    const fresh = bushSize(state, id, content);
    const bush: Bush = held && held.stock > 0 ? held : { stock: fresh, size: fresh, carry: 0 };
    state.bushes[id] = { stock: bush.stock - 1, size: bush.size, carry: 0 };
    addItem(state, id, 1);
    const seconds = gatherAverageSeconds(bush.size, content);
    gainXp(state, 'herb', (rate(herb.level, content) * seconds) / SECONDS_PER_HOUR, content, rules);
    grantMastery(state, id, 'herb', masteryXpPerAction(seconds, content), content);
  },
};

/** Mastery tier of a recipe, 1-based: how many of the tier thresholds its mastery level has reached. */
export function craftTier(state: GameState, recipe: string, content: ContentDb): number {
  const level = masteryLevel(state, recipe, content);
  return content.balance.K.craftRules.masteryTiers.filter((t) => level >= t).length;
}

/** Chance of one bonus unit per craft: a fixed share for every tier above the first. */
export function craftBonusChance(state: GameState, recipe: string, content: ContentDb): number {
  const K = content.balance.K;
  return Math.min(
    1,
    Math.max(0, (craftTier(state, recipe, content) - 1) * K.craftRules.bonusPerTier),
  );
}

/** Chance that a craft keeps its ingredients: the general and the per-skill `craft.keep` modifiers. */
export function craftKeepChance(
  state: GameState,
  skill: SkillId,
  content: ContentDb,
  rules: Rules,
): number {
  const providers = rules.modifierProviders;
  const general = computeMod(providers, state, 'craft.keep', content).total - 1;
  const own = computeMod(providers, state, `craft.keep.${skill}`, content).total - 1;
  return Math.min(1, Math.max(0, general + own));
}

/** The first ingredient of the recipe the bank lacks, or null when everything is there. */
function firstMissing(state: GameState, id: string, content: ContentDb): string | null {
  const recipe = indexOf(content).recipes.get(id);
  return recipe?.ingredients.find((i) => !hasItem(state, i.item, i.n))?.item ?? null;
}

export const craftKind: ActionKind = {
  has: (id, content) => indexOf(content).recipes.has(id),
  skill: (id, content) => indexOf(content).recipes.get(id)?.skill ?? null,
  requirements(_state, id, content) {
    const recipe = indexOf(content).recipes.get(id);
    if (!recipe) return null;
    return {
      t: 'all',
      of: [
        { t: 'skill', skill: recipe.skill, level: recipe.level },
        ...recipe.ingredients.map((i): Req => ({ t: 'item', id: i.item, n: i.n })),
      ],
    };
  },
  missing: (state, id, content) => firstMissing(state, id, content),
  intervalMs(state, id, content, rules) {
    const recipe = indexOf(content).recipes.get(id);
    if (!recipe) return 1;
    const mod = computeMod(
      rules.modifierProviders,
      state,
      `interval.skill.${recipe.skill}`,
      content,
    ).total;
    return Math.max(1, Math.round(content.balance.K.craft * MS_PER_SECOND * mod));
  },
  complete(state, id, content, rules) {
    const recipe = indexOf(content).recipes.get(id);
    if (!recipe) return;
    // Ingredients may have left the bank since the cycle began.
    if (firstMissing(state, id, content) !== null) return 'abort';
    const K = content.balance.K;
    const bonusChance = craftBonusChance(state, id, content);
    const bonus = bonusChance > 0 && nextFloat(state.rng, 'action') < bonusChance;
    const keepChance = craftKeepChance(state, recipe.skill, content, rules);
    const kept = keepChance > 0 && nextFloat(state.rng, 'action') < keepChance;
    if (!kept) for (const i of recipe.ingredients) removeItem(state, i.item, i.n);
    addItem(state, recipe.output.item, recipe.output.n + (bonus ? 1 : 0));
    const xp = (rate(recipe.level, content) * K.craft * K.craftXpMult) / SECONDS_PER_HOUR;
    gainXp(state, recipe.skill, xp, content, rules);
    grantMastery(state, id, recipe.skill, masteryXpPerAction(K.craft, content), content);
  },
};
