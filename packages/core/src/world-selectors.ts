import type { CellKey, ContentDb, PoiKind } from '@shinobi/content';
import { MS_PER_HOUR } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { getMod } from './mod.ts';
import { evalReq, type ReqResult } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';
import {
  cellLevel,
  cellMaxLevel,
  exploreBlocked,
  exploreIntervalMs,
  exploreReq,
  exploreXp,
  exploresOf,
  isRegionOpen,
  keyReq,
  levelNeed,
  regionHere,
  routeMs,
  stepMs,
  subjectOf,
  surveyBlocked,
  surveyLevel,
  surveyMaxLevel,
  surveyReq,
  travelBlocked,
} from './world.ts';
import {
  hexKey,
  isSurveyed,
  positionHex,
  reachFrom,
  routeTo,
  surveyAccess,
  surveyRange,
  type Reach,
} from './hex.ts';
import { regionOpenReq } from './regions.ts';

/*
 * Read-only views of the map for the UI and bots. Nothing here changes the state.
 */

/** Whether the fight zone is open for the player: its cell is explored to level 1. Zones tied to no cell are always available here. */
export function zoneAvailable(state: GameState, zoneId: string, content: ContentDb): boolean {
  const cell = indexOf(content).zoneCell.get(zoneId);
  return cell ? cellLevel(state, cell, content) >= 1 : true;
}

/** The cell that opens a fight zone, or null for a zone that is not tied to a cell. */
export function zoneCellOf(zoneId: string, content: ContentDb): string | null {
  return indexOf(content).zoneCell.get(zoneId)?.id ?? null;
}

export interface RegionInfo {
  id: string;
  open: boolean;
  /** Rank and Scouting level that open it, evaluated. */
  req: ReqResult;
  cells: string[];
  /** Cells explored to level 1 or more. */
  explored: number;
  /** Whether the player stands in this region. */
  here: boolean;
}

/** The regions with their open state and the requirement tree that opens them. */
export function listRegions(state: GameState, content: ContentDb): RegionInfo[] {
  const index = indexOf(content);
  const at = regionHere(state, content);
  return content.regions.map((region) => ({
    id: region.id,
    open: isRegionOpen(state, region, content),
    req: evalReq(state, regionOpenReq(region, content), content),
    cells: region.cells,
    explored: region.cells.filter((id) => {
      const cell = index.cells.get(id);
      return !!cell && cellLevel(state, cell, content) >= 1;
    }).length,
    here: region.id === at,
  }));
}

export interface PoiInfo {
  id: string;
  kind: PoiKind;
  found: boolean;
  claimed: boolean;
  /** A cache or vault that can be taken right now. */
  claimable: boolean;
}

export interface CellInfo {
  id: string;
  region: string;
  key: CellKey | null;
  level: number;
  maxLevel: number;
  explores: number;
  /** Explorations at which the current level began and at which the next begins; null at the top. */
  levelStart: number;
  nextAt: number | null;
  /** Share of the way to the next level, 0..1 (1 at the top). */
  progress: number;
  /** The key's requirement tree evaluated; null for a cell with no key. */
  keyReq: ReqResult | null;
  /** The requirement tree of the next exploration (region, key, Scouting level); null at the top. */
  req: ReqResult | null;
  /** Scouting level the next level needs; null at the top. */
  nextLevelNeed: number | null;
  located: boolean;
  /** Whether the cell's hex can be surveyed from where the player stands (in range, not behind fog). */
  near: boolean;
  /** Whether exploring can start now. */
  explorable: boolean;
  /** Why not (a localization key); null when explorable. */
  why: string | null;
  /** Length of one exploration and Scouting XP per hour at full speed, modifiers included. */
  intervalMs: number;
  xpPerHour: number;
  /** Points of interest; only the found ones say what they are worth showing. */
  pois: PoiInfo[];
  /** Whether the player can go there now (explored, or an outpost of an open region). */
  reachable: boolean;
}

