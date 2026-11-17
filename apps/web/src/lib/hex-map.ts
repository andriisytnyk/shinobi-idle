import type { ContentDb } from '@shinobi/content';
import {
  AUTOSURVEY_KIND,
  autoPlan,
  evalReq,
  graduateReq,
  hexKey,
  hexInfo,
  listHexes,
  parseHexKey,
  rangeNow,
  travelPlan,
  type GameState,
  type HexInfo,
  type Rules,
  type TravelPlan,
} from '@shinobi/core';
import { t } from './i18n.ts';

/*
 * The map as numbers: where each hex of the playable land is drawn and what the player knows about
 * it. The geometry is ours: pointy-top hexes of `SIZE` units from centre to corner, axial
 * coordinates. Nothing here touches the DOM, so the tests can run it on its own.
 */

/** Distance from the centre of a hex to a corner, in map units. */
export const SIZE = 20;

const SQRT3 = Math.sqrt(3);

export interface Point {
  x: number;
  y: number;
}

/** The centre of the hex `(q, r)` in map units. */
export const hexCenter = (q: number, r: number): Point => ({
  x: SIZE * SQRT3 * (q + r / 2),
  y: SIZE * 1.5 * r,
});

const CORNERS: readonly Point[] = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: SIZE * Math.cos(angle), y: SIZE * Math.sin(angle) };
});

const fixed = (n: number): string => (Math.round(n * 100) / 100).toString();

/** The outline of a hex round the origin; the hex is placed with a transform. */
export const HEX_PATH = `M${CORNERS.map((c) => `${fixed(c.x)} ${fixed(c.y)}`).join('L')}Z`;

/** The six hexes next to `(q, r)`, in the order east, north-east, north-west, west, south-west, south-east. */
export const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * The hex a keyboard arrow leads to from `(q, r)`, among `exists`. Left and right keep the row;
 * up and down take the neighbour above or below that exists, the one `prefer` names (east or
 * west) first, so that both of the two can be reached by pressing the same arrow after a side step.
 */
export function stepByArrow(
  at: Point & { q: number; r: number },
  arrow: Arrow,
  exists: (q: number, r: number) => boolean,
  prefer: 'east' | 'west' = 'east',
): { q: number; r: number } | null {
  const pick = (options: readonly (readonly [number, number])[]) => {
    for (const [dq, dr] of options)
      if (exists(at.q + dq, at.r + dr)) return { q: at.q + dq, r: at.r + dr };
    return null;
  };
  if (arrow === 'ArrowRight') return pick([[1, 0]]);
  if (arrow === 'ArrowLeft') return pick([[-1, 0]]);
  const up: [number, number][] =
    prefer === 'east'
      ? [
          [1, -1],
          [0, -1],
        ]
      : [
          [0, -1],
          [1, -1],
        ];
  const down: [number, number][] =
    prefer === 'east'
      ? [
          [0, 1],
          [-1, 1],
        ]
      : [
          [-1, 1],
          [0, 1],
        ];
  return pick(arrow === 'ArrowUp' ? up : down);
}

/** The token of the colour a terrain is drawn in; the terrain names it, and a missing one falls back to ours. */
export const terrainClass = (terrain: string | null): string =>
  terrain ? `t-${terrain.replace(/[^a-z0-9_-]/gi, '')}` : 'fog';

/** What one hex of the map shows. */
export interface MapHex {
  /** The hex's coordinates as text: `"q,r"`. */
  coord: string;
  q: number;
  r: number;
  x: number;
  y: number;
  info: HexInfo;
  /** The terrain; null in fog. */
  terrain: string | null;
  /** Named places on the hex that have been revealed, with the mark each is drawn with. */
  places: { id: string; kind: string; role: string }[];
  /** Kinds of the points of interest the player has found on the hex. */
  pois: string[];
}

