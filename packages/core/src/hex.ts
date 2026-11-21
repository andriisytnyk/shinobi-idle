import type { Cell, ContentDb, Hex } from '@shinobi/content';
import { indexOf } from './lookup.ts';
import { touchMods } from './modifiers.ts';
import { reqMet, skillLevel, type Req } from './requirements.ts';
import type { GameState } from './state.ts';
import { activitySkill } from './vocab.ts';

/*
 * The geometry of the world grid and what runs on it: neighbours, distance, lines, the range of a
 * survey, and the shortest route by the time terrain costs. Hexes are pointy-top with axial
 * coordinates; a hex is named by its key `"q,r"`. A *position* or a *target* is an address: the id
 * of the cell that stands on the hex, or the key of the hex when no cell does.
 *
 * There is no sight. A hex the player has not surveyed is fog: it cannot be entered and a route
 * never crosses it. Surveying a hex to its first level makes it *surveyed* (see `isSurveyed`). A
 * *link* of the content joins two hexes that are not neighbours (a ferry, a pass): to the search
 * and to the survey the two ends are neighbours. Pure: everything here reads the state; the
 * searches are remembered per state and forgotten when the survey changes (see `touchWorld`).
 */

export interface Axial {
  q: number;
  r: number;
}

export const hexKey = (q: number, r: number): string => `${q},${r}`;

/** The coordinates of a key, or null when the text is not one. */
export function parseHexKey(key: string): Axial | null {
  const match = /^(-?\d{1,6}),(-?\d{1,6})$/.exec(key);
  return match ? { q: Number(match[1]), r: Number(match[2]) } : null;
}

/** The six neighbours of a pointy-top hex in axial coordinates, clockwise from the east. */
const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const neighbours = (a: Axial): Axial[] =>
  DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));

/** Steps between two hexes in a straight grid walk. */
export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Every hex within `range` steps of `center`, the center included, in a fixed order. */
export function hexesWithin(center: Axial, range: number): Axial[] {
  const out: Axial[] = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++)
      out.push({ q: center.q + dq, r: center.r + dr });
  }
  return out;
}

/** The hexes of a straight line from `a` to `b`, both ends included. */
export function hexLine(a: Axial, b: Axial): Axial[] {
  const n = hexDistance(a, b);
  const out: Axial[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // Cube coordinates, nudged so that a tie rounds the same way every time.
    const x = a.q + (b.q - a.q) * t + 1e-6;
    const z = a.r + (b.r - a.r) * t + 2e-6;
    const y = -x - z;
    let rx = Math.round(x);
    const ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy <= dz) rz = -rx - ry;
    out.push({ q: rx, r: rz });
  }
  return out;
}

// ---------- what changed ----------

const revisions = new WeakMap<GameState, number>();

/**
 * Tells the searches that the surveyed land, or a level that decides what can be surveyed, changed
 * (a hex was surveyed to a new level). The engine calls it where it changes them.
 */
export const touchWorld = (state: GameState): void => {
  touchMods(state);
  revisions.set(state, (revisions.get(state) ?? 0) + 1);
};

/** The revision of the surveyed land of a state (see `touchWorld`): a cheap stamp for what depends on the surveys alone. */
export const worldRevision = (state: GameState): number => revisions.get(state) ?? 0;

/**
 * What the remembered searches of a state were made for: the revision, and the sizes of the lists
 * of surveys (a list changed behind the engine's back changes its size, as a doctored or a test
 * state does).
 */
export const worldStamp = (state: GameState): string =>
  `${revisions.get(state) ?? 0}|${countKeys(state.world.surveyed)}|${countKeys(state.world.explores)}`;

const countKeys = (record: object): number => Object.keys(record).length;

// ---------- addresses ----------

/** The address of a hex: the cell that stands on it, else its key. */
export function addressOf(content: ContentDb, a: Axial): string {
  const key = hexKey(a.q, a.r);
  return indexOf(content).cellByHex.get(key)?.id ?? key;
}

