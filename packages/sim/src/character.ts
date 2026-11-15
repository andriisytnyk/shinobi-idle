import {
  NATURE_IDS,
  type ContentDb,
  type NatureId,
  type Req,
  type SkillId,
} from '@shinobi/content';
import {
  createState,
  dispatch,
  examFor,
  killsKey,
  pouchUse,
  refreshUnlocks,
  teamFor,
  xpAt,
  type GameState,
  type Rank,
  type Rules,
} from '@shinobi/core';

/** Mastery level of every known technique of a typical character (the balance model uses 20). */
export const TYPICAL_MASTERY = 20;
/** Level from which a typical character is a Chunin (the content has no Chunin exam yet). */
export const CHUNIN_FROM_LEVEL = 40;
/** Ryo a typical character is given to buy the shop's pouch items with. */
const SHOPPING_RYO = 1_000_000;

export interface CharacterOptions {
  seed: number;
  /** Level of every skill the character trains (natures it does not own stay at 0). */
  level: number;
  rank: Rank;
  natures: readonly NatureId[];
  mastery?: number;
  /** Ryo in the bank when the character is handed over. */
  ryo?: number;
}

/** Rank a typical character of this level holds: a student up to the Academy cap, a Chunin from `CHUNIN_FROM_LEVEL`. */
export function rankForLevel(level: number, content: ContentDb): Rank {
  if (level <= content.balance.K.academyCap) return 'student';
  return level >= CHUNIN_FROM_LEVEL ? 'chunin' : 'genin';
}

const isNature = (id: string): boolean => (NATURE_IDS as readonly string[]).includes(id);

/**
 * A character at `level`, made the way the game makes one: a fresh state with the skills'
 * experience, the nature choice and the mastery of every technique the levels teach. Only plain
 * state fields are written; techniques are learned through `refreshUnlocks`.
 */
export function buildCharacter(content: ContentDb, rules: Rules, o: CharacterOptions): GameState {
  void rules;
  const K = content.balance.K;
  const state = createState(o.seed, content);
  state.player.rank = o.rank;
  state.player.natures = [...o.natures];
  const native = o.natures[0];
  if (native) state.team = teamFor(native);
  const level = Math.min(K.cap, Math.max(1, o.level));
  for (const skill of content.skills) {
    if (isNature(skill.id) && !o.natures.includes(skill.id as NatureId)) continue;
    state.skills[skill.id] = { xp: xpAt(level) };
  }
  refreshUnlocks(state, content, true);
  const mastery = Math.min(K.masteryCap, Math.max(1, o.mastery ?? TYPICAL_MASTERY));
  for (const tech of content.techniques) {
    if (state.known[tech.id] && tech.rank !== null) state.mastery[tech.id] = { xp: xpAt(mastery) };
  }
  state.currencies.ryo = o.ryo ?? 0;
  state.events = [];
  return state;
}

/** Skill levels the Genin exam asks for, read from the exam's checklist. */
function examSkillLevels(
  req: Req,
  out: Partial<Record<SkillId, number>> = {},
): Partial<Record<SkillId, number>> {
  if (req.t === 'skill') out[req.skill] = Math.max(out[req.skill] ?? 0, req.level);
  else if (req.t === 'all' || req.t === 'any') for (const r of req.of) examSkillLevels(r, out);
  return out;
}

/** A Genin fresh from the Academy: the skills of the exam checklist at the exam's levels, nothing else. */
export function buildGeninStart(
  content: ContentDb,
  seed: number,
  ryo: number,
  natures: readonly NatureId[] = [],
): GameState {
  const exam = examFor(content, 'genin');
  const needs = exam ? examSkillLevels(exam.checklist) : {};
  const state = createState(seed, content);
  state.player.rank = 'genin';
  state.player.natures = [...natures];
  const native = natures[0];
  if (native) state.team = teamFor(native);
  for (const [skill, level] of Object.entries(needs) as [SkillId, number][]) {
    state.skills[skill] = { xp: xpAt(level) };
  }
  refreshUnlocks(state, content, true);
  state.currencies.ryo = ryo;
  state.events = [];
  return state;
}

/**
 * Buys what the shop sells for the pouch (and the medic pouch) through `shop.buy`, one full
 * stack each, then gives the ryo back: the shopping money is a loan, not income. A good whose
 * requirement does not hold is simply refused.
 */
export function stockFromShop(state: GameState, content: ContentDb, rules: Rules): void {
  const kept = state.currencies.ryo;
  state.currencies.ryo = SHOPPING_RYO;
  const stack = content.balance.K.pouchStack;
  for (const entry of content.shop) {
    const item = content.items.find((i) => i.id === entry.item);
    if (!item || (pouchUse(item) === null && item.medic === undefined)) continue;
    const n = item.medic === undefined ? stack : 1;
    dispatch(state, { type: 'shop.buy', item: entry.item, n }, content, rules);
  }
  state.currencies.ryo = kept;
}

/** The character's pouch and loadout for one enemy: it knows the enemy, stocks the pouch and lets the engine plan. */
export function equipFor(
  state: GameState,
  entryId: string,
  content: ContentDb,
  rules: Rules,
): void {
  state.counters[killsKey(entryId)] = (state.counters[killsKey(entryId)] ?? 0) + 1;
  state.seen[entryId] = true;
  if (state.player.rank !== 'student') {
    stockFromShop(state, content, rules);
    dispatch(state, { type: 'loadout.prepare', encounter: entryId }, content, rules);
  }
}
