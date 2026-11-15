import type { Cell, ContentDb, Poi, Region } from '@shinobi/content';
import { stopSlot, type ActionKind } from './actions.ts';
import { addCurrency, addItem, removeCurrency } from './bank.ts';
import { bump } from './counters.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { MS_PER_MINUTE, MS_PER_SECOND, SECONDS_PER_HOUR, rate } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { computeMod, type Modifier, type ModifierProvider } from './modifiers.ts';
import { gainXp } from './progression.ts';
import { regionOpenReq } from './regions.ts';
import { actionFloor, activitySkill, currencyOf, moneyOf } from './vocab.ts';
import { evalReq, skillLevel, type Req } from './requirements.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** The action kind that explores a cell; the action id is the cell id. */
export const EXPLORE_KIND = 'explore';
/** The action kind that walks to a cell; the action id is the target cell id. */
export const WALK_KIND = 'walk';

/** Counter of the cells of a region explored to level 1 or more; quests count it from a step's start. */
export const exploredKey = (regionId: string): string => `explored.${regionId}`;
/** Flag raised when a point of interest is found. */
export const poiFlag = (poiId: string): string => `poi.${poiId}`;
/** Flag counting the deposits found for a building of the village (+1 level each). */
export const depositFlag = (buildingId: string): string => `deposit.${buildingId}`;

// ---------- levels ----------

/** Explorations a cell has had. */
export const exploresOf = (state: GameState, cellId: string): number =>
  state.world.explores[cellId] ?? 0;

/** Cell level for a number of explorations: how many cumulative thresholds are reached. */
export function levelForExplores(count: number, content: ContentDb): number {
  return content.balance.K.cellExplores.filter((threshold) => count >= threshold).length;
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

/** The cell the player stands in; the first cell of the world when the saved one is unknown. */
export function locationCell(state: GameState, content: ContentDb): Cell | null {
  const index = indexOf(content);
  return index.cells.get(state.world.location) ?? content.cells[0] ?? null;
}

/** Whether the player stands in the region of `cell`. */
export const inRegionOf = (state: GameState, cell: Cell, content: ContentDb): boolean =>
  locationCell(state, content)?.region === cell.region;

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

/** Why `cell` cannot be started now for a cause that is not a requirement (a localization key), or null. */
export function exploreBlocked(state: GameState, cell: Cell, content: ContentDb): string | null {
  if (cellLevel(state, cell, content) >= cellMaxLevel(cell, content)) return 'error.cellMaxed';
  if (!inRegionOf(state, cell, content)) return 'error.notInRegion';
  return null;
}

/** Length of one exploration in ms at full speed, modifiers included; at least 1. */
export function exploreIntervalMs(state: GameState, content: ContentDb, rules: Rules): number {
  const mod = computeMod(rules.modifierProviders, state, 'interval.explore', content).total;
  return Math.max(
    actionFloor(content),
    Math.round(content.balance.K.explore * MS_PER_SECOND * mod),
  );
}

/** Scouting XP of one exploration toward cell level `k`, before modifiers. */
export function exploreXp(region: Region, k: number, content: ContentDb): number {
  const K = content.balance.K;
  return (rate(paceLevel(region, k, content), content) * K.explore) / SECONDS_PER_HOUR;
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
    if (after === 1) discover(state, cell);
    emit(state, { type: 'cellLevelUp', cell: cell.id, level: after, max: after >= max });
  }
  return after >= max;
}

export const exploreKind: ActionKind = {
  has: (id, content) => indexOf(content).cells.has(id),
  skill: (_id, content) => scoutSkill(content),
  requirements(state, id, content) {
    const cell = indexOf(content).cells.get(id);
    return cell ? exploreReq(state, cell, content) : null;
  },
  blocked(state, id, content) {
    const cell = indexOf(content).cells.get(id);
    return cell ? exploreBlocked(state, cell, content) : null;
  },
  intervalMs: (state, _id, content, rules) => exploreIntervalMs(state, content, rules),
  complete(state, id, content, rules) {
    const cell = indexOf(content).cells.get(id);
    if (!cell) return;
    // The player left the region while this ran: nothing was explored.
    if (!inRegionOf(state, cell, content)) return 'abort';
    return exploreOnce(state, cell, content, rules) ? 'stop' : 'continue';
  },
};

// ---------- travel ----------

const hasOutpost = (cell: Cell): boolean => cell.pois.some((p) => p.kind === 'outpost');

/** Why the player cannot go to `cellId` (a localization key), or null when the trip is allowed. */
export function travelBlocked(state: GameState, cellId: string, content: ContentDb): string | null {
  const index = indexOf(content);
  const cell = index.cells.get(cellId);
  if (!cell) return 'error.unknownCell';
  if (state.world.location === cellId) return 'error.alreadyThere';
  const explored = cellLevel(state, cell, content) >= 1;
  const region = index.regions.get(cell.region);
  const outpost = hasOutpost(cell) && !!region && isRegionOpen(state, region, content);
  return explored || outpost ? null : 'error.cellNotReachable';
}

/** Ryo an instant trip to `cell` costs: by region, nothing when the target is an outpost. */
export function instantCost(cell: Cell, content: ContentDb): number {
  if (hasOutpost(cell)) return 0;
  const at = content.regions.findIndex((r) => r.id === cell.region);
  return content.balance.K.travel[at] ?? 0;
}

/** Length of a walk to `cell` from where the player stands, modifiers included; at least 1. */
export function walkMs(state: GameState, cell: Cell, content: ContentDb, rules: Rules): number {
  const S = content.balance.K.scouting;
  const minutes = inRegionOf(state, cell, content) ? S.walkWithinMin : S.walkBetweenMin;
  const mod = computeMod(rules.modifierProviders, state, 'interval.walk', content).total;
  return Math.max(actionFloor(content), Math.round(minutes * MS_PER_MINUTE * mod));
}

/** Pays for and makes an instant trip; slots that walk or explore elsewhere stop. */
export function travelInstant(
  state: GameState,
  cellId: string,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const blocked = travelBlocked(state, cellId, content);
  if (blocked) return { ok: false, reason: blocked };
  const cell = indexOf(content).cells.get(cellId);
  if (!cell) return { ok: false, reason: 'error.unknownCell' };
  if (!removeCurrency(state, moneyOf(content), instantCost(cell, content))) {
    return { ok: false, reason: 'error.notEnoughRyo' };
  }
  state.world.location = cell.id;
  emit(state, { type: 'travelled', cell: cell.id });
  state.slots.forEach((slot, at) => {
    const action = slot.action;
    if (!action) return;
    const elsewhere =
      action.kind === EXPLORE_KIND && indexOf(content).cells.get(action.id)?.region !== cell.region;
    if (action.kind === WALK_KIND || elsewhere) stopSlot(state, at, 'requirements', content, rules);
  });
  return { ok: true };
}

export const walkKind: ActionKind = {
  has: (id, content) => indexOf(content).cells.has(id),
  requirements: () => null,
  blocked: (state, id, content) => travelBlocked(state, id, content),
  intervalMs(state, id, content, rules) {
    const cell = indexOf(content).cells.get(id);
    return cell ? walkMs(state, cell, content, rules) : 1;
  },
  complete(state, id) {
    state.world.location = id;
    emit(state, { type: 'travelled', cell: id });
    return 'stop';
  },
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
  if (state.world.location !== cell.id) return { ok: false, reason: 'error.notHere' };
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
