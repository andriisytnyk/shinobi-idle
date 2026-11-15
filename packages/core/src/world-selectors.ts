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
  inRegionOf,
  instantCost,
  isRegionOpen,
  keyReq,
  levelNeed,
  travelBlocked,
  walkMs,
} from './world.ts';
import { regionOpenReq } from './regions.ts';
import { moneyOf } from './vocab.ts';

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
  const at = index.cells.get(state.world.location)?.region ?? null;
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
  /** Whether the player stands in the cell's region (exploring needs it). */
  inRegion: boolean;
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
  // A closed region reads better than "not in region" for a cell the player cannot reach anyway.
  if (blocked === 'error.notInRegion' && !isRegionOpen(state, region, content)) {
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
    located: state.world.location === cell.id,
    inRegion: inRegionOf(state, cell, content),
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
          state.world.location === cell.id,
      };
    }),
    reachable: travelBlocked(state, cell.id, content) === null || state.world.location === cell.id,
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

export interface TravelOption {
  cell: string;
  region: string;
  /** Whether the target is an outpost (instant trips there are free). */
  outpost: boolean;
  /** Ryo of an instant trip; 0 for an outpost. */
  instantCost: number;
  canAffordInstant: boolean;
  /** Length of a walk in ms at full speed, modifiers included. */
  walkMs: number;
}

/** Where the player can go from here, with what each way costs. */
export function travelOptions(
  state: GameState,
  content: ContentDb,
  rules: Rules = defaultRules,
): TravelOption[] {
  return content.cells.flatMap((cell) => {
    if (travelBlocked(state, cell.id, content) !== null) return [];
    const cost = instantCost(cell, content);
    return [
      {
        cell: cell.id,
        region: cell.region,
        outpost: cell.pois.some((p) => p.kind === 'outpost'),
        instantCost: cost,
        canAffordInstant: (state.currencies[moneyOf(content)] ?? 0) >= cost,
        walkMs: walkMs(state, cell, content, rules),
      },
    ];
  });
}
