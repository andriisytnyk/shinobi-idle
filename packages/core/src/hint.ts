import type { ContentDb } from '@shinobi/content';
import {
  addressOf,
  hexKey,
  hexesWithin,
  isSurveyed,
  neighbours,
  parseHexKey,
  type Axial,
} from './hex.ts';
import { indexOf } from './lookup.ts';
import type { GameState } from './state.ts';
import { regionOfHex, subjectOf } from './world.ts';

/*
 * Where to look: for a thing a requirement or a step asks to find, the region and a search area on
 * the map. Pure: the area depends on the ids and the data knob `K.map.hintRadius`, and the state is
 * read only to know whether the place is already surveyed (then the hint is the exact hex).
 */

/** What a hint can be asked for; a kind that has no place on the map gets no hint. */
export type HintKind = 'enemy' | 'zone' | 'poi' | 'cell' | 'place';

export interface HintTarget {
  kind: HintKind;
  id: string;
}

export interface LocationHint {
  target: HintTarget;
  /** Every place the target stands in is surveyed: the area is those exact hexes. */
  exact: boolean;
  /** The regions of the places, without repeats, in the order of the places. */
  regions: string[];
  /** The cells the target stands in, in content order; a place that is no cell has none. */
  cells: string[];
  /** The hexes to highlight (keys `q,r`), without repeats: the search area, or the exact hexes. */
  hexes: string[];
}

/** A small stable hash of a text (FNV-1a), so the same ids always pick the same neighbour. */
function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

interface Anchor {
  key: string;
  at: Axial;
  cell: string | null;
  region: string;
}

function anchorAt(content: ContentDb, key: string): Anchor | null {
  const at = parseHexKey(key);
  if (!at) return null;
  const subject = subjectOf(content, addressOf(content, at));
  const region = subject ? regionOfHex(content, subject) : null;
  return subject && region !== null ? { key, at, cell: subject.cell?.id ?? null, region } : null;
}

/** The places a target stands in, in a fixed order. */
function anchorsOf(content: ContentDb, target: HintTarget): Anchor[] {
  const index = indexOf(content);
  const keys: string[] = [];
  const addCell = (cell: { hex: readonly number[] } | undefined): void => {
    if (cell) keys.push(hexKey(cell.hex[0] ?? 0, cell.hex[1] ?? 0));
  };
  switch (target.kind) {
    case 'enemy':
      for (const zone of content.zones) {
        if (zone.enemy === target.id) addCell(index.zoneCell.get(zone.id));
      }
      break;
    case 'zone':
      addCell(index.zoneCell.get(target.id));
      break;
    case 'poi':
      addCell(index.pois.get(target.id)?.cell);
      break;
    case 'cell':
      addCell(index.cells.get(target.id));
      break;
    case 'place':
      addCell(index.places.get(target.id));
      break;
  }
  const seen = new Set<string>();
  const out: Anchor[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const anchor = anchorAt(content, key);
    if (anchor) out.push(anchor);
  }
  return out;
}

/** The search area around one place: the hexes within `radius` of a neighbour of the place, picked by the ids. */
function searchArea(content: ContentDb, anchor: Anchor, seed: string, radius: number): string[] {
  const near = neighbours(anchor.at);
  const first = hashOf(`${seed}|${anchor.key}`) % near.length;
  let centre = anchor.at;
  for (let i = 0; i < near.length; i++) {
    const cand = near[(first + i) % near.length];
    const subject = cand ? subjectOf(content, addressOf(content, cand)) : null;
    if (cand && subject && regionOfHex(content, subject) === anchor.region) {
      centre = cand;
      break;
    }
  }
  const all: { key: string; region: string | null }[] = [];
  for (const hex of hexesWithin(centre, radius)) {
    const subject = subjectOf(content, addressOf(content, hex));
    if (subject) all.push({ key: hexKey(hex.q, hex.r), region: regionOfHex(content, subject) });
  }
  const inRegion = all.filter((h) => h.region === anchor.region);
  // A clip that leaves too few hexes is dropped: a tiny area would give the target away.
  return (inRegion.length >= content.balance.K.map.hintMin ? inRegion : all).map((h) => h.key);
}

/**
 * Where to look for a target: its region and a search area on the map. The area is the playable hexes
 * within `K.map.hintRadius` of a centre that is a neighbour of the target (picked from the ids, so the
 * target is inside but is not the middle), clipped to the target's region while that leaves at
 * least `K.map.hintMin` hexes. Radius 0, or a place already surveyed, gives the exact hex. Null for a target with no place.
 */
export function locationHint(
  state: GameState,
  content: ContentDb,
  target: HintTarget,
): LocationHint | null {
  const anchors = anchorsOf(content, target);
  if (anchors.length === 0) return null;
  const radius = content.balance.K.map.hintRadius;
  const hexes: string[] = [];
  const regions: string[] = [];
  const cells: string[] = [];
  let exact = true;
  for (const anchor of anchors) {
    if (!regions.includes(anchor.region)) regions.push(anchor.region);
    if (anchor.cell !== null) cells.push(anchor.cell);
    const found = radius === 0 || isSurveyed(state, content, anchor.key);
    if (!found) exact = false;
    for (const key of found ? [anchor.key] : searchArea(content, anchor, target.id, radius)) {
      if (!hexes.includes(key)) hexes.push(key);
    }
  }
  return { target, exact, regions, cells, hexes };
}
