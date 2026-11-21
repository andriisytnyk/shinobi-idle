import type { Cell, ContentDb, Hex, Poi, Region } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { addCurrency, addItem } from './bank.ts';
import { bump } from './counters.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND, SECONDS_PER_HOUR, rate } from './formulas.ts';
import {
  addressOf,
  cellAtPosition,
  hexDistance,
  hexKey,
  hexOfAddress,
  hexesWithin,
  inSurveyReach,
  isEnterable,
  isPlayable,
  isSurveyed,
  linkedKeys,
  parseHexKey,
  pathTo,
  placeAt,
  positionHex,
  positionOf,
  reachFrom,
  routeTo,
  surveyAccess,
  stepMinutes,
  surveyRange,
  touchWorld,
  worldStamp,
  type Axial,
  type Reach,
} from './hex.ts';
import { graduateReq, indexOf } from './lookup.ts';
import { computeMod, touchMods, type Modifier, type ModifierProvider } from './modifiers.ts';
import { gainXp } from './progression.ts';
import { STAND_ID, STAND_KIND, actingPerformer } from './performer.ts';
import { pointStatus, pointsAtHex, performers, settlePoints } from './points.ts';
import { regionOpenReq } from './regions.ts';
import { actionFloor, activitySkill, currencyOf, moneyOf } from './vocab.ts';
import { evalReq, reqMet, skillLevel, type Req } from './requirements.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** The action kind that surveys a hex; the action id is the address of the hex (a cell id, or its key). */
export const EXPLORE_KIND = 'explore';
/** The action kind that walks to a hex, step by step; the action id is the address of the target. */
export const WALK_KIND = 'walk';
/** The action kind that surveys, one after another, the nearest hex within sight that can still be surveyed, walking there as needed. */
export const AUTOSURVEY_KIND = 'autosurvey';
/** The only action id of the auto-survey. */
export const AUTOSURVEY_ID = 'vision';

/** Counter of the cells of a region explored to level 1 or more; quests count it from a step's start. */
export const exploredKey = (regionId: string): string => `explored.${regionId}`;

/** The counter of the hexes of a region surveyed to their first level: named cells and plain hexes alike, each counted once. */
export const surveyedKey = (regionId: string): string => `surveyed.${regionId}`;

/** The region a hex belongs to: that of its cell, or of the nearest cell for a hex that is none (the first on a tie). */
export function regionOfHex(content: ContentDb, subject: Subject): string | null {
  if (subject.cell) return subject.cell.region;
  let best: Cell | null = null;
  let bestDistance = Infinity;
  for (const cell of content.cells) {
    const d = hexDistance(subject.hex, { q: cell.hex[0], r: cell.hex[1] });
    if (d < bestDistance) {
      best = cell;
      bestDistance = d;
    }
  }
  return best?.region ?? null;
}

/** Counts a hex that has just been surveyed to its first level for its region. */
function countSurveyed(state: GameState, subject: Subject, content: ContentDb): void {
  const region = regionOfHex(content, subject);
  if (region !== null) bump(state, surveyedKey(region));
}

/**
 * Sets the surveyed counters of every region from the surveys the state holds: for a save made
 * before the counters existed, and to keep the counters honest after a load.
 */
export function rebuildSurveyed(state: GameState, content: ContentDb): void {
  for (const key of Object.keys(state.counters)) {
    if (key.startsWith(surveyedKey(''))) delete state.counters[key];
  }
  for (const address of Object.keys(state.world.explores)) {
    const subject = subjectOf(content, address);
    if (!subject || surveyLevel(state, subject, content) < 1) continue;
    countSurveyed(state, subject, content);
  }
}
/** Flag raised when a point of interest is found. */
export const poiFlag = (poiId: string): string => `poi.${poiId}`;
/** Flag counting the deposits found for a building of the village (+1 level each). */
export const depositFlag = (buildingId: string): string => `deposit.${buildingId}`;

// ---------- what can be surveyed ----------

/** A hex that can be surveyed: its address, the playable hex and the cell on it, if any. */
export interface Subject {
  address: string;
  hex: Hex & { terrain: string };
  cell: Cell | null;
}

const subjects = new WeakMap<ContentDb, Map<string, Subject | null>>();

