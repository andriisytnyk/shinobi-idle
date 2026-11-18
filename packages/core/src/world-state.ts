import type { ContentDb } from '@shinobi/content';
import { hexKey, hexesWithin, isPlayable } from './hex.ts';
import { indexOf } from './lookup.ts';

/**
 * Exploration state; plain JSON. A hex is named by an address: the id of the cell on it, or its key
 * `"q,r"` when no cell stands there. Keys of `explores` are addresses; `surveyed` holds hex keys;
 * `pois` and `claimed` hold point-of-interest ids. Per-hex facts that a later rule needs (a
 * restock timer, say) belong in a new optional record beside these, read as empty when absent, so
 * that adding one never needs a migration of the rest.
 */
export interface WorldState {
  /**
   * The address of the hex the character (the performer of action slot 0) stands on; it starts at
   * the first cell of the first region.
   */
  location: string;
  /**
   * The positions of the other performers, by the index of their action slot (1 and up): a figure
   * on the map for each shadow clone, put where the character stood when it was made. Read as empty
   * when absent; a slot with no entry stands where the character stands. Slot 0 is `location`.
   */
  figures?: Record<number, string>;
  /** How many times each hex was surveyed. A cell's level follows from this count (`K.cellExplores`), any other hex's from `K.map.plainSurvey`. */
  explores: Record<string, number>;
  /**
   * Keys of the hexes that are surveyed: the player can walk on them. A hex is surveyed once it
   * reaches its first level, and the starting area (and the hexes a migrated save proves) are marked
   * without the levels, so a cell there still has to be explored for what it holds. Fog otherwise.
   */
  surveyed: Record<string, true>;
  /**
   * Points of interest found: the ids of the cells' points and the ids of the places that are
   * points of interest (`Place.point`; the flag `point.<place id>` is raised with them).
   */
  pois: Record<string, true>;
  /** Caches and vaults already emptied. */
  claimed: Record<string, true>;
  /**
   * The rare finds of the places (`Place.rare`) that were drawn on, by place id: the drops left when
   * `at` was set, and the game time from which the next one is restocked. A place with no entry
   * holds its whole stock. Optional, read as empty when absent.
   */
  stock?: Record<string, { left: number; at: number }>;
}

/**
 * Marks hexes as surveyed. A hex that is no cell also gets the surveys of its first level, so that
 * it reads as surveyed to level 1 whatever way it was marked; a cell keeps its own count (its
 * level is what finds its points of interest and pays Intel).
 */
export function seedSurvey(world: WorldState, content: ContentDb, keys: Iterable<string>): void {
  const index = indexOf(content);
  const first = content.balance.K.map.plainSurvey[0] ?? 0;
  for (const key of keys) {
    const hex = index.hexes.get(key);
    if (!isPlayable(hex)) continue;
    world.surveyed[key] = true;
    if (!index.cellByHex.has(key) && (world.explores[key] ?? 0) < first)
      world.explores[key] = first;
  }
}

/** The world of a new game: standing in the first cell, with the hexes round it surveyed. */
export function createWorld(content: ContentDb): WorldState {
  const first = content.cells[0];
  const world: WorldState = {
    location: content.regions[0]?.cells[0] ?? first?.id ?? '',
    explores: {},
    surveyed: {},
    pois: {},
    claimed: {},
  };
  const start = indexOf(content).cells.get(world.location);
  // The points on the hex of the start are known from the first day, without a reward: the new
  // character knows the gate he leaves by. Only plain points (no `revealedBy`, no `needs`).
  if (start) {
    for (const place of indexOf(content).placesByHex.get(hexKey(start.hex[0], start.hex[1])) ?? [])
      if (place.point && !place.point.revealedBy && !place.point.needs) world.pois[place.id] = true;
  }
  if (start) {
    const around = hexesWithin(
      { q: start.hex[0], r: start.hex[1] },
      content.balance.K.map.startRadius,
    );
    seedSurvey(
      world,
      content,
      around.map((a) => hexKey(a.q, a.r)),
    );
  }
  return world;
}