export interface MapView {
  hexes: MapHex[];
  /** The bounds of the playable land in map units. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  here: string | null;
  range: number;
}

/**
 * The playable hexes with what the player knows of each. The core view is read once per call (one
 * search for the whole map), and then only what the player may see is copied: the terrain, places
 * and points of fog hexes are not part of the view at all.
 */
export function mapView(state: GameState, content: ContentDb, rules: Rules): MapView {
  const placeOf = new Map<string, ContentDb['places']>();
  for (const place of content.places) {
    const key = hexKey(place.hex[0], place.hex[1]);
    const list = placeOf.get(key) ?? [];
    list.push(place);
    placeOf.set(key, list);
  }
  const cellOf = new Map(content.cells.map((c) => [c.id, c]));
  const hexes: MapHex[] = [];
  let here: string | null = null;
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const info of listHexes(state, content, rules)) {
    if (!info.playable) continue;
    const { x, y } = hexCenter(info.q, info.r);
    bounds.x0 = Math.min(bounds.x0, x - SIZE * SQRT3 * 0.5);
    bounds.x1 = Math.max(bounds.x1, x + SIZE * SQRT3 * 0.5);
    bounds.y0 = Math.min(bounds.y0, y - SIZE);
    bounds.y1 = Math.max(bounds.y1, y + SIZE);
    if (info.here) here = info.key;
    const cell = info.cell ? cellOf.get(info.cell) : undefined;
    hexes.push({
      coord: info.key,
      q: info.q,
      r: info.r,
      x,
      y,
      info,
      terrain: info.terrain,
      places: info.places.flatMap((id) => {
        const p = placeOf.get(info.key)?.find((pl) => pl.id === id);
        return p ? [{ id: p.id, kind: p.kind, role: p.role }] : [];
      }),
      pois:
        info.level >= 1 && cell
          ? cell.pois.filter((p) => state.world.pois[p.id]).map((p) => p.kind)
          : [],
    });
  }
  return { hexes, bounds, here, range: rangeNow(state, content) };
}

/** The route and its time to the hex at `coord`, as the map draws it. */
export function routeView(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  target: MapHex,
): TravelPlan {
  return travelPlan(state, target.info.address, content, rules);
}

/** The slot the auto-survey runs in (-1 when it does not run) and why it cannot start (a localization key). */
export const autoState = (
  state: GameState,
  content: ContentDb,
): { slot: number; why: string | null } => ({
  slot: state.slots.findIndex((s) => s.action?.kind === AUTOSURVEY_KIND),
  why: !evalReq(state, graduateReq(content), content).met
    ? 'error.surveyRank'
    : autoPlan(state, content) === null
      ? 'error.nothingToSurvey'
      : null,
});

/** The map unit position of a `"q,r"` key, or null. */
export function pointOf(coord: string): Point | null {
  const at = parseHexKey(coord);
  return at ? hexCenter(at.q, at.r) : null;
}

/** A pan and zoom: map unit `p` shows at `p * k + (x, y)` on the screen. */
export interface Camera {
  x: number;
  y: number;
  k: number;
}

export const ZOOM_MAX = 3.2;

/** The zoom at which the whole land fits a screen of `width` by `height`. */
export function fitZoom(bounds: MapView['bounds'], width: number, height: number): number {
  const w = bounds.x1 - bounds.x0;
  const h = bounds.y1 - bounds.y0;
  if (w <= 0 || h <= 0 || width <= 0 || height <= 0) return 1;
  return Math.min(width / w, height / h);
}

/** A camera that puts map point `p` at the screen point `(sx, sy)` with zoom `k`. */
export const cameraAt = (p: Point, sx: number, sy: number, k: number): Camera => ({
  x: sx - p.x * k,
  y: sy - p.y * k,
  k,
});

/**
 * Keeps the camera where some of the land is in view: the centre of the screen may not leave the
 * bounds of the land by more than a margin.
 */
export function clampCamera(
  c: Camera,
  bounds: MapView['bounds'],
  width: number,
  height: number,
  zoomMin: number,
): Camera {
  const k = Math.min(ZOOM_MAX, Math.max(zoomMin, c.k));
  const cx = (width / 2 - c.x) / c.k;
  const cy = (height / 2 - c.y) / c.k;
  const x = Math.min(bounds.x1, Math.max(bounds.x0, cx));
  const y = Math.min(bounds.y1, Math.max(bounds.y0, cy));
  return { x: width / 2 - x * k, y: height / 2 - y * k, k };
}

/** Zooms by `factor` about the screen point `(sx, sy)`. */
export function zoomAbout(c: Camera, factor: number, sx: number, sy: number): Camera {
  const k = c.k * factor;
  return { x: sx - ((sx - c.x) / c.k) * k, y: sy - ((sy - c.y) / c.k) * k, k };
}

/**
 * What a hex is called in a line about an action: the terrain once the hex is surveyed, else the
 * fog. The address of the auto-survey is empty. Names of places and cells are not used: a plain
 * hex has none, and a cell is linked as an entity.
 */
export function hexLabel(state: GameState, content: ContentDb, address: string): string {
  if (address === '') return t('map.auto.name');
  const info = hexInfo(state, address, content);
  return info?.terrain ? t(`terrain.${info.terrain}.name`) : t('map.hex.fog');
}