/** How many surveys each state has seen finish: a view that shows survey counts is good until it changes. */
const surveysDone = new WeakMap<GameState, number>();
export const surveyCount = (state: GameState): number => surveysDone.get(state) ?? 0;

/** The hex an address names, when it can be surveyed (it is playable). */
export function subjectOf(content: ContentDb, address: string): Subject | null {
  let known = subjects.get(content);
  if (!known) subjects.set(content, (known = new Map()));
  const cached = known.get(address);
  if (cached !== undefined) return cached;
  const hex = hexOfAddress(content, address);
  let subject: Subject | null = null;
  if (isPlayable(hex)) {
    const cell = indexOf(content).cellByHex.get(hexKey(hex.q, hex.r)) ?? null;
    subject = { address: cell?.id ?? hexKey(hex.q, hex.r), hex, cell };
  }
  known.set(address, subject);
  return subject;
}

// ---------- levels ----------

/** Surveys a hex has had (a cell's explorations). */
export const exploresOf = (state: GameState, address: string): number =>
  state.world.explores[address] ?? 0;

/** Cell level for a number of explorations: how many cumulative thresholds are reached. */
export function levelForExplores(count: number, content: ContentDb): number {
  return content.balance.K.cellExplores.filter((threshold) => count >= threshold).length;
}

/** Level of a hex that is no cell for a number of surveys. */
export function plainLevelFor(count: number, content: ContentDb): number {
  return content.balance.K.map.plainSurvey.filter((threshold) => count >= threshold).length;
}

/** The current level of a cell, 0 when it was never explored far enough. */
export const cellLevel = (state: GameState, cell: Cell, content: ContentDb): number =>
  levelForExplores(exploresOf(state, cell.id), content);

/** The highest level a cell can reach: a cell with no point of interest stops early in the slice. */
export function cellMaxLevel(cell: Cell, content: ContentDb): number {
  const K = content.balance.K;
  const top = K.cellExplores.length;
  return cell.pois.length === 0 ? Math.min(K.scouting.plainMaxLevel, top) : top;
}

/** Explorations at which a cell reaches its highest level. */
export const cellMaxExplores = (cell: Cell, content: ContentDb): number =>
  content.balance.K.cellExplores[cellMaxLevel(cell, content) - 1] ?? 0;

/** Surveys at which a hex that is no cell reaches its highest level. */
export const plainMaxExplores = (content: ContentDb): number =>
  content.balance.K.map.plainSurvey[content.balance.K.map.plainSurvey.length - 1] ?? 0;

/** The survey level of a subject now. */
export function surveyLevel(state: GameState, subject: Subject, content: ContentDb): number {
  const count = exploresOf(state, subject.address);
  return subject.cell ? levelForExplores(count, content) : plainLevelFor(count, content);
}

/** The highest survey level of a subject. */
export const surveyMaxLevel = (subject: Subject, content: ContentDb): number =>
  subject.cell ? cellMaxLevel(subject.cell, content) : content.balance.K.map.plainSurvey.length;

/** The pace level of exploring toward cell level `k` in `region`: region level plus the step for each level above 1. */
export const paceLevel = (region: Region, k: number, content: ContentDb): number =>
  region.scout + content.balance.K.cellLevelStep * (k - 1);

/** The Scouting level cell level `k` needs, never above the skill cap. */
export const levelNeed = (region: Region, k: number, content: ContentDb): number =>
  Math.min(content.balance.K.cap, paceLevel(region, k, content));

/** Whether a region is open (rank and Scouting level). */
export function isRegionOpen(state: GameState, region: Region, content: ContentDb): boolean {
  return evalReq(state, regionOpenReq(region, content), content).met;
}

/** The requirement of the key of a cell, or null for a cell with no key. */
export function keyReq(cell: Cell, content: ContentDb): Req | null {
  return cell.key ? (content.cellKeys[cell.key] ?? null) : null;
}

/** The skill that exploring trains: the one whose activity is `map` (Scouting). */
export const scoutSkill = (content: ContentDb): string | null => activitySkill(content, 'map');

/** The cell the player stands in, or null on a hex that holds no cell. */
export const locationCell = (state: GameState, content: ContentDb, slot = 0): Cell | null =>
  cellAtPosition(state, content, slot);

/**
 * The region the player is in: the region of the cell underfoot, else of the cell nearest to the
 * position (the first on a tie). Null when the world has no cell.
 */