/** The hex an address names; null when it names no hex of the map. */
export function hexOfAddress(content: ContentDb, address: string): Hex | null {
  const index = indexOf(content);
  const cell = index.cells.get(address);
  if (cell) return index.hexes.get(hexKey(cell.hex[0], cell.hex[1])) ?? null;
  return index.hexes.get(address) ?? null;
}

/** Whether a hex can be walked on and surveyed: it has a terrain. */
export const isPlayable = (hex: Hex | null | undefined): hex is Hex & { terrain: string } =>
  hex?.terrain !== undefined;

/** Whether a hex can be entered: playable and its terrain is not blocked. */
export function isEnterable(content: ContentDb, hex: Hex | null | undefined): boolean {
  if (!isPlayable(hex)) return false;
  return indexOf(content).terrains.get(hex.terrain)?.blocked !== true;
}

// ---------- keys ----------

/** The ids of the keys each hex needs (its cell's key and its terrain's key), for the hexes that need any; built once per content. */
const keyedHexes = new WeakMap<ContentDb, Map<string, string[]>>();
function keyedOf(content: ContentDb): Map<string, string[]> {
  let map = keyedHexes.get(content);
  if (map) return map;
  map = new Map();
  const index = indexOf(content);
  for (const [key, hex] of index.hexes) {
    const ids: string[] = [];
    const cellKey = index.cellByHex.get(key)?.key;
    if (cellKey) ids.push(cellKey);
    const terrainKey = hex.terrain === undefined ? undefined : index.terrains.get(hex.terrain)?.key;
    if (terrainKey && !ids.includes(terrainKey)) ids.push(terrainKey);
    if (ids.length > 0) map.set(key, ids);
  }
  keyedHexes.set(content, map);
  return map;
}

/** The ids of the keys the hex under `key` needs: its cell's key and its terrain's key (data, so a pack's terrain can carry one). Empty for an open hex. */
export const hexKeyIds = (content: ContentDb, key: string): readonly string[] =>
  keyedOf(content).get(key) ?? [];

/** The requirements of the keys the hex under `key` needs. */
export const hexKeyReqs = (content: ContentDb, key: string): Req[] =>
  hexKeyIds(content, key).flatMap((id) => content.cellKeys[id] ?? []);

/** The ids of the keys the state lacks (knowledge is the character's; clones share it), in a fixed order. */
export function unmetKeys(state: GameState, content: ContentDb): string[] {
  const out: string[] = [];
  for (const id of Object.keys(content.cellKeys).sort()) {
    const req = content.cellKeys[id];
    if (req && !reqMet(state, req, content)) out.push(id);
  }
  return out;
}

/** The keys the hex under `key` needs that the state lacks; empty when the hex is open to it. */
export const missingKeys = (state: GameState, content: ContentDb, key: string): string[] =>
  hexKeyIds(content, key).filter((id) => {
    const req = content.cellKeys[id];
    return req !== undefined && !reqMet(state, req, content);
  });

/**
 * The address where the performer of action slot `slot` stands. Slot 0 is the character
 * (`world.location`); another slot stands in `world.figures`, and where it has no entry, with the
 * character.
 */
export const positionOf = (state: GameState, slot = 0): string =>
  (slot > 0 ? state.world.figures?.[slot] : undefined) ?? state.world.location;

/** Puts the performer of `slot` on the hex at `address`. */
export function placeAt(state: GameState, slot: number, address: string): void {
  touchMods(state);
  if (slot > 0) (state.world.figures ??= {})[slot] = address;
  else state.world.location = address;
}

/** Takes the figure of the performer of `slot` off the map (a clone that was dispelled or has nothing left to do). */
export function removeFigure(state: GameState, slot: number): void {
  touchMods(state);
  const figures = state.world.figures;
  if (!figures || !(slot in figures)) return;
  delete figures[slot];
  if (Object.keys(figures).length === 0) delete state.world.figures;
}

/** The hex the performer of `slot` stands on; the first cell's hex when the saved position names nothing. */
export function positionHex(state: GameState, content: ContentDb, slot = 0): Hex | null {
  const index = indexOf(content);
  const here = hexOfAddress(content, positionOf(state, slot));
  if (here) return here;
  const first = content.cells[0];
  return first ? (index.hexes.get(hexKey(first.hex[0], first.hex[1])) ?? null) : null;
}

