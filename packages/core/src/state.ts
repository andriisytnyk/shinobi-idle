import type { ContentDb, NatureId, SkillId } from '@shinobi/content';
import { createStreams, type RngStreams } from './rng.ts';

export type Rank = 'student' | 'genin' | 'chunin';

export interface ActionSlot {
  action: { kind: string; id: string } | null;
  progress: number;
  /** Share of the player's speed this slot gets. */
  share: number;
}

/**
 * The whole game, as plain JSON: no classes, Map, Set or functions.
 * Mutated only inside `advance` and `dispatch`. Later stages add branches and bump `v`.
 */
export interface GameState {
  /** Save format version. */
  v: number;
  /** Game time in whole milliseconds. */
  now: number;
  rng: RngStreams;
  player: { name: string; rank: Rank; natures: NatureId[] };
  skills: Record<SkillId, { xp: number }>;
  /** Keyed by mastery id. */
  mastery: Record<string, { xp: number }>;
  pools: Record<SkillId, { xp: number }>;
  bank: Record<string, number>;
  currencies: { ryo: number; rep: number; intel: number };
  /** Unlocked techniques, recipes and so on. */
  known: Record<string, true>;
  slots: ActionSlot[];
  flags: Record<string, true | number>;
}

export const STATE_VERSION = 1;

/** A fresh game: every skill at 0 xp, one empty action slot, streams seeded from `seed`. */
export function createState(seed: number, content: ContentDb): GameState {
  const skills = {} as Record<SkillId, { xp: number }>;
  const pools = {} as Record<SkillId, { xp: number }>;
  for (const skill of content.skills) {
    skills[skill.id] = { xp: 0 };
    pools[skill.id] = { xp: 0 };
  }
  return {
    v: STATE_VERSION,
    now: 0,
    rng: createStreams(seed),
    player: { name: '', rank: 'student', natures: [] },
    skills,
    mastery: {},
    pools,
    bank: {},
    currencies: { ryo: 0, rep: 0, intel: 0 },
    known: {},
    slots: [{ action: null, progress: 0, share: 1 }],
    flags: {},
  };
}