export function regionHere(state: GameState, content: ContentDb, slot = 0): string | null {
  const here = positionHex(state, content, slot);
  if (!here) return null;
  let best: Cell | null = null;
  let bestDistance = Infinity;
  for (const cell of content.cells) {
    const d = hexDistance(here, { q: cell.hex[0], r: cell.hex[1] });
    if (d < bestDistance) {
      best = cell;
      bestDistance = d;
    }
  }
  return best?.region ?? null;
}

/**
 * What exploring `cell` toward its next level needs: the region open, the key, and the Scouting
 * level of that level. Null when the cell is at its highest level.
 */
export function exploreReq(state: GameState, cell: Cell, content: ContentDb): Req | null {
  const region = indexOf(content).regions.get(cell.region);
  const level = cellLevel(state, cell, content);
  if (!region || level >= cellMaxLevel(cell, content)) return null;
  const parts: Req[] = [regionOpenReq(region, content)];
  const key = keyReq(cell, content);
  if (key) parts.push(key);
  const scouting = scoutSkill(content);
  parts.push(
    scouting === null
      ? { t: 'any', of: [] }
      : { t: 'skill', skill: scouting, level: levelNeed(region, level + 1, content) },
  );
  return { t: 'all', of: parts };
}

/** What surveying a hex toward its next level needs; null at its highest level. */
export function surveyReq(state: GameState, address: string, content: ContentDb): Req | null {
  const subject = subjectOf(content, address);
  if (!subject) return null;
  if (subject.cell) return exploreReq(state, subject.cell, content);
  return surveyLevel(state, subject, content) >= surveyMaxLevel(subject, content)
    ? null
    : graduateReq(content);
}

/** Why a hex cannot be surveyed now for a cause that is not a requirement (a localization key), or null. */
export function surveyBlocked(
  state: GameState,
  address: string,
  content: ContentDb,
  reach?: Reach,
  slot = 0,
): string | null {
  const subject = subjectOf(content, address);
  if (!subject) return 'error.unknownCell';
  if (surveyLevel(state, subject, content) >= surveyMaxLevel(subject, content))
    return 'error.cellMaxed';
  const access = surveyAccess(state, content, subject.hex, reach, slot);
  if (access === 'outOfRange') return 'error.outOfRange';
  if (access === 'cutOff') return 'error.cutOff';
  return null;
}

/** Why `cell` cannot be started now for a cause that is not a requirement (a localization key), or null. */
export const exploreBlocked = (
  state: GameState,
  cell: Cell,
  content: ContentDb,
  slot = 0,
): string | null => surveyBlocked(state, cell.id, content, undefined, slot);

/**
 * Length of one survey in ms at full speed, modifiers included; at least 1. A hex that is no cell
 * also takes its terrain's share of the time; a cell takes the same time wherever it stands.
 */
export function exploreIntervalMs(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  address?: string,
): number {
  const mod = computeMod(rules, state, 'interval.explore', content).total;
  const subject = address === undefined ? null : subjectOf(content, address);
  const terrain =
    subject && !subject.cell
      ? (content.balance.K.map.terrain[subject.hex.terrain]?.survey ?? 1)
      : 1;
  return Math.max(
    actionFloor(content),
    Math.round(content.balance.K.explore * MS_PER_SECOND * mod * terrain),
  );
}

/** Scouting XP of one exploration toward cell level `k`, before modifiers. */
export function exploreXp(region: Region, k: number, content: ContentDb): number {
  const K = content.balance.K;
  return (rate(paceLevel(region, k, content), content) * K.explore) / SECONDS_PER_HOUR;
}

/** Scouting XP of one survey of a hex that is no cell, before modifiers. */
export function plainXp(content: ContentDb): number {
  const K = content.balance.K;
  return (rate(K.map.plainScout, content) * K.explore) / SECONDS_PER_HOUR;
}

// ---------- finding things ----------

/** Makes the points of a cell found: flags for quests and the village, links open, loot claimable. */
function discover(state: GameState, cell: Cell): void {
  for (const poi of cell.pois) {
    if (state.world.pois[poi.id]) continue;
    touchMods(state);
    state.world.pois[poi.id] = true;
    state.flags[poiFlag(poi.id)] = true;
    if (poi.kind === 'deposit') {
      const flag = depositFlag(poi.building);
      const have = state.flags[flag];
      state.flags[flag] = (typeof have === 'number' ? have : 0) + 1;
    }
    emit(state, { type: 'poiFound', cell: cell.id, poi: poi.id });
  }
  bump(state, exploredKey(cell.region));
}