/** The cell that stands on the hex the performer of `slot` is on, or null on a hex with no cell. */
export function cellAtPosition(state: GameState, content: ContentDb, slot = 0): Cell | null {
  const here = positionHex(state, content, slot);
  return here ? (indexOf(content).cellByHex.get(hexKey(here.q, here.r)) ?? null) : null;
}

// ---------- what is surveyed ----------

/** Surveys at which the hex at `address` reaches its first level; null when the address is not a playable hex. */
export function firstLevelAt(content: ContentDb, address: string): number | null {
  const index = indexOf(content);
  if (index.cells.has(address)) return content.balance.K.cellExplores[0] ?? null;
  const hex = index.hexes.get(address);
  return isPlayable(hex) ? (content.balance.K.map.plainSurvey[0] ?? null) : null;
}

/** Whether the hex under `key` is surveyed: marked so, or surveyed to its first level. Fog otherwise. */
export function isSurveyed(state: GameState, content: ContentDb, key: string): boolean {
  if (state.world.surveyed[key]) return true;
  const at = parseHexKey(key);
  if (!at) return false;
  const address = addressOf(content, at);
  const need = firstLevelAt(content, address);
  return need !== null && (state.world.explores[address] ?? 0) >= need;
}

/** How far from its position the player can survey: by Scouting level, plus a hex on a found outpost. */
export function surveyRange(state: GameState, content: ContentDb, slot = 0): number {
  const map = content.balance.K.map;
  const scouting = activitySkill(content, 'map');
  const level = scouting === null ? 0 : skillLevel(state, scouting, content);
  let range = map.range[0]?.range ?? 1;
  for (const step of map.range) if (level >= step.scout) range = Math.max(range, step.range);
  const cell = cellAtPosition(state, content, slot);
  if (cell?.pois.some((p) => p.kind === 'outpost' && state.world.pois[p.id]))
    range += map.outpostRange;
  return range;
}

/** The keys of every surveyed hex, plus the one underfoot (the player can always stand and leave). */
export function surveyedKeys(state: GameState, content: ContentDb, slot = 0): Set<string> {
  const keys = new Set(Object.keys(state.world.surveyed));
  for (const address of Object.keys(state.world.explores)) {
    const hex = hexOfAddress(content, address);
    if (!hex) continue;
    const key = hexKey(hex.q, hex.r);
    if (isSurveyed(state, content, key)) keys.add(key);
  }
  const here = positionHex(state, content, slot);
  if (here) keys.add(hexKey(here.q, here.r));
  return keys;
}

// ---------- routes ----------

export interface Route {
  /** Keys of the hexes entered in order, the start excluded. */
  hexes: string[];
  /** The terrain minutes of each hex entered, before modifiers. */
  minutes: number[];
}

/** Minutes to cross a hex of `terrain` at full speed, before modifiers. */
export const terrainMinutes = (content: ContentDb, terrain: string): number =>
  content.balance.K.map.terrain[terrain]?.walkMin ?? 1;

/** The cheapest ways from a hex to every hex that can be reached over surveyed, enterable hexes. */
export interface Reach {
  start: string;
  /** Minutes of the cheapest route to each reachable hex (the start is 0). */
  dist: Map<string, number>;
  /** The hex before each reachable hex on its cheapest route. */
  prev: Map<string, string>;
}

