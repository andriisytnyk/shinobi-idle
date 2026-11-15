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

/** The bush a gather slot works: herbs left on it and how many it held when it last filled. */
interface Bush {
  stock: number;
  size: number;
}

/** Reads the bush out of the slot data; null when the slot holds none (or something unusable). */
function readBush(state: GameState, slot: number | undefined, content: ContentDb): Bush | null {
  const data = slot === undefined ? null : state.slots[slot]?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { stock, size } = data;
  if (typeof stock !== 'number' || typeof size !== 'number') return null;
  const K = content.balance.K;
  const most = K.field.stockBase + K.masteryCap;
  if (!Number.isInteger(stock) || !Number.isInteger(size) || size < 1 || size > most) return null;
  return { stock: Math.min(Math.max(stock, 0), size), size };
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
  intervalMs(state, _id, content, rules, slot) {
    const K = content.balance.K;
    const mod = computeMod(rules.modifierProviders, state, 'interval.skill.herb', content).total;
    const cycle = Math.max(1, Math.round(K.gather * MS_PER_SECOND * mod));
    // An empty bush regrows before the next herb: the pause is part of that cycle.
    return readBush(state, slot, content)?.stock === 0 ? cycle + K.field.regrowMs : cycle;
  },
  start(state, slot, id, content) {
    const target = state.slots[slot];
    const size = bushSize(state, id, content);
    if (target) target.data = { stock: size, size };
  },
  complete(state, id, content, rules, slot) {
    const herb = indexOf(content).herbs.get(id);
    if (!herb) return;
    const held = readBush(state, slot, content);
    // A bush found empty has regrown by now and is full again, to the size its mastery gives now.
    const fresh = bushSize(state, id, content);
    const bush: Bush = held && held.stock > 0 ? held : { stock: fresh, size: fresh };
    const target = slot === undefined ? undefined : state.slots[slot];
    if (target) target.data = { stock: bush.stock - 1, size: bush.size };
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
    if (firstMissing(state, id, content) !== null) return 'stop';
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