/** Pays out one finished exploration of `cell`. Returns whether the cell is now at its highest level. */
function exploreOnce(state: GameState, cell: Cell, content: ContentDb, rules: Rules): boolean {
  const K = content.balance.K;
  const region = indexOf(content).regions.get(cell.region);
  const before = exploresOf(state, cell.id);
  const level = levelForExplores(before, content);
  const max = cellMaxLevel(cell, content);
  if (!region || level >= max) return true;
  const scouting = scoutSkill(content);
  if (scouting !== null)
    gainXp(state, scouting, exploreXp(region, level + 1, content), content, rules);
  state.world.explores[cell.id] = before + 1;
  const after = levelForExplores(before + 1, content);
  if (after > level) {
    const intel = currencyOf(content, 'study');
    if (intel !== null) addCurrency(state, intel, K.intel.perCellLevel);
    if (after === 1) {
      state.world.surveyed[hexKey(cell.hex[0], cell.hex[1])] = true;
      const subject = subjectOf(content, cell.id);
      if (subject) countSurveyed(state, subject, content);
      discover(state, cell);
    }
    emit(state, { type: 'cellLevelUp', cell: cell.id, level: after, max: after >= max });
  }
  return after >= max;
}

/** Pays out one finished survey of a hex that is no cell. Returns whether it is now at its highest level. */
function plainOnce(state: GameState, subject: Subject, content: ContentDb, rules: Rules): boolean {
  const before = exploresOf(state, subject.address);
  const level = plainLevelFor(before, content);
  const max = surveyMaxLevel(subject, content);
  if (level >= max) return true;
  const scouting = scoutSkill(content);
  if (scouting !== null) gainXp(state, scouting, plainXp(content), content, rules);
  state.world.explores[subject.address] = before + 1;
  const after = plainLevelFor(before + 1, content);
  if (after >= 1) state.world.surveyed[hexKey(subject.hex.q, subject.hex.r)] = true;
  if (after >= 1 && level < 1) countSurveyed(state, subject, content);
  if (after > level)
    emit(state, { type: 'hexSurveyed', hex: subject.address, level: after, max: after >= max });
  return after >= max;
}

/** One survey of a subject. */
function surveyOnce(state: GameState, subject: Subject, content: ContentDb, rules: Rules): boolean {
  const key = hexKey(subject.hex.q, subject.hex.r);
  const level = surveyLevel(state, subject, content);
  const known = isSurveyed(state, content, key);
  const done = subject.cell
    ? exploreOnce(state, subject.cell, content, rules)
    : plainOnce(state, subject, content, rules);
  surveysDone.set(state, (surveysDone.get(state) ?? 0) + 1);
  // A survey may reveal a point (its hex reached a new level) under a performer who stands there.
  settlePoints(state, content, rules);
  // The searches stay good while a hex only goes on being surveyed within its level, and the hex
  // is the one every plan has chosen (its count only makes it a better choice); anything else
  // (a new level, new land, a hex nobody planned) makes them be made again.
  const plans = planned.get(state);
  const ownPlans = plans
    ? [...plans.values()].every((e) => e.plan?.subject.address === subject.address)
    : true;
  if (
    done ||
    !ownPlans ||
    surveyLevel(state, subject, content) !== level ||
    isSurveyed(state, content, key) !== known
  )
    touchWorld(state);
  return done;
}

export { STAND_KIND, STAND_ID };

/** What a clone does when its walk, survey or auto-survey ends: it stands where it stopped (the character's slot is left idle). */
const standAfter = (_state: GameState, slot: number): { kind: string; id: string } | null =>
  slot > 0 ? { kind: STAND_KIND, id: STAND_ID } : null;