/** The enterable neighbours of each enterable hex, and the far ends of its links, with the minutes of entering them; built once per content. */
const graphs = new WeakMap<ContentDb, Map<string, { key: string; minutes: number }[]>>();
function walkGraph(content: ContentDb): Map<string, { key: string; minutes: number }[]> {
  let graph = graphs.get(content);
  if (graph) return graph;
  graph = new Map();
  const index = indexOf(content);
  const hexes = index.hexes;
  for (const [key, hex] of hexes) {
    if (!isEnterable(content, hex)) continue;
    const edges: { key: string; minutes: number }[] = [];
    for (const n of neighbours(hex)) {
      const nk = hexKey(n.q, n.r);
      const nh = hexes.get(nk);
      if (isEnterable(content, nh))
        edges.push({ key: nk, minutes: terrainMinutes(content, nh?.terrain ?? '') });
    }
    for (const link of index.linksByHex.get(key) ?? [])
      if (isEnterable(content, hexes.get(link.to)))
        edges.push({ key: link.to, minutes: link.minutes });
    graph.set(key, edges);
  }
  graphs.set(content, graph);
  return graph;
}

/** The hexes a hex is joined to by links (not its neighbours), as keys. */
export const linkedKeys = (content: ContentDb, key: string): string[] =>
  (indexOf(content).linksByHex.get(key) ?? []).map((l) => l.to);

/** Minutes of stepping from the hex `from` onto the hex `to` (neighbours, or the ends of a link) at full speed, before modifiers. */
export function stepMinutes(content: ContentDb, from: string, to: string): number {
  const link = (indexOf(content).linksByHex.get(from) ?? []).find((l) => l.to === to);
  if (link) return link.minutes;
  return terrainMinutes(content, indexOf(content).hexes.get(to)?.terrain ?? '');
}

/** Whether a performer at `here` can reach the hex `target` with a survey: it is within `range` steps, or the far end of a link from `here`. */
export const inSurveyReach = (
  content: ContentDb,
  here: Axial,
  target: Axial,
  range: number,
): boolean =>
  hexDistance(here, target) <= range ||
  linkedKeys(content, hexKey(here.q, here.r)).includes(hexKey(target.q, target.r));

type HeapItem = [number, string];

/**
 * Dijkstra over the surveyed hexes the player can enter. Cost is the minutes of the hexes entered;
 * ties go to the smaller key so that the result never depends on the order of the search.
 */
export function reachFrom(state: GameState, content: ContentDb, from: Axial, slot = 0): Reach {
  const stamp = `${hexKey(from.q, from.r)}|${positionOf(state, slot)}|${worldStamp(state)}|${unmetKeys(state, content).join(',')}`;
  const memo = reaches.get(state)?.get(slot);
  if (memo && memo.content === content && memo.stamp === stamp) return memo.reach;
  const reach = searchFrom(state, content, from, slot, false);
  const all = reaches.get(state) ?? new Map();
  all.set(slot, { content, stamp, reach });
  reaches.set(state, all);
  return reach;
}

/** The last search of each performer of a state, good while the surveyed land and the position stay as they were. */
const reaches = new WeakMap<
  GameState,
  Map<number, { content: ContentDb; stamp: string; reach: Reach }>
>();

/**
 * The search. A hex whose key the state lacks is not entered, unless `ignoreKeys` (a diagnosis of
 * what the keys cost). A performer that stands on such a hex (a save from before the keys) may walk
 * out: keyed hexes can be entered from the keyed hexes the way out began on, never from open ground.
 */
