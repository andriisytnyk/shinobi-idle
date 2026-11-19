import type { ContentDb, Item, ShopEntry } from '@shinobi/content';
import {
  bushOf,
  bushSize,
  craftBonusChance,
  craftTier,
  fieldworkSkill,
  regrowMs,
  shopEntries,
  type GameState,
  type Req,
  type ReqResult,
  type Rules,
} from '@shinobi/core';
import { t } from './i18n.ts';
import { hrefFor } from './route.ts';
import { rankName, skillByActivity } from './vocab.ts';

/** The skill whose page holds herb gathering: the skill of the patch activity. */
const herbSkill = (content: ContentDb): string | null => skillByActivity(content, 'patch');

/** Where an item can be had from, as a shortcut link: its label key (no entity name in it) and target. */
export interface ItemSource {
  kind: 'herb' | 'shop' | 'craft' | 'work' | 'item';
  href: string;
  /** Localization key of the link text. */
  labelKey: string;
}

/** The skill page of the work (a found point opens it) whose drops include the item; the sure drops first. */
function workSkillOf(id: string, content: ContentDb): string | null {
  const drops = (chance: (c: number) => boolean) =>
    content.fieldworks.find((w) =>
      w.drops.some((d) => chance(d.chance) && d.payout.items?.some((i) => i.item === id)),
    );
  const work = drops((c) => c >= 1) ?? drops(() => true);
  return work ? fieldworkSkill(content, work) : null;
}

/** The place to get an item: the herb page, the shop, the recipe that makes it, the work that yields it, or the item's own page. */
export function itemSource(id: string, content: ContentDb): ItemSource {
  const gatherer = herbSkill(content);
  if (gatherer && content.herbs.some((h) => h.id === id)) {
    return {
      kind: 'herb',
      href: hrefFor({ kind: 'skill', id: gatherer }),
      labelKey: 'craft.src.herb',
    };
  }
  if (shopEntries(content).some((s) => s.item === id)) {
    return { kind: 'shop', href: '#/shop', labelKey: 'craft.src.shop' };
  }
  const recipe = content.recipes.find((r) => r.output.item === id);
  if (recipe) {
    return {
      kind: 'craft',
      href: hrefFor({ kind: 'recipe', id: recipe.id }),
      labelKey: 'craft.src.craft',
    };
  }
  const worker = workSkillOf(id, content);
  if (worker !== null) {
    return {
      kind: 'work',
      href: hrefFor({ kind: 'skill', id: worker }),
      labelKey: 'craft.src.work',
    };
  }
  return { kind: 'item', href: hrefFor({ kind: 'item', id }), labelKey: 'craft.src.item' };
}

/**
 * The page where an item is made or bought: the herb's skill page, the shop, or the skill page of
 * the recipe that makes it. Null when no such place exists (the caller picks a fallback).
 */
export function itemPlace(id: string, content: ContentDb): string | null {
  const gatherer = herbSkill(content);
  if (gatherer && content.herbs.some((h) => h.id === id))
    return hrefFor({ kind: 'skill', id: gatherer });
  if (shopEntries(content).some((s) => s.item === id)) return '#/shop';
  const recipe = content.recipes.find((r) => r.output.item === id);
  if (recipe) return hrefFor({ kind: 'skill', id: recipe.skill });
  const worker = workSkillOf(id, content);
  return worker === null ? null : hrefFor({ kind: 'skill', id: worker });
}

/** The building a requirement tree names first, or null. */
function buildingOf(req: Req): string | null {
  if (req.t === 'building') return req.id;
  if (req.t === 'all' || req.t === 'any') {
    for (const child of req.of) {
      const found = buildingOf(child);
      if (found) return found;
    }
  }
  return null;
}

/** The id of a shop section: `market` for goods that need no building, else the slug of the building that unlocks them. */
export type ShopSection = string;

/** The market's section id: goods that no building unlocks. */
export const MARKET_SECTION = 'market';

/** The slug of an id: its part after the pack prefix. */
export const slugOf = (id: string): string => id.slice(id.lastIndexOf(':') + 1);

/** Goods that a building unlocks are the building's section; everything else is the market's. */
export function shopSection(entry: ShopEntry): ShopSection {
  const building = buildingOf(entry.req);
  return building === null ? MARKET_SECTION : slugOf(building);
}