export const exploreKind: ActionKind = {
  // One performer surveys a hex at a time.
  unique: () => true,
  has: (id, content) => subjectOf(content, id) !== null,
  skill: (_id, content) => scoutSkill(content),
  requirements: (state, id, content) => surveyReq(state, id, content),
  blocked: (state, id, content, _rules, slot = 0) =>
    surveyBlocked(state, id, content, undefined, slot),
  intervalMs: (state, id, content, rules) => exploreIntervalMs(state, content, rules, id),
  complete(state, id, content, rules, slot = 0) {
    const subject = subjectOf(content, id);
    if (!subject) return;
    // The player walked out of range while this ran: nothing was surveyed.
    if (surveyAccess(state, content, subject.hex, undefined, slot) !== 'ok') return 'abort';
    return surveyOnce(state, subject, content, rules) ? 'stop' : 'continue';
  },
  after: standAfter,
};

// ---------- travel ----------

/** Length in ms of a step that takes `minutes` at full speed, with the walking modifiers, at least the action floor. */
export function stepMs(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  minutes: number,
): number {
  const mod = computeMod(rules, state, 'interval.walk', content).total;
  return Math.max(actionFloor(content), Math.round(minutes * MS_PER_MINUTE * mod));
}

/** Total length in ms of the route to the hex `target`, modifiers included; null when there is no route. */
export function routeMs(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  target: Axial,
  slot = 0,
): number | null {
  const route = routeTo(state, content, target, slot);
  if (!route) return null;
  // The modifiers are the same for every step: one evaluation, then the steps are summed.
  return route.minutes.reduce((sum, minutes) => sum + stepMs(state, content, rules, minutes), 0);
}

/** Why the player cannot go to the hex `address` names (a localization key), or null when the trip is allowed. */
export function travelBlocked(
  state: GameState,
  address: string,
  content: ContentDb,
  slot = 0,
): string | null {
  const hex = hexOfAddress(content, address);
  if (!hex) return 'error.unknownCell';
  const here = positionHex(state, content, slot);
  if (here && here.q === hex.q && here.r === hex.r) return 'error.alreadyThere';
  if (!isEnterable(content, hex) || !isSurveyed(state, content, hexKey(hex.q, hex.r)))
    return 'error.cellNotReachable';
  return routeTo(state, content, hex, slot) === null ? 'error.cellNotReachable' : null;
}

/** Length of a walk to `cell` from where the player stands, modifiers included; at least 1 when no route is known. */
export function walkMs(
  state: GameState,
  cell: Cell,
  content: ContentDb,
  rules: Rules,
  slot = 0,
): number {
  return (
    routeMs(state, content, rules, { q: cell.hex[0], r: cell.hex[1] }, slot) ?? actionFloor(content)
  );
}

/**
 * Moves the performer of `slot` onto a hex: position, the event, the handlers of the rules, and the
 * points of interest the performer now stands on. A handler that moves a performer or touches the
 * clock is undone (the documents promise a handler does neither).
 */
export function enterHex(
  state: GameState,
  key: string,
  content: ContentDb,
  rules: Rules,
  slot: number,
  by: 'walk' | 'paid' | 'outpost' = 'walk',
): void {
  const at = parseHexKey(key);
  const hex = indexOf(content).hexes.get(key);
  if (!at || !hex) return;
  placeAt(state, slot, addressOf(content, at));
  const terrain = hex.terrain ?? '';
  emit(state, { type: 'hexEntered', hex: key, terrain, by, slot });
  const ctx = { hex: key, q: at.q, r: at.r, terrain, by, slot } as const;
  const location = state.world.location;
  const figures = state.world.figures ? { ...state.world.figures } : undefined;
  const now = state.now;
  for (const hook of rules.hexEntered ?? []) {
    hook(state, ctx, content, rules);
    if (state.now !== now) state.now = now;
    if (state.world.location !== location) state.world.location = location;
    if (JSON.stringify(state.world.figures) !== JSON.stringify(figures)) {
      if (figures) state.world.figures = { ...figures };
      else delete state.world.figures;
    }
  }
  settlePoints(state, content, rules);
}

/** The length of the quiet cycle of standing: it never finishes anything, and a long one costs the engine almost no events. */
const STAND_MS = SECONDS_PER_HOUR * MS_PER_HOUR;

export const standKind: ActionKind = {
  has: (id) => id === STAND_ID,
  requirements: () => null,
  intervalMs: () => STAND_MS,
  complete: () => 'step',
};