/** The map view of one cell, or null for an unknown id. */
export function cellInfo(
  state: GameState,
  cellId: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): CellInfo | null {
  const index = indexOf(content);
  const cell = index.cells.get(cellId);
  const region = cell && index.regions.get(cell.region);
  if (!cell || !region) return null;
  const K = content.balance.K;
  const explores = exploresOf(state, cell.id);
  const level = cellLevel(state, cell, content);
  const maxLevel = cellMaxLevel(cell, content);
  const top = level >= maxLevel;
  const start = K.cellExplores[level - 1] ?? 0;
  const next = top ? null : (K.cellExplores[level] ?? null);
  const req = exploreReq(state, cell, content);
  const reqResult = req ? evalReq(state, req, content) : null;
  const key = keyReq(cell, content);
  const keyResult = key ? evalReq(state, key, content) : null;
  const intervalMs = exploreIntervalMs(state, content, rules);
  const target = Math.min(level + 1, maxLevel);
  const xpMod =
    getMod(state, 'xp.all', content, rules).total *
    getMod(state, 'xp.skill.scout', content, rules).total;
  const blocked = exploreBlocked(state, cell, content);
  const requirementsMet = reqResult?.met ?? false;
  let why: string | null = blocked;
  if (!why && !requirementsMet) {
    why = !isRegionOpen(state, region, content)
      ? 'error.regionClosed'
      : keyResult && !keyResult.met
        ? 'error.keyMissing'
        : 'error.scoutLevelLow';
  }
  // A closed region reads better than "too far" for a cell the player cannot reach anyway.
  if (blocked === 'error.outOfRange' && !isRegionOpen(state, region, content)) {
    why = 'error.regionClosed';
  }
  return {
    id: cell.id,
    region: cell.region,
    key: cell.key,
    level,
    maxLevel,
    explores,
    levelStart: start,
    nextAt: next,
    progress: next === null ? 1 : (explores - start) / (next - start),
    keyReq: keyResult,
    req: reqResult,
    nextLevelNeed: top ? null : levelNeed(region, level + 1, content),
    located: locationHexKey(state, content) === hexKey(cell.hex[0], cell.hex[1]),
    near: surveyAccess(state, content, { q: cell.hex[0], r: cell.hex[1] }) === 'ok',
    explorable: why === null,
    why,
    intervalMs,
    xpPerHour: (exploreXp(region, target, content) * MS_PER_HOUR * xpMod) / intervalMs,
    pois: cell.pois.map((p) => {
      const found = !!state.world.pois[p.id];
      const claimed = !!state.world.claimed[p.id];
      return {
        id: p.id,
        kind: p.kind,
        found,
        claimed,
        claimable:
          found &&
          !claimed &&
          (p.kind === 'cache' || p.kind === 'vault') &&
          locationHexKey(state, content) === hexKey(cell.hex[0], cell.hex[1]),
      };
    }),
    reachable:
      travelBlocked(state, cell.id, content) === null ||
      locationHexKey(state, content) === hexKey(cell.hex[0], cell.hex[1]),
  };
}

/** Every cell of the map, region by region. */
export function listCells(
  state: GameState,
  content: ContentDb,
  rules: Rules = defaultRules,
): CellInfo[] {
  return content.cells.flatMap((c) => cellInfo(state, c.id, content, rules) ?? []);
}

/** The key of the hex the player stands on, or null when the world has no hex. */
function locationHexKey(state: GameState, content: ContentDb): string | null {
  const here = positionHex(state, content);
  return here ? hexKey(here.q, here.r) : null;
}

export interface TravelPlan {
  /** Why the trip cannot be made (a localization key); null when it can. */
  blocked: string | null;
  /** Keys of the hexes the route enters in order, the start excluded; empty when there is no route. */
  hexes: string[];
  /** Length of the whole route in ms at full speed, modifiers included; 0 when there is no route. */
  ms: number;
}

