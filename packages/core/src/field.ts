import type { ContentDb } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { addItem, hasItem, removeItem } from './bank.ts';
import {
  MS_PER_SECOND,
  cycleSeconds,
  cycleXp,
  gatherPauseShare,
  masteryLevel,
  masteryXpPerAction,
} from './formulas.ts';
import { indexOf } from './lookup.ts';
import { bonusOf, computeMod, cycleFactor } from './modifiers.ts';
import { gainXp, grantMastery } from './progression.ts';
import type { Req } from './requirements.ts';
import { pay, pointFlag } from './points.ts';
import { nextFloat } from './rng.ts';
import type { Rules } from './rules.ts';
import { SHARE_FULL, type GameState } from './state.ts';
import { actionFloor, activitySkill, entitySkill } from './vocab.ts';

/** The skill that gathers herbs: the one whose activity is `patch` (Herbalism). */
export const gatherSkill = (content: ContentDb): string | null => activitySkill(content, 'patch');

/** The skill that gathers a herb: the one it names, else the first with the activity `patch`. */
export const herbSkill = (
  content: ContentDb,
  herb: { skill?: string | undefined },
): string | null => entitySkill(content, 'patch', herb);

/**
 * One herb's bush: herbs left, how many it held when it last filled, and a game time `at` (`state.now`).
 * The bush is a closed form over time, settled when it is touched (`settleBush`): a bush with herbs left regrows one
 * every `regrowEachMs` from `at`, whether it is gathered or not; a bush at 0 (`at` is when it was emptied) is whole again
 * `regrowMs` after `at`; a full bush has no clock (`at` means nothing).
 */
export interface Bush {
  stock: number;
  size: number;
  at: number;
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
  const extra = Math.round(bonusOf(rules, state, 'bush.stock', content));
  return Math.max(
    1,
    content.balance.K.field.stockBase + masteryLevel(state, herb, content) + extra,
  );
}

/** Regrow pause of an empty bush in ms, after the `bush.regrow` modifiers. */
export function regrowMs(state: GameState, content: ContentDb, rules: Rules): number {
  const mod = computeMod(rules, state, 'bush.regrow', content).total;
  return Math.max(0, Math.round(content.balance.K.field.regrowMs * mod));
}

/** Time one herb of a bush that still has some takes to regrow, in ms (at least 1), after the `bush.regrow` modifiers. */
export function regrowEachMs(state: GameState, content: ContentDb, rules: Rules): number {
  const mod = computeMod(rules, state, 'bush.regrow', content).total;
  return Math.max(1, Math.round(content.balance.K.field.regrowEachMs * mod));
}

/**
 * The bush as it stands at game time `now`, without touching the original: herbs regrown whole at `each` ms from
 * `at` up to `cap` (one step over any span, no loop, so settling twice equals settling once), an empty bush whole
 * after `pause`, a full bush grown to the capacity of today. `null` is a bush never gathered: a full one.
 */
export function settleBush(
  bush: Bush | null,
  now: number,
  cap: number,
  each: number,
  pause: number,
): Bush {
  if (!bush || bush.stock >= bush.size)
    return { stock: Math.max(cap, bush?.stock ?? 0), size: cap, at: now };
  if (bush.stock === 0) {
    return now - bush.at >= pause ? { stock: cap, size: cap, at: now } : bush;
  }
  const grown = Math.max(0, Math.floor((now - bush.at) / each));
  const stock = Math.min(Math.max(cap, bush.stock), bush.stock + grown);
  return stock >= cap
    ? { stock, size: Math.max(cap, bush.size), at: now }
    : { stock, size: cap, at: bush.at + grown * each };
}

/** A herb's bush as of `state.now`, for the interface and the pace: herbs, size, and where its clock is. */
export interface BushNow {
  stock: number;
  size: number;
  /** The bush was emptied and is regrowing whole: the gatherer waits (the regrow phase). */
  phase: 'regrow' | null;
  /** Ms until the bush is whole (in the regrow phase) or has one herb more; 0 for a full bush. */
  leftMs: number;
  /** The length of the phase `leftMs` is counted in: `regrowMs` or `regrowEachMs`; 0 for a full bush. */
  spanMs: number;
}

/** The bush of a herb now. A herb never gathered has a full one at today's size. */
export function bushNow(state: GameState, herb: string, content: ContentDb, rules: Rules): BushNow {
  const cap = bushSize(state, herb, content, rules);
  const pause = regrowMs(state, content, rules);
  const each = regrowEachMs(state, content, rules);
  const b = settleBush(bushOf(state, herb), state.now, cap, each, pause);
  if (b.stock === 0) {
    return {
      stock: 0,
      size: b.size,
      phase: 'regrow',
      leftMs: Math.max(0, pause - (state.now - b.at)),
      spanMs: pause,
    };
  }
  if (b.stock >= b.size) return { stock: b.stock, size: b.size, phase: null, leftMs: 0, spanMs: 0 };
  return {
    stock: b.stock,
    size: b.size,
    phase: null,
    leftMs: Math.max(0, each - (state.now - b.at)),
    spanMs: each,
  };
}