export const walkKind: ActionKind = {
  has: (id, content) => hexOfAddress(content, id) !== null,
  requirements: (_state, _id, content) => graduateReq(content),
  blocked: (state, id, content, _rules, slot = 0) => travelBlocked(state, id, content, slot),
  intervalMs(state, id, content, rules, slot = 0) {
    const target = hexOfAddress(content, id);
    const minutes = target ? routeTo(state, content, target, slot)?.minutes[0] : undefined;
    return minutes === undefined ? actionFloor(content) : stepMs(state, content, rules, minutes);
  },
  complete(state, id, content, rules, slot = 0) {
    const target = hexOfAddress(content, id);
    const route = target ? routeTo(state, content, target, slot) : null;
    const next = route?.hexes[0];
    // No way on (the way was never known, or the target cannot be entered): nothing was walked.
    if (next === undefined) return 'abort';
    enterHex(state, next, content, rules, slot);
    if (route && route.hexes.length > 1) return 'step';
    emit(state, { type: 'travelled', cell: id });
    return 'stop';
  },
  abortCause: () => 'error.cellNotReachable',
  // A clone that arrives stays where it is: its slot goes on standing there until it is dispelled or given something else.
  after: standAfter,
};

// ---------- auto-survey ----------

interface AutoPlan {
  subject: Subject;
  /** The key of the hex to stand on to survey it: the position itself when the subject is near. */
  stand: string;
  /** The way to `stand`, empty when already there. */
  route: string[];
}

/** Whether a subject can be surveyed now by a player who stands next to it: not at the top, requirements met. */
function surveyable(state: GameState, subject: Subject, content: ContentDb): boolean {
  if (surveyLevel(state, subject, content) >= surveyMaxLevel(subject, content)) return false;
  const req = surveyReq(state, subject.address, content);
  return req === null || evalReq(state, req, content).met;
}

/** The last plan of each performer of a state, with what it was made for (see `planStamp`). */
const planned = new WeakMap<
  GameState,
  Map<number, { content: ContentDb; stamp: string; plan: AutoPlan | null }>
>();

/**
 * Everything the plan of a performer reads: where it stands and how far it sees, the surveyed land
 * (the revision of the world), its Scouting level, the rank and the keys that decide what may be
 * surveyed, and what the other slots survey. The plan is good until one of them changes, at any time.
 */
export function planStamp(state: GameState, content: ContentDb, slot: number): string {
  const scouting = scoutSkill(content);
  const level = scouting === null ? 0 : skillLevel(state, scouting, content);
  let keys = '';
  for (const req of Object.values(content.cellKeys))
    keys += reqMet(state, req, content) ? '1' : '0';
  let others = '';
  for (let i = 0; i < state.slots.length; i++) {
    const s = state.slots[i];
    if (i > 0) others += ',';
    if (i !== slot && s?.action?.kind === EXPLORE_KIND) others += s.action.id;
  }
  return [
    positionOf(state, slot),
    worldStamp(state),
    surveyRange(state, content, slot),
    level,
    reqMet(state, graduateReq(content), content) ? 1 : 0,
    keys,
    others,
  ].join('|');
}

/**
 * The next hex for the auto-survey. Of the hexes within the survey range that can be surveyed now,
 * those still in fog first (the fog is lifted before a surveyed hex goes deeper), then the nearest,
 * the more surveyed first, then the smaller address; so a hex being surveyed stays the
 * choice until it is done. When none is in range, the surveyable hex (next to ground the player can
 * walk to) that is cheapest to get in range of, and the spot to stand on to survey it. Null when
 * nothing is left to survey.
 */
export function autoPlan(state: GameState, content: ContentDb, slot = 0): AutoPlan | null {
  const stamp = planStamp(state, content, slot);
  const memo = planned.get(state)?.get(slot);
  if (memo && memo.content === content && memo.stamp === stamp) return memo.plan;
  const plan = planFor(state, content, slot);
  const all = planned.get(state) ?? new Map();
  all.set(slot, { content, stamp, plan });
  planned.set(state, all);
  return plan;
}

/** Whether another performer is surveying the hex at `address` right now. */
const surveyedByOther = (state: GameState, address: string, slot: number): boolean =>
  state.slots.some(
    (s, i) => i !== slot && s.action?.kind === EXPLORE_KIND && s.action.id === address,
  );

