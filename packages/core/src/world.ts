import type { Cell, ContentDb, Hex, Poi, Region } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { addCurrency, addItem } from './bank.ts';
import { bump } from './counters.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { MS_PER_MINUTE, MS_PER_SECOND, SECONDS_PER_HOUR, rate } from './formulas.ts';
import {
  addressOf,
  cellAtPosition,
  hexDistance,
  hexKey,
  hexOfAddress,
  hexesWithin,
  isEnterable,
  isPlayable,
  isSurveyed,
  parseHexKey,
  pathTo,
  placeAt,
  positionHex,
  positionOf,
  reachFrom,
  routeTo,
  surveyAccess,
  surveyRange,
  terrainMinutes,
  type Axial,
  type Reach,
} from './hex.ts';
import { graduateReq, indexOf } from './lookup.ts';
import { computeMod, type Modifier, type ModifierProvider } from './modifiers.ts';
import { gainXp } from './progression.ts';
import { regionOpenReq } from './regions.ts';
import { actionFloor, activitySkill, currencyOf, moneyOf } from './vocab.ts';
import { evalReq, skillLevel, type Req } from './requirements.ts';
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

/** The hex an address names, when it can be surveyed (it is playable). */
export function subjectOf(content: ContentDb, address: string): Subject | null {
  const hex = hexOfAddress(content, address);
  if (!isPlayable(hex)) return null;
  const cell = indexOf(content).cellByHex.get(hexKey(hex.q, hex.r)) ?? null;
  return { address: cell?.id ?? hexKey(hex.q, hex.r), hex, cell };
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
  const mod = computeMod(rules.modifierProviders, state, 'interval.explore', content).total;
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
  if (after > level)
    emit(state, { type: 'hexSurveyed', hex: subject.address, level: after, max: after >= max });
  return after >= max;
}

/** One survey of a subject. */
function surveyOnce(state: GameState, subject: Subject, content: ContentDb, rules: Rules): boolean {
  planned.delete(state);
  return subject.cell
    ? exploreOnce(state, subject.cell, content, rules)
    : plainOnce(state, subject, content, rules);
}

export const exploreKind: ActionKind = {
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
};

// ---------- travel ----------