/** The gathering cycle of `herb` in ms at full speed with modifiers (the bush phases are not in it). */
export function gatherCycleMs(
  state: GameState,
  id: string,
  content: ContentDb,
  rules: Rules,
): number {
  const herb = indexOf(content).herbs.get(id);
  if (!herb) return 1;
  const mod = cycleFactor(rules, state, herbSkill(content, herb) ?? '', content);
  const base = cycleSeconds('gather', herb, content);
  return Math.max(actionFloor(content), Math.round(base * MS_PER_SECOND * mod));
}

/**
 * Ms of the empty-bush pause that fall on each herb over a long session of gathering `id` (a bush of `size`),
 * with today's modifiers: the pause shared by the herbs a bush holds out before it is empty.
 */
export function gatherPauseMs(
  state: GameState,
  id: string,
  size: number,
  content: ContentDb,
  rules: Rules,
): number {
  const ratio = gatherCycleMs(state, id, content, rules) / regrowEachMs(state, content, rules);
  return ratio >= 1 ? 0 : (regrowMs(state, content, rules) * (1 - ratio)) / size;
}

/**
 * Seconds of one gather of `herb` averaged over a long session, before modifiers: its cycle plus the empty-bush
 * pause shared among the herbs the bush holds out (`gatherPauseShare`). Mastery pays by this time; the skill XP of a
 * gather is the herb's own number and does not depend on the size of the bush.
 */
export function gatherAverageSeconds(
  herb: { level: number; cycle?: number | undefined },
  size: number,
  content: ContentDb,
): number {
  const cycle = cycleSeconds('gather', herb, content);
  return cycle + gatherPauseShare(cycle, size, content);
}

export const gatherKind: ActionKind = {
  flow: (id, content) => {
    const herb = indexOf(content).herbs.get(id);
    const skill = herb ? herbSkill(content, herb) : null;
    return herb && skill ? { makes: [id], uses: [], speed: `speed.skill.${skill}` } : null;
  },
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
    // Two phases, read from the stored bush alone (it changes only when a cycle ends): a bush stored empty is
    // regrowing, and the "cycle" is that pause; any other bush is gathered, one herb per cycle.
    return bushOf(state, id)?.stock === 0
      ? regrowMs(state, content, rules)
      : gatherCycleMs(state, id, content, rules);
  },
  start(state, slot, id, content, rules) {
    const target = state.slots[slot];
    const cap = bushSize(state, id, content, rules);
    const pause = regrowMs(state, content, rules);
    const bush = settleBush(
      bushOf(state, id),
      state.now,
      cap,
      regrowEachMs(state, content, rules),
      pause,
    );
    state.bushes[id] = bush;
    // A bush that is still regrowing counts the time it has had since it was emptied, gathered or not.
    if (target && bush.stock === 0)
      target.progress = Math.min(state.now - bush.at, pause) * SHARE_FULL;
  },
  complete(state, id, content, rules) {
    const herb = indexOf(content).herbs.get(id);
    const skill = herb ? herbSkill(content, herb) : null;
    if (!herb || skill === null) return;
    const cap = bushSize(state, id, content, rules);
    if (bushOf(state, id)?.stock === 0) {
      // The pause of an emptied bush is over: it is whole, to the size its mastery gives now. No herb yet.
      state.bushes[id] = { stock: cap, size: cap, at: state.now };
      return 'step';
    }
    const bush = settleBush(
      bushOf(state, id),
      state.now,
      cap,
      regrowEachMs(state, content, rules),
      regrowMs(state, content, rules),
    );
    const left = bush.stock - 1;
    // The clock of one herb starts when a full bush is first taken from, and again when the bush is emptied.
    const full = bush.stock >= bush.size;
    state.bushes[id] = {
      stock: left,
      size: bush.size,
      at: full || left === 0 ? state.now : bush.at,
    };
    // A double gather yields one more herb without emptying the bush further.
    const doubleChance = bonusOf(rules, state, 'gather.double', content);
    const doubled = doubleChance > 0 && nextFloat(state.rng, 'action') < doubleChance;
    addItem(state, id, doubled ? 2 : 1);
    gainXp(state, skill, cycleXp('gather', herb, content), content, rules);
    const seconds = gatherAverageSeconds(herb, bush.size, content);
    const mastery = masteryXpPerAction(masteryLevel(state, id, content), seconds, content);
    grantMastery(state, id, skill, mastery, content, rules);
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
  const mods = bonusOf(rules, state, 'craft.double', content);
  return Math.min(1, Math.max(0, tier + mods));
}