function planFor(state: GameState, content: ContentDb, slot: number): AutoPlan | null {
  const here = positionHex(state, content, slot);
  if (!here) return null;
  const reach: Reach = reachFrom(state, content, here, slot);
  const range = surveyRange(state, content, slot);
  const hereKey = hexKey(here.q, here.r);
  interface Pick {
    subject: Subject;
    /** 0 for a hex still in fog, 1 for one that is surveyed and only goes deeper: fog is lifted first. */
    deep: number;
    /** 1 for a hex that holds a point of interest the player knows of (never one still hidden, so the order tells nothing). */
    point: number;
    key: number;
    explored: number;
    stand: string;
  }
  const better = (a: Pick, b: Pick | null): boolean =>
    b === null ||
    a.deep < b.deep ||
    (a.deep === b.deep &&
      (a.point > b.point ||
        (a.point === b.point &&
          (a.key < b.key ||
            (a.key === b.key &&
              (a.explored > b.explored ||
                (a.explored === b.explored && a.subject.address < b.subject.address)))))));
  let inRange: Pick | null = null;
  const seen: Axial[] = hexesWithin(here, range);
  for (const key of linkedKeys(content, hereKey)) {
    const at = parseHexKey(key);
    if (at && !seen.some((x) => x.q === at.q && x.r === at.r)) seen.push(at);
  }
  for (const a of seen) {
    const subject = subjectOf(content, addressOf(content, a));
    if (!subject || !surveyable(state, subject, content)) continue;
    if (surveyedByOther(state, subject.address, slot)) continue;
    if (surveyAccess(state, content, a, reach, slot) !== 'ok') continue;
    const pick = {
      subject,
      deep: isSurveyed(state, content, hexKey(a.q, a.r)) ? 1 : 0,
      point: knownPoint(state, content, hexKey(a.q, a.r)),
      key: Math.min(hexDistance(here, a), range),
      explored: exploresOf(state, subject.address),
      stand: hereKey,
    };
    if (better(pick, inRange)) inRange = pick;
  }
  if (inRange) return { subject: inRange.subject, stand: hereKey, route: [] };
  // Nothing in range: walk to where something is.
  let far: Pick | null = null;
  for (const hex of indexOf(content).playableHexes) {
    const subject = subjectOf(content, hexKey(hex.q, hex.r));
    if (!subject || !surveyable(state, subject, content)) continue;
    if (surveyedByOther(state, subject.address, slot)) continue;
    const cut = !isSurveyed(state, content, hexKey(hex.q, hex.r));
    for (const [spot, minutes] of reach.dist) {
      const at = parseHexKey(spot);
      if (!at || !inSurveyReach(content, at, hex, range)) continue;
      // A hex still in fog needs a surveyed neighbour that can be walked to.
      if (cut && !neighboursInReach(content, hex, reach)) continue;
      const pick = {
        subject,
        deep: cut ? 0 : 1,
        point: knownPoint(state, content, hexKey(hex.q, hex.r)),
        key: minutes,
        explored: exploresOf(state, subject.address),
        stand: spot,
      };
      if (better(pick, far)) far = pick;
    }
  }
  if (!far) return null;
  return {
    subject: far.subject,
    stand: far.stand,
    route: pathTo(content, reach, far.stand)?.hexes ?? [],
  };
}

/** 1 when the hex holds a point of interest that the player knows of (revealed, even if it only shows a hint), else 0. */
function knownPoint(state: GameState, content: ContentDb, key: string): number {
  return pointsAtHex(content, key).some((p) => pointStatus(state, content, p) !== 'hidden') ? 1 : 0;
}

function neighboursInReach(content: ContentDb, hex: Axial, reach: Reach): boolean {
  return (
    hexesWithin(hex, 1).some((n) => reach.dist.has(hexKey(n.q, n.r))) ||
    linkedKeys(content, hexKey(hex.q, hex.r)).some((key) => reach.dist.has(key))
  );
}

const positionKey = (state: GameState, content: ContentDb, slot: number): string => {
  const at = positionHex(state, content, slot);
  return at ? hexKey(at.q, at.r) : '';
};

