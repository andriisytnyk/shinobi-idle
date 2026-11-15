import type { ContentDb } from '@shinobi/content';
import type { GameState } from './state.ts';

/** What one build costs or has cost: civil resources by id, shinobi resources by id, and treasury ryo. */
export interface VillageCost {
  res: Record<string, number>;
  shinobi: Record<string, number>;
  ryo: number;
}

/** The one construction job: which building, ticks left and in all, and what was paid (so a cancel can refund it). */
export interface VillageJob {
  building: string;
  ticks: number;
  total: number;
  paid: VillageCost;
}

/** The player's district; plain JSON. Exists from the moment the player becomes Genin. */
export interface VillageState {
  /** Building level by building id (0 when absent). */
  levels: Record<string, number>;
  /** Civil resources by resource id. */
  res: Record<string, number>;
  /** Capped shinobi resources by resource id. */
  shinobi: Record<string, number>;
  /** Workforce charges; each removes one tick from the construction job. */
  workforce: number;
  /** Shinobi Power: uncapped, pays treasury ryo per tick. */
  power: number;
  treasury: number;
  job: VillageJob | null;
  /** The stage, counted from 1 in the order of `content.villageStages`. */
  stage: number;
  /** Game time into the current village tick, in whole ms. */
  clock: number;
}

/** The village of a new Genin: starting levels from the balance, empty stores. */
export function createVillage(content: ContentDb): VillageState {
  const res: Record<string, number> = {};
  const shinobi: Record<string, number> = {};
  for (const r of content.resources) {
    if (r.kind === 'civil') res[r.id] = 0;
    else if (r.kind === 'shinobi') shinobi[r.id] = 0;
  }
  const levels: Record<string, number> = {};
  for (const b of content.buildings) {
    const start = content.balance.K.village.start[b.id] ?? 0;
    if (start > 0) levels[b.id] = start;
  }
  return {
    levels,
    res,
    shinobi,
    workforce: 0,
    power: 0,
    treasury: 0,
    job: null,
    stage: 1,
    clock: 0,
  };
}

/** The level of a building; 0 when it is not built or there is no village yet. */
export const buildingLevel = (state: Pick<GameState, 'village'>, id: string): number =>
  state.village?.levels[id] ?? 0;
