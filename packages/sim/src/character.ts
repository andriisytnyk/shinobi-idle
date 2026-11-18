import { type ContentDb, type NatureId, type Req, type SkillId } from '@shinobi/content';
import {
  addItem,
  createState,
  dispatch,
  examFor,
  isAcademyRank,
  isNature,
  killsKey,
  moneyOf,
  pouchUse,
  refreshUnlocks,
  syncVillage,
  levelAt,
  rate,
  teamFor,
  xpAt,
  type GameState,
  type Rank,
  type Rules,
} from '@shinobi/core';
import { CHUNIN_FROM_LEVEL, chuninRank, geninRank, studentRank } from './constants.ts';

/** Mastery level of every known technique of a yardstick character (the balance model uses 20). */
export const TYPICAL_MASTERY = 20;
/** The share of its practice time a typical player gives to the defensive techniques it knows (all of them together). */
export const DEFENCE_PRACTICE_SHARE = 0.15;
/**
 * Mastery XP per hour the yardstick character earns while it practises: the flat pace the fight fit was
 * recorded at (the mastery pace by level, `K.mastery`, came later and is not part of the yardstick).
 */
export const YARDSTICK_MASTERY_PER_HOUR = 10500;
/** How many skills a typical player trains at once: its hours to reach a level are this many times the hours of one skill. */
export const TRAINED_SKILLS = 10;

/** Hours of one skill at its best action to reach `level` (the balance model's hours-to-level). */
export function hoursToLevel(level: number, content: ContentDb): number {
  let h = 0;
  for (let l = 1; l < Math.min(level, content.balance.K.cap); l++) {
    h += (xpAt(l + 1) - xpAt(l)) / rate(l, content);
  }
  return h;
}

/**
 * The mastery a typical player has of a defensive technique at `level`: it learns the technique when the
 * skill level unlocks it, gives `DEFENCE_PRACTICE_SHARE` of the hours it has played since to the defensive
 * techniques it knows (`known` of them, shared equally) and earns `YARDSTICK_MASTERY_PER_HOUR` of mastery XP per hour.
 */
export function typicalDefenceMastery(
  level: number,
  unlockLevel: number,
  known: number,
  content: ContentDb,
): number {
  const K = content.balance.K;
  const played =
    TRAINED_SKILLS * Math.max(0, hoursToLevel(level, content) - hoursToLevel(unlockLevel, content));
  const xp = (YARDSTICK_MASTERY_PER_HOUR * DEFENCE_PRACTICE_SHARE * played) / Math.max(1, known);
  return Math.max(1, levelAt(xp, K.masteryCap));
}

/** Ryo a yardstick character is given to buy the shop's pouch items with. */
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

/** Rank a yardstick character of this level holds: a student up to the Academy cap, a Chunin from `CHUNIN_FROM_LEVEL`. */
export function rankForLevel(level: number, content: ContentDb): Rank {
  if (level <= content.balance.K.academyCap) return studentRank(content);
  return level >= CHUNIN_FROM_LEVEL ? chuninRank(content) : geninRank(content);
}

/** The village buildings the shop's requirements name, with the level each needs. */
function shopBuildingLevels(req: Req, out: Record<string, number>): void {
  if (req.t === 'building') out[req.id] = Math.max(out[req.id] ?? 0, req.level);
  else if (req.t === 'all' || req.t === 'any') for (const r of req.of) shopBuildingLevels(r, out);
}

/**
 * Gives a Genin's village the buildings the shop needs to sell what a yardstick character is
 * measured with (goods, tools). Building takes days of village ticks and resources, which a
 * measurement of fights or crafts is not about, so the levels are written to the village state
 * (`village.levels`) rather than built through `village.build`. A student has no village.
 */
export function grantShopBuildings(state: GameState, content: ContentDb): void {
  syncVillage(state, content);
  const village = state.village;
  if (!village) return;
  const need: Record<string, number> = {};
  for (const entry of content.shop) shopBuildingLevels(entry.req, need);
  for (const [id, level] of Object.entries(need)) {
    village.levels[id] = Math.max(village.levels[id] ?? 0, level);
  }
}

/**
 * A yardstick character at `level`: every skill at the same level, mastery 20 on every known
 * technique, a village with the shop's buildings. It is a fixed measuring stick, not a state a
 * player reaches. Techniques are learned through `refreshUnlocks`; only plain state is written.
 *
 * Defence follows the passive rule: every defensive technique that the character's levels and
 * natures unlock is known, at the same mastery 20 as everything else (a player who keeps training
 * the techniques of a skill trains its defensive ones too, since practising is now all they are
 * for), and none is in the hand. The rank gives its evasion term, and the Bingo knowledge of the
 * entry fought (`equipFor`) gives the rest. There is no Evasion skill to level.
 */