export const autoSurveyKind: ActionKind = {
  has: (id) => id === AUTOSURVEY_ID,
  skill: (_id, content) => scoutSkill(content),
  requirements: (_state, _id, content) => graduateReq(content),
  blocked: (state, _id, content, _rules, slot = 0) =>
    autoPlan(state, content, slot) ? null : 'error.nothingToSurvey',
  intervalMs(state, _id, content, rules, slot = 0) {
    const plan = autoPlan(state, content, slot);
    if (!plan) return actionFloor(content);
    const next = plan.route[0];
    if (next === undefined) return exploreIntervalMs(state, content, rules, plan.subject.address);
    return stepMs(
      state,
      content,
      rules,
      stepMinutes(content, positionKey(state, content, slot), next),
    );
  },
  complete(state, _id, content, rules, slot = 0) {
    const plan = autoPlan(state, content, slot);
    if (!plan) return 'abort';
    const next = plan.route[0];
    if (next === undefined) {
      surveyOnce(state, plan.subject, content, rules);
      return 'continue';
    }
    enterHex(state, next, content, rules, slot);
    return 'step';
  },
  abortCause: () => 'error.nothingToSurvey',
  after: standAfter,
};

// ---------- loot ----------

/** Takes the one-time loot of a cache or a vault the player has found and stands next to. */
export function claimPoi(state: GameState, poiId: string, content: ContentDb): CommandResult {
  const entry = indexOf(content).pois.get(poiId);
  if (!entry) return { ok: false, reason: 'error.unknownPoi' };
  const { poi, cell } = entry;
  if (poi.kind !== 'cache' && poi.kind !== 'vault')
    return { ok: false, reason: 'error.notClaimable' };
  if (!state.world.pois[poiId]) return { ok: false, reason: 'error.poiNotFound' };
  if (state.world.claimed[poiId]) return { ok: false, reason: 'error.alreadyClaimed' };
  if (locationCell(state, content)?.id !== cell.id) return { ok: false, reason: 'error.notHere' };
  const loot = poi.kind === 'cache' ? poi.items : [{ item: poi.item, n: 1 }];
  for (const { item, n } of loot) {
    if (addItem(state, item, n)) emit(state, { type: 'itemGained', id: item, n });
  }
  if (poi.kind === 'cache') {
    addCurrency(state, moneyOf(content), poi.ryo);
    for (const [currency, n] of Object.entries(poi.currencies ?? {}))
      addCurrency(state, currency, n);
  }
  state.world.claimed[poiId] = true;
  emit(state, { type: 'poiClaimed', poi: poiId });
  return { ok: true };
}

// ---------- modifiers ----------

const trainingKept = new WeakMap<ContentDb, string[]>();

/** The ids of every training spot of the content. */
function trainingIds(content: ContentDb): string[] {
  let ids = trainingKept.get(content);
  if (!ids) {
    ids = [];
    for (const [id, { poi }] of indexOf(content).pois) if (poi.kind === 'training') ids.push(id);
    trainingKept.set(content, ids);
  }
  return ids;
}

/** The training spots the performer being computed (`actingPerformer`) stands in, once each, when their cells have been explored: a spot helps the one who stands on it. */
function trainingHere(state: GameState, content: ContentDb): (Poi & { kind: 'training' })[] {
  // The providers are asked all the time: with no training spot found there is nothing to look at.
  if (!trainingIds(content).some((id) => state.world.pois[id])) return [];
  const out = new Map<string, Poi & { kind: 'training' }>();
  const acting = actingPerformer();
  for (const { slot, key } of performers(state, content)) {
    if (slot !== acting) continue;
    const cell = indexOf(content).cellByHex.get(key);
    for (const p of cell?.pois ?? [])
      if (p.kind === 'training' && state.world.pois[p.id]) out.set(p.id, p);
  }
  return [...out.values()];
}

/**
 * Athletics shortens exploring and walking a little per level, up to a cap; a training spot
 * gives its skill extra XP while the player stands in its cell.
 */
export const worldProvider: ModifierProvider = (state, content) => {
  const S = content.balance.K.scouting;
  const out: Modifier[] = [];
  const conditioning = activitySkill(content, 'course');
  if (conditioning !== null) {
    const cut = Math.min(S.athCap, S.athPerLevel * skillLevel(state, conditioning, content));
    for (const key of ['interval.explore', 'interval.walk']) {
      out.push({
        key,
        op: 'add',
        value: -cut,
        group: 'character',
        source: { kind: 'skill', id: conditioning },
      });
    }
  }
  for (const poi of trainingHere(state, content)) {
    out.push({
      key: `xp.skill.${poi.skill}`,
      op: 'add',
      value: poi.bonus,
      group: 'character',
      source: { kind: 'poi', id: poi.id },
    });
  }
  return out;
};