/** Minutes of the hexes of a route in ms with the walking modifiers, each hex at least the action floor. */
export function stepMs(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  terrain: string,
): number {
  const mod = computeMod(rules.modifierProviders, state, 'interval.walk', content).total;
  return Math.max(
    actionFloor(content),
    Math.round(terrainMinutes(content, terrain) * MS_PER_MINUTE * mod),
  );
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
  const hexes = indexOf(content).hexes;
  return route.hexes.reduce(
    (sum, key) => sum + stepMs(state, content, rules, hexes.get(key)?.terrain ?? ''),
    0,
  );
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

/** Moves the performer of `slot` onto a hex: position, the event and the handlers of the rules. */
function enterHex(
  state: GameState,
  key: string,
  content: ContentDb,
  rules: Rules,
  slot: number,
): void {
  planned.delete(state);
  const at = parseHexKey(key);
  const hex = indexOf(content).hexes.get(key);
  if (!at || !hex) return;
  placeAt(state, slot, addressOf(content, at));
  const terrain = hex.terrain ?? '';
  emit(state, { type: 'hexEntered', hex: key, terrain, by: 'walk', slot });
  const ctx = { hex: key, q: at.q, r: at.r, terrain, by: 'walk', slot } as const;
  for (const hook of rules.hexEntered ?? []) hook(state, ctx, content, rules);
}

export const walkKind: ActionKind = {
  has: (id, content) => hexOfAddress(content, id) !== null,
  requirements: (_state, _id, content) => graduateReq(content),
  blocked: (state, id, content, _rules, slot = 0) => travelBlocked(state, id, content, slot),
  intervalMs(state, id, content, rules, slot = 0) {
    const target = hexOfAddress(content, id);
    const next = target ? routeTo(state, content, target, slot)?.hexes[0] : undefined;
    const terrain = next ? indexOf(content).hexes.get(next)?.terrain : undefined;
    return terrain === undefined ? actionFloor(content) : stepMs(state, content, rules, terrain);
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

/** The last plan of each performer of a state, good for the same game time and position until a step or a survey changes the world. */
const planned = new WeakMap<
  GameState,
  Map<number, { now: number; location: string; plan: AutoPlan | null }>
>();

/**
 * The next hex for the auto-survey. Of the hexes within the survey range that can be surveyed now,
 * those still in fog first (the fog is lifted before a surveyed hex goes deeper), then the nearest,
 * the more surveyed first, then the smaller address; so a hex being surveyed stays the
 * choice until it is done. When none is in range, the surveyable hex (next to ground the player can
 * walk to) that is cheapest to get in range of, and the spot to stand on to survey it. Null when
 * nothing is left to survey.
 */
export function autoPlan(state: GameState, content: ContentDb, slot = 0): AutoPlan | null {
  const where = positionOf(state, slot);
  const memo = planned.get(state)?.get(slot);
  if (memo && memo.now === state.now && memo.location === where) return memo.plan;
  const plan = planFor(state, content, slot);
  const all = planned.get(state) ?? new Map();
  all.set(slot, { now: state.now, location: where, plan });
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
    key: number;
    explored: number;
    stand: string;
  }
  const better = (a: Pick, b: Pick | null): boolean =>
    b === null ||
    a.deep < b.deep ||
    (a.deep === b.deep &&
      (a.key < b.key ||
        (a.key === b.key &&
          (a.explored > b.explored ||
            (a.explored === b.explored && a.subject.address < b.subject.address)))));
  let inRange: Pick | null = null;
  for (const a of hexesWithin(here, range)) {
    const subject = subjectOf(content, addressOf(content, a));
    if (!subject || !surveyable(state, subject, content)) continue;
    if (surveyedByOther(state, subject.address, slot)) continue;
    if (surveyAccess(state, content, a, reach, slot) !== 'ok') continue;
    const pick = {
      subject,
      deep: isSurveyed(state, content, hexKey(a.q, a.r)) ? 1 : 0,
      key: hexDistance(here, a),
      explored: exploresOf(state, subject.address),
      stand: hereKey,
    };
    if (better(pick, inRange)) inRange = pick;
  }
  if (inRange) return { subject: inRange.subject, stand: hereKey, route: [] };
  // Nothing in range: walk to where something is.
  let far: Pick | null = null;
  for (const hex of content.hexes) {
    if (!isPlayable(hex)) continue;
    const subject = subjectOf(content, hexKey(hex.q, hex.r));
    if (!subject || !surveyable(state, subject, content)) continue;
    if (surveyedByOther(state, subject.address, slot)) continue;
    const cut = !isSurveyed(state, content, hexKey(hex.q, hex.r));
    for (const [spot, minutes] of reach.dist) {
      const at = parseHexKey(spot);
      if (!at || hexDistance(at, hex) > range) continue;
      // A hex still in fog needs a surveyed neighbour that can be walked to.
      if (cut && !neighboursInReach(hex, reach)) continue;
      const pick = {
        subject,
        deep: cut ? 0 : 1,
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

function neighboursInReach(hex: Axial, reach: Reach): boolean {
  return hexesWithin(hex, 1).some((n) => reach.dist.has(hexKey(n.q, n.r)));
}

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
    return stepMs(state, content, rules, indexOf(content).hexes.get(next)?.terrain ?? '');
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

/** The training spot the player stands in, when its cell has been explored. */
function trainingHere(state: GameState, content: ContentDb): (Poi & { kind: 'training' })[] {
  const cell = locationCell(state, content);
  if (!cell) return [];
  return cell.pois.flatMap((p) => (p.kind === 'training' && state.world.pois[p.id] ? [p] : []));
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
