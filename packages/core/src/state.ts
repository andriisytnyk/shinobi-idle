import type { ContentDb, NatureId, SkillId } from '@shinobi/content';
import type { CombatState } from './combat/types.ts';
import type { EntityRef } from './entity.ts';
import type { GameEvent } from './events.ts';
import { createStreams, type RngStreams } from './rng.ts';
import { updateQuests } from './quests.ts';
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
/** Progress through one quest chain. `step` counts finished steps; `base` is the counter value when the active step began. */
export interface QuestProgress {
  step: number;
  base: number;
  done: boolean;
}

/** What one practice has earned and the player has bought: unspent Insights and Enlightenments, and levels bought by modifier (`insight.0`, `enlight.2`). */
export interface MeditationEntry {
  insight: number;
  enlight: number;
  bought: Record<string, number>;
}

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
  /** Whole-number tallies kept by the systems: `kills.<enemy>`, `actions.<kind>`. Quest objectives read them. */
  counters: Record<string, number>;
  /** Quest chains that have started, by quest id. */
  quests: Record<string, QuestProgress>;
  /** The running fight, if a fight action holds a slot; plain JSON. */
  combat: CombatState | null;
  /** Running tonics by item id: the skill (or `allNatures`) they raise and the charges left. */
  buffs: Record<string, { skill: string; charges: number }>;
  /** Herb bushes as the player left them, by herb id: herbs left, size, and regrow work kept. */
  bushes: Record<string, { stock: number; size: number; carry: number }>;
  /** Training gear owned: tiers bought, by gear line id. */
  gear: Record<string, number>;
  /** Meditation: Insights and Enlightenments earned and the levels bought, by practice id. */
  meditation: Record<string, MeditationEntry>;
  /** The Athletics course: the obstacle built in each slot, by slot number. */
  course: Record<string, string>;
  /** The pinned goal shown in the meta panel. */
  goal: EntityRef | null;
  /** One-off notices for the UI, newest last. The UI drains it; it is never saved. */
  events: GameEvent[];
}

export const STATE_VERSION = 7;

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
    counters: {},
    quests: {},
    combat: null,
    buffs: {},
    gear: {},
    bushes: {},
    meditation: {},
    course: {},
    goal: null,
    events: [],
  };
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  return state;
}