/** The route to the hex that `address` names with its length, for showing before the player goes. */
export function travelPlan(
  state: GameState,
  address: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): TravelPlan {
  const blocked = travelBlocked(state, address, content);
  const hex = indexOf(content).cells.get(address)
    ? subjectOf(content, address)?.hex
    : indexOf(content).hexes.get(address);
  const route = blocked === null && hex ? routeTo(state, content, hex) : null;
  return {
    blocked,
    hexes: route?.hexes ?? [],
    ms: hex && route ? (routeMs(state, content, rules, hex) ?? 0) : 0,
  };
}

/** What one hex looks like to the player: what is known, what can be done. */
export interface HexInfo {
  key: string;
  q: number;
  r: number;
  /** The address of the hex (a cell id, or the key); what actions and commands call it. */
  address: string;
  /** The country, known once the hex is surveyed. */
  country: string | null;
  /** The terrain, known once the hex is surveyed; null in fog and for a hex that can only be drawn. */
  terrain: string | null;
  playable: boolean;
  /** Surveyed to its first level (or marked so): the player can walk on it. Fog otherwise. */
  surveyed: boolean;
  /** The player stands here. */
  here: boolean;
  /** Can be surveyed from where the player stands: in range and not behind fog. */
  inRange: boolean;
  /** The id of the cell on the hex, known once the hex is surveyed. */
  cell: string | null;
  /** The ids of the named places on the hex, once it has been surveyed at least once. */
  places: string[];
  level: number;
  maxLevel: number;
  explores: number;
  /** Why the hex cannot be surveyed now; null when it can. */
  surveyWhy: string | null;
  /** Length of one survey and Scouting XP per hour at full speed, modifiers included; 0 when the hex cannot be surveyed. */
  surveyMs: number;
}

/** The view of one hex of the grid, or null for a coordinate that is no hex. */
export function hexInfo(
  state: GameState,
  key: string,
  content: ContentDb,
  rules: Rules = defaultRules,
  reach?: Reach,
): HexInfo | null {
  const index = indexOf(content);
  const hex = index.hexes.get(key);
  if (!hex) return null;
  const surveyed = isSurveyed(state, content, key);
  const subject = subjectOf(content, key);
  const here = locationHexKey(state, content) === key;
  const level = subject ? surveyLevel(state, subject, content) : 0;
  const req = subject ? surveyReq(state, subject.address, content) : null;
  const blocked = subject
    ? surveyBlocked(state, subject.address, content, reach)
    : 'error.unknownCell';
  let why = blocked;
  if (!why && req && !evalReq(state, req, content).met)
    why = req.t === 'rank' ? 'error.surveyRank' : 'error.scoutLevelLow';
  return {
    key,
    q: hex.q,
    r: hex.r,
    address: subject?.address ?? key,
    country: surveyed ? (hex.country ?? null) : null,
    terrain: surveyed ? (hex.terrain ?? null) : null,
    playable: hex.terrain !== undefined,
    surveyed,
    here,
    inRange: surveyAccess(state, content, hex, reach) === 'ok',
    cell: surveyed ? (subject?.cell?.id ?? null) : null,
    places: surveyed && level >= 1 ? (index.placesByHex.get(key) ?? []).map((p) => p.id) : [],
    level,
    maxLevel: subject ? surveyMaxLevel(subject, content) : 0,
    explores: subject ? exploresOf(state, subject.address) : 0,
    surveyWhy: why,
    surveyMs:
      subject && why === null ? exploreIntervalMs(state, content, rules, subject.address) : 0,
  };
}

/** Every hex of the grid; the way search is done once for all of them. */
export function listHexes(
  state: GameState,
  content: ContentDb,
  rules: Rules = defaultRules,
): HexInfo[] {
  const here = positionHex(state, content);
  const reach = here ? reachFrom(state, content, here) : undefined;
  return content.hexes.flatMap(
    (h) => hexInfo(state, hexKey(h.q, h.r), content, rules, reach) ?? [],
  );
}

/** How far the player can survey from here now, for drawing the reach. */
export const rangeNow = (state: GameState, content: ContentDb): number =>
  surveyRange(state, content);

/** Length of one step onto a hex of `terrain`, for showing a route before it is walked. */
export const stepTime = (
  state: GameState,
  terrain: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): number => stepMs(state, content, rules, terrain);