function searchFrom(
  state: GameState,
  content: ContentDb,
  from: Axial,
  slot: number,
  ignoreKeys: boolean,
): Reach {
  const graph = walkGraph(content);
  const known = surveyedKeys(state, content, slot);
  const start = hexKey(from.q, from.r);
  const lacking = ignoreKeys ? new Set<string>() : new Set(unmetKeys(state, content));
  const locked = (key: string): boolean =>
    lacking.size > 0 && hexKeyIds(content, key).some((id) => lacking.has(id));
  const chain = new Set<string>(locked(start) ? [start] : []);
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const heap: HeapItem[] = [[0, start]];
  const less = (a: HeapItem, b: HeapItem): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (item: HeapItem): void => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      const up = heap[parent] as HeapItem;
      const me = heap[i] as HeapItem;
      if (!less(me, up)) break;
      heap[parent] = me;
      heap[i] = up;
      i = parent;
    }
  };
  const pop = (): HeapItem | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        let m = i;
        if (l < heap.length && less(heap[l] as HeapItem, heap[m] as HeapItem)) m = l;
        if (l + 1 < heap.length && less(heap[l + 1] as HeapItem, heap[m] as HeapItem)) m = l + 1;
        if (m === i) break;
        const swap = heap[m] as HeapItem;
        heap[m] = heap[i] as HeapItem;
        heap[i] = swap;
        i = m;
      }
    }
    return top;
  };
  for (let item = pop(); item; item = pop()) {
    const [cost, key] = item;
    if (done.has(key)) continue;
    done.add(key);
    for (const edge of graph.get(key) ?? []) {
      if (done.has(edge.key) || !known.has(edge.key)) continue;
      const shut = locked(edge.key);
      if (shut && !chain.has(key)) continue;
      const next = cost + edge.minutes;
      const old = dist.get(edge.key);
      if (old === undefined || next < old || (next === old && key < (prev.get(edge.key) ?? key))) {
        dist.set(edge.key, next);
        prev.set(edge.key, key);
        if (shut) chain.add(edge.key);
        push([next, edge.key]);
      }
    }
  }
  return { start, dist, prev };
}

/** The route to `goal` out of a search; null when it was not reached. */
export function pathTo(content: ContentDb, reach: Reach, goal: string): Route | null {
  if (!reach.dist.has(goal)) return null;
  const hexes: string[] = [];
  for (
    let at: string | undefined = goal;
    at !== undefined && at !== reach.start;
    at = reach.prev.get(at)
  )
    hexes.unshift(at);
  return {
    hexes,
    minutes: hexes.map((key, i) => stepMinutes(content, hexes[i - 1] ?? reach.start, key)),
  };
}

/** The route from the player's position to the hex `target`, or null when there is none. */
export function routeTo(
  state: GameState,
  content: ContentDb,
  target: Axial,
  slot = 0,
): Route | null {
  const here = positionHex(state, content, slot);
  if (!here) return null;
  return pathTo(content, reachFrom(state, content, here, slot), hexKey(target.q, target.r));
}

/**
 * What the keys cost the route to `target`: the keys the cheapest route would need if no key were
 * needed, that the state lacks (empty when that route is open). Null when the target cannot be
 * reached even with every key. For the screens: the reason of a refusal, and the note that a route
 * goes round.
 */
export function routeKeyCost(
  state: GameState,
  content: ContentDb,
  target: Axial,
  slot = 0,
): string[] | null {
  const here = positionHex(state, content, slot);
  if (!here) return null;
  const reach = searchFrom(state, content, here, slot, true);
  const route = pathTo(content, reach, hexKey(target.q, target.r));
  if (!route) return null;
  const out: string[] = [];
  for (const key of route.hexes)
    for (const id of missingKeys(state, content, key)) if (!out.includes(id)) out.push(id);
  return out;
}

// ---------- what can be surveyed from here ----------

/**
 * Whether the hex `target` can be surveyed from the position now: it is within the survey range,
 * and it is either surveyed already or next to ground the player can walk to (a hex behind fog
 * cannot be surveyed until surveyed land reaches it). `reach` may be given to save a search.
 */
export function surveyAccess(
  state: GameState,
  content: ContentDb,
  target: Axial,
  reach?: Reach,
  slot = 0,
): 'ok' | 'outOfRange' | 'cutOff' {
  const here = positionHex(state, content, slot);
  if (!here || !inSurveyReach(content, here, target, surveyRange(state, content, slot)))
    return 'outOfRange';
  if (isSurveyed(state, content, hexKey(target.q, target.r))) return 'ok';
  // The hex underfoot is always standable.
  if (hexDistance(here, target) === 0) return 'ok';
  const walkable = reach ?? reachFrom(state, content, here, slot);
  const hexes = indexOf(content).hexes;
  const touches =
    neighbours(target).some((n) => {
      const key = hexKey(n.q, n.r);
      return hexes.has(key) && walkable.dist.has(key);
    }) || linkedKeys(content, hexKey(target.q, target.r)).some((key) => walkable.dist.has(key));
  return touches ? 'ok' : 'cutOff';
}
