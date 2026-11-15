import type { ContentDb } from '@shinobi/content';

/** Exploration state; plain JSON. Keys are cell ids and point-of-interest ids. */
export interface WorldState {
  /** The cell the player stands in; it starts at the first cell of the first region. */
  location: string;
  /** How many times each cell was explored. A cell's level follows from this count. */
  explores: Record<string, number>;
  /** Points of interest found. */
  pois: Record<string, true>;
  /** Caches and vaults already emptied. */
  claimed: Record<string, true>;
}

/** The world of a new game. */
export function createWorld(content: ContentDb): WorldState {
  const first = content.regions[0]?.cells[0] ?? '';
  return { location: first, explores: {}, pois: {}, claimed: {} };
}
