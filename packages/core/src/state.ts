import type { ContentDb, NatureId, SkillId } from '@shinobi/content';
import type { GameEvent } from './events.ts';
import { createStreams, type RngStreams } from './rng.ts';
import { refreshUnlocks } from './unlocks.ts';

export type Rank = 'student' | 'genin' | 'chunin';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A slot at full speed. Shares are whole thousandths so all time maths stays exact. */
export const SHARE_FULL = 1000;

export interface ActionSlot {
  action: { kind: string; id: string } | null;
  /** Work done on the current cycle, in ms x SHARE_FULL units (a whole number). */
  progress: number;
  /** Speed of this slot in thousandths of full speed (whole number, 0..SHARE_FULL). */
  share: number;
  /** State private to the running action kind; plain JSON, saved with the slot. */
  data: JsonValue;
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
  stats: { /** Action cycles completed over the whole game. */ completed: number };
  /** One-off notices for the UI, newest last. The UI drains it; it is never saved. */
  events: GameEvent[];
}

export const STATE_VERSION = 3;

/** A fresh game: every skill at 0 xp, one empty action slot, streams seeded from `seed`. */
export function createState(seed: number, content: ContentDb): GameState {
  const skills = {} as Record<SkillId, { xp: number }>;
  const pools = {} as Record<SkillId, { xp: number }>;
  for (const skill of content.skills) {
    skills[skill.id] = { xp: 0 };
    pools[skill.id] = { xp: 0 };
  }
  const state: GameState = {
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
    slots: [{ action: null, progress: 0, share: SHARE_FULL, data: null }],
    flags: {},
    stats: { completed: 0 },
    events: [],
  };
  refreshUnlocks(state, content, true);
  return state;
}