export function buildCharacter(content: ContentDb, o: CharacterOptions): GameState {
  const K = content.balance.K;
  const state = createState(o.seed, content);
  state.player.rank = o.rank;
  state.player.natures = [...o.natures];
  const native = o.natures[0];
  if (native) state.team = teamFor(content, native);
  const level = Math.min(K.cap, Math.max(1, o.level));
  for (const skill of content.skills) {
    if (isNature(content, skill.id) && !o.natures.includes(skill.id as NatureId)) continue;
    state.skills[skill.id] = { xp: xpAt(level) };
  }
  refreshUnlocks(state, content, true);
  grantShopBuildings(state, content);
  const mastery = Math.min(K.masteryCap, Math.max(1, o.mastery ?? TYPICAL_MASTERY));
  for (const tech of content.techniques) {
    if (state.known[tech.id] && tech.rank !== null) state.mastery[tech.id] = { xp: xpAt(mastery) };
  }
  if (o.mastery === undefined) {
    const passive = content.techniques.filter(
      (tech) => tech.combat?.passive !== undefined && state.known[tech.id],
    );
    for (const tech of passive) {
      state.mastery[tech.id] = {
        xp: xpAt(typicalDefenceMastery(level, tech.level, passive.length, content)),
      };
    }
  }
  state.currencies[moneyOf(content)] = o.ryo ?? 0;
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
  const exam = examFor(content, geninRank(content));
  const needs = exam ? examSkillLevels(exam.checklist) : {};
  const state = createState(seed, content);
  state.player.rank = geninRank(content);
  state.player.natures = [...natures];
  const native = natures[0];
  if (native) state.team = teamFor(content, native);
  for (const [skill, level] of Object.entries(needs) as [SkillId, number][]) {
    state.skills[skill] = { xp: xpAt(level) };
  }
  refreshUnlocks(state, content, true);
  grantShopBuildings(state, content);
  state.currencies[moneyOf(content)] = ryo;
  state.events = [];
  return state;
}

/**
 * Buys what the shop sells for the pouch (and the medic pouch) through `shop.buy`, one full
 * stack each, then gives the ryo back: the shopping money is a loan, not income. A good whose
 * requirement does not hold is simply refused.
 */
export function stockFromShop(state: GameState, content: ContentDb, rules: Rules): void {
  const money = moneyOf(content);
  const kept = state.currencies[money] ?? 0;
  state.currencies[money] = SHOPPING_RYO;
  const stack = content.balance.K.pouchStack;
  for (const entry of content.shop) {
    const item = content.items.find((i) => i.id === entry.item);
    if (!item || (pouchUse(item) === null && item.medic === undefined)) continue;
    const n = item.medic === undefined ? stack : 1;
    dispatch(state, { type: 'shop.buy', item: entry.item, n }, content, rules);
  }
  state.currencies[money] = kept;
}

export type PouchMode = 'none' | 'shop';
export type FoodMode = 'none' | 'model';

export interface Equipment {
  /** `shop`: the pouch items the shop sells, a full stack each; `none`: no tools. */
  pouch: PouchMode;
  /** `model`: the meals the balance model gives the player (see `modelFood`); `none`: no food. */
  food: FoodMode;
}

/**
 * The meal the balance model carries at a level: the healing item whose healing is the largest
 * not above the model's `K.food` step for that level (the smallest one when all are above), and a
 * full pouch stack of it (`K.pouchStack`, as in the model). Read from the balance data and the
 * items' effects; null when the content has no healing item.
 */
export function modelFood(level: number, content: ContentDb): { item: string; n: number } | null {
  const K = content.balance.K;
  const step = [...K.food].reverse().find(([from]) => from <= level) ?? K.food[0];
  if (!step) return null;
  const meals = content.items.flatMap((i) =>
    i.fx?.kind === 'heal' && pouchUse(i) === 'heal' ? [{ id: i.id, hp: i.fx.hp }] : [],
  );
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
  const below = meals.filter((m) => m.hp <= step[1]).sort((a, b) => b.hp - a.hp || byId(a, b));
  const pick = below[0] ?? [...meals].sort((a, b) => a.hp - b.hp || byId(a, b))[0];
  return pick ? { item: pick.id, n: K.pouchStack } : null;
}

/**
 * The character's pouch and loadout for one enemy: it knows the enemy, carries what `equip` says
 * and lets the engine plan (`loadout.prepare`). Meals go to the bank, where the plan finds them.
 */
export function equipFor(
  state: GameState,
  entryId: string,
  content: ContentDb,
  rules: Rules,
  equip: Equipment = { pouch: 'shop', food: 'none' },
  level = 1,
): void {
  state.counters[killsKey(entryId)] = (state.counters[killsKey(entryId)] ?? 0) + 1;
  const book = (state.bingo[entryId] ??= {
    seen: 1,
    wins: 0,
    losses: 0,
    timeouts: 0,
    bought: 0,
    bounty: 0,
  });
  book.wins++;
  if (isAcademyRank(content, state.player.rank)) return;
  if (equip.pouch === 'shop') stockFromShop(state, content, rules);
  if (equip.food === 'model') {
    const food = modelFood(level, content);
    if (food) addItem(state, food.item, food.n);
  }
  dispatch(state, { type: 'loadout.prepare', encounter: entryId }, content, rules);
}