/** Every item a requirement tree asks for, once each, in tree order. */
export function reqItemIds(req: Req | null): string[] {
  const out: string[] = [];
  const walk = (node: Req) => {
    if (node.t === 'item') {
      if (!out.includes(node.id)) out.push(node.id);
    } else if (node.t === 'all' || node.t === 'any') {
      node.of.forEach(walk);
    }
  };
  if (req) walk(req);
  return out;
}

export const BANK_TABS = [
  'all',
  'ingredients',
  'products',
  'tools',
  'scrolls',
  'trophies',
] as const;
export type BankTab = (typeof BANK_TABS)[number];

/** The bank tab an item belongs to by its purpose. */
export function bankTab(item: Item): Exclude<BankTab, 'all'> {
  if (item.scroll || item.part || item.use) return 'scrolls';
  if (item.kind === 'ingredient') return 'ingredients';
  if (item.kind === 'consumable') return 'products';
  if (item.kind === 'tool') return 'tools';
  return 'trophies';
}

/** Why a control is off, in terms a message can name. */
export type Block =
  | { kind: 'level'; n: number }
  | { kind: 'rank'; rank: string }
  | { kind: 'building'; id: string; n: number }
  | { kind: 'locked' }
  | { kind: 'missing' };

/** The unmet leaves of a requirement result. */
function unmetLeaves(node: ReqResult, out: ReqResult[] = []): ReqResult[] {
  if (node.met) return out;
  if (node.children.length === 0) out.push(node);
  else node.children.forEach((c) => unmetLeaves(c, out));
  return out;
}

/** What first keeps an action or purchase from being possible: level, rank, other condition, then missing items. */
export function blockOf(req: ReqResult | null): Block | null {
  if (!req || req.met) return null;
  const leaves = unmetLeaves(req);
  const rank = leaves.find((l) => l.req.t === 'rank');
  if (rank && rank.req.t === 'rank') return { kind: 'rank', rank: rank.req.rank };
  const level = leaves.find((l) => l.req.t === 'skill');
  if (level && level.req.t === 'skill') return { kind: 'level', n: level.req.level };
  const building = leaves.find((l) => l.req.t === 'building');
  if (building && building.req.t === 'building') {
    return { kind: 'building', id: building.req.id, n: building.req.level };
  }
  const other = leaves.find((l) => l.req.t !== 'item');
  if (other) return { kind: 'locked' };
  return { kind: 'missing' };
}

/** The sentence that says why something is off. */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'level':
      return t('reason.level', { n: block.n });
    case 'rank':
      return t('reason.rank', { rank: rankName(block.rank) });
    case 'missing':
      return t('error.missingIngredient');
    default:
      return t('error.requirementsNotMet');
  }
}

/** A herb's bush as a tile shows it. */
export interface BushView {
  stock: number;
  size: number;
  /** The bush is empty and has to regrow before the next herb. */
  empty: boolean;
  /** Time the regrow takes, in ms. */
  regrowMs: number;
}

/** The bush of a herb: the stock the player left, or a full one at today's size when it was never gathered. */
export function bushView(
  state: GameState,
  herb: string,
  content: ContentDb,
  rules: Rules,
): BushView {
  const bush = bushOf(state, herb);
  const size = bush?.size ?? bushSize(state, herb, content, rules);
  return {
    stock: bush ? bush.stock : size,
    size,
    empty: bush?.stock === 0,
    regrowMs: regrowMs(state, content, rules),
  };
}

/** The mastery tier of a recipe and what it gives. */
export interface TierView {
  /** 1-based tier now. */
  tier: number;
  tiers: number;
  /** Chance of one bonus unit per craft, 0..1. */
  bonusChance: number;
  /** Mastery level of the next tier; null at the last. */
  nextAt: number | null;
}

export function tierView(
  state: GameState,
  recipe: string,
  content: ContentDb,
  rules: Rules,
): TierView {
  const steps = content.balance.K.craftRules.masteryTiers;
  const tier = craftTier(state, recipe, content);
  return {
    tier,
    tiers: steps.length,
    bonusChance: craftBonusChance(state, recipe, content, rules),
    nextAt: steps[tier] ?? null,
  };
}
