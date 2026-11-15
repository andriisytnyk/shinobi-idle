import type { ContentDb } from '@shinobi/content';
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
import { bonusOf, computeMod, cycleFactor } from './modifiers.ts';
import { gainXp, grantMastery } from './progression.ts';
import type { Req } from './requirements.ts';
import { nextFloat } from './rng.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { activitySkill, entitySkill } from './vocab.ts';

/** The skill that gathers herbs: the one whose activity is `patch` (Herbalism). */
export const gatherSkill = (content: ContentDb): string | null => activitySkill(content, 'patch');

/** The skill that gathers a herb: the one it names, else the first with the activity `patch`. */
export const herbSkill = (
  content: ContentDb,
  herb: { skill?: string | undefined },
): string | null => entitySkill(content, 'patch', herb);

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

/**
 * How many herbs a bush yields before it must regrow: the base stock plus the herb's mastery level
 * plus the `bush.stock` modifiers (whole herbs).
 */
export function bushSize(state: GameState, herb: string, content: ContentDb, rules: Rules): number {
  const extra = Math.round(bonusOf(rules.modifierProviders, state, 'bush.stock', content));
  return Math.max(
    1,
    content.balance.K.field.stockBase + masteryLevel(state, herb, content) + extra,
  );
}

/** Regrow pause of an empty bush in ms, after the `bush.regrow` modifiers. */
export function regrowMs(state: GameState, content: ContentDb, rules: Rules): number {
  const mod = computeMod(rules.modifierProviders, state, 'bush.regrow', content).total;
  return Math.max(0, Math.round(content.balance.K.field.regrowMs * mod));
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
  has: (id, content) => {
    const herb = indexOf(content).herbs.get(id);
    return herb !== undefined && herbSkill(content, herb) !== null;
  },
  skill: (id, content) => {
    const herb = indexOf(content).herbs.get(id);
    return herb ? herbSkill(content, herb) : null;
  },
  requirements(_state, id, content) {
    const herb = indexOf(content).herbs.get(id);
    const skill = herb ? herbSkill(content, herb) : null;
    if (!herb || skill === null) return null;
    const extra: Req[] = herb.req ? [herb.req] : [];
    return { t: 'all', of: [...extra, { t: 'skill', skill, level: herb.level }] };
  },
  intervalMs(state, id, content, rules) {
    const K = content.balance.K;
    const herb = indexOf(content).herbs.get(id);
    const mod = cycleFactor(
      rules.modifierProviders,
      state,
      (herb && herbSkill(content, herb)) ?? '',
      content,
    );
    const cycle = Math.max(1, Math.round(K.gather * MS_PER_SECOND * mod));
    // An empty bush regrows before the next herb: the pause is part of that cycle.
    return bushOf(state, id)?.stock === 0 ? cycle + regrowMs(state, content, rules) : cycle;
  },
  start(state, slot, id, content, rules) {
    const target = state.slots[slot];
    const bush = bushOf(state, id);
    if (!bush) {
      const size = bushSize(state, id, content, rules);
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
    const skill = herb ? herbSkill(content, herb) : null;
    if (!herb || skill === null) return;
    const held = bushOf(state, id);
    // A bush found empty has regrown by now and is full again, to the size its mastery gives now.
    const fresh = bushSize(state, id, content, rules);
    const bush: Bush = held && held.stock > 0 ? held : { stock: fresh, size: fresh, carry: 0 };
    state.bushes[id] = { stock: bush.stock - 1, size: bush.size, carry: 0 };
    // A double gather yields one more herb without emptying the bush further.
    const doubleChance = bonusOf(rules.modifierProviders, state, 'gather.double', content);
    const doubled = doubleChance > 0 && nextFloat(state.rng, 'action') < doubleChance;
    addItem(state, id, doubled ? 2 : 1);
    const seconds = gatherAverageSeconds(bush.size, content);
    gainXp(state, skill, (rate(herb.level, content) * seconds) / SECONDS_PER_HOUR, content, rules);
    grantMastery(state, id, skill, masteryXpPerAction(seconds, content), content, rules);
  },
};

/** Mastery tier of a recipe, 1-based: how many of the tier thresholds its mastery level has reached. */
export function craftTier(state: GameState, recipe: string, content: ContentDb): number {
  const level = masteryLevel(state, recipe, content);
  return content.balance.K.craftRules.masteryTiers.filter((t) => level >= t).length;
}

/** Chance of one bonus unit per craft: a fixed share for every tier above the first. */
export function craftBonusChance(
  state: GameState,
  recipe: string,
  content: ContentDb,
  rules: Rules,
): number {
  const K = content.balance.K;
  const tier = (craftTier(state, recipe, content) - 1) * K.craftRules.bonusPerTier;
  const mods = bonusOf(rules.modifierProviders, state, 'craft.double', content);
  return Math.min(1, Math.max(0, tier + mods));
}

/** Chance that a craft keeps its ingredients: the general and the per-skill `craft.keep` modifiers. */
export function craftKeepChance(
  state: GameState,
  skill: string,
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
    const mod = cycleFactor(rules.modifierProviders, state, recipe.skill, content);
    return Math.max(1, Math.round(content.balance.K.craft * MS_PER_SECOND * mod));
  },
  complete(state, id, content, rules) {
    const recipe = indexOf(content).recipes.get(id);
    if (!recipe) return;
    // Ingredients may have left the bank since the cycle began.
    if (firstMissing(state, id, content) !== null) return 'abort';
    const K = content.balance.K;
    const bonusChance = craftBonusChance(state, id, content, rules);
    const bonus = bonusChance > 0 && nextFloat(state.rng, 'action') < bonusChance;
    const keepChance = craftKeepChance(state, recipe.skill, content, rules);
    const kept = keepChance > 0 && nextFloat(state.rng, 'action') < keepChance;
    if (!kept) for (const i of recipe.ingredients) removeItem(state, i.item, i.n);
    addItem(state, recipe.output.item, recipe.output.n + (bonus ? 1 : 0));
    const xp = (rate(recipe.level, content) * K.craft * K.craftXpMult) / SECONDS_PER_HOUR;
    gainXp(state, recipe.skill, xp, content, rules);
    grantMastery(state, id, recipe.skill, masteryXpPerAction(K.craft, content), content, rules);
  },
};