/** Chance that a craft keeps its ingredients: the general and the per-skill `craft.keep` modifiers. */
export function craftKeepChance(
  state: GameState,
  skill: string,
  content: ContentDb,
  rules: Rules,
): number {
  const providers = rules;
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
  flow: (id, content) => {
    const recipe = indexOf(content).recipes.get(id);
    if (!recipe) return null;
    return {
      makes: [recipe.output.item],
      uses: recipe.ingredients.map((i) => i.item),
      speed: `speed.skill.${recipe.skill}`,
    };
  },
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
    const mod = cycleFactor(rules, state, recipe.skill, content);
    return Math.max(
      actionFloor(content),
      Math.round(cycleSeconds('craft', recipe, content) * MS_PER_SECOND * mod),
    );
  },
  complete(state, id, content, rules) {
    const recipe = indexOf(content).recipes.get(id);
    if (!recipe) return;
    // Ingredients may have left the bank since the cycle began.
    if (firstMissing(state, id, content) !== null) return 'abort';
    const bonusChance = craftBonusChance(state, id, content, rules);
    const bonus = bonusChance > 0 && nextFloat(state.rng, 'action') < bonusChance;
    const keepChance = craftKeepChance(state, recipe.skill, content, rules);
    const kept = keepChance > 0 && nextFloat(state.rng, 'action') < keepChance;
    if (!kept) for (const i of recipe.ingredients) removeItem(state, i.item, i.n);
    addItem(state, recipe.output.item, recipe.output.n + (bonus ? 1 : 0));
    gainXp(state, recipe.skill, cycleXp('craft', recipe, content), content, rules);
    const seconds = cycleSeconds('craft', recipe, content);
    const mastery = masteryXpPerAction(masteryLevel(state, id, content), seconds, content);
    grantMastery(state, id, recipe.skill, mastery, content, rules);
  },
};

// ---------- work that a found point opens ----------

/** The name of the action kind of work that a found point of interest opens (a ruin search, a deposit gathered). */
export const FIELDWORK_KIND = 'fieldwork';

/** The skill that does a work: the one it names, else the first skill with the activity `map`. */
export const fieldworkSkill = (
  content: ContentDb,
  work: { skill?: string | undefined },
): string | null => entitySkill(content, 'map', work);

/** The works a place opens, in the order of the content. */
export const fieldworksAt = (content: ContentDb, placeId: string): string[] =>
  content.fieldworks.filter((w) => w.point === placeId).map((w) => w.id);

export const fieldworkKind: ActionKind = {
  flow: (id, content) => {
    const work = indexOf(content).fieldworks.get(id);
    const skill = work ? fieldworkSkill(content, work) : null;
    if (!work || skill === null) return null;
    return {
      makes: work.drops.flatMap((d) => d.payout.items?.map((i) => i.item) ?? []),
      uses: [],
      speed: `speed.skill.${skill}`,
    };
  },
  has: (id, content) => {
    const work = indexOf(content).fieldworks.get(id);
    return work !== undefined && fieldworkSkill(content, work) !== null;
  },
  skill: (id, content) => {
    const work = indexOf(content).fieldworks.get(id);
    return work ? fieldworkSkill(content, work) : null;
  },
  // The point found (once found it stays open: the hero need not stand there) and the skill level.
  requirements(_state, id, content) {
    const work = indexOf(content).fieldworks.get(id);
    const skill = work ? fieldworkSkill(content, work) : null;
    if (!work || skill === null) return null;
    return {
      t: 'all',
      of: [
        { t: 'flag', id: pointFlag(work.point) },
        { t: 'skill', skill, level: work.level },
      ],
    };
  },
  intervalMs(state, id, content, rules) {
    const work = indexOf(content).fieldworks.get(id);
    if (!work) return 1;
    const mod = cycleFactor(rules, state, fieldworkSkill(content, work) ?? '', content);
    return Math.max(actionFloor(content), Math.round(work.cycle * MS_PER_SECOND * mod));
  },
  complete(state, id, content, rules) {
    const work = indexOf(content).fieldworks.get(id);
    const skill = work ? fieldworkSkill(content, work) : null;
    if (!work || skill === null) return;
    gainXp(state, skill, work.xp, content, rules);
    // Every drop is rolled once per cycle; a chance of 1 is paid without a roll.
    for (const drop of work.drops)
      if (drop.chance >= 1 || nextFloat(state.rng, 'loot') < drop.chance)
        pay(state, content, rules, drop.payout);
    const mastery = masteryXpPerAction(masteryLevel(state, id, content), work.cycle, content);
    grantMastery(state, id, skill, mastery, content, rules);
  },
};
