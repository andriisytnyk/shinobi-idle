import type { ContentDb, NatureId, SkillId } from '@shinobi/content';
import type { BingoEntry } from './combat/bingo.ts';
import type { TargetReport } from './combat/report.ts';
import type { CombatState, LoadoutState, PouchState, WoundState } from './combat/types.ts';
import type { EntityRef } from './entity.ts';
import type { GameEvent } from './events.ts';
import { createStreams, type RngStreams } from './rng.ts';
import type { TeamNatures } from './natures.ts';
import { updateQuests } from './quests.ts';
import type { VillageState } from './village-state.ts';
import { ensurePouch } from './combat/pouch.ts';
import { createWorld, type WorldState } from './world-state.ts';
import { refreshUnlocks } from './unlocks.ts';

/** A player rank id; the ranks and their order come from `content.playerRanks`. */
export type Rank = string;

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

/** A content pack that the game was played with: its id and the version of its manifest. */
export interface PackRef {
  id: string;
  version: string;
  /** Game time at which the pack was attached (a pack added to a save starts here); systems of the pack count from it. */
  since: number;
}

/**
 * What the save keeps for a pack that the content no longer has (see `save.ts`): its data by
 * field of the state and by key, the rank and the natures the player had from it. Adding the pack
 * back restores them; the loader never reads them otherwise.
 */
export interface DormantPack {
  /** The version of the pack when it left. */
  version: string;
  /** The rank id the player held when it belongs to the pack, else null. */
  rank: string | null;
  /** The natures the player owned, in order, when any belonged to the pack; else empty. */
  natures: string[];
  /** The pack's entries of the keyed branches of the state: field name, then key, then value. */
  data: Record<string, Record<string, JsonValue>>;
}

/**
 * A shadow clone: a performer of its own. It lives on chakra (`life`), carries its own bag and purse (it has no
 * access to the Bank), keeps the XP and Mastery its actions earn until it is dispelled, and holds the fight it
 * fights. Everything it holds goes to the character when it is dispelled.
 */
export interface CloneBody {
  /** Chakra left as parts of `LIFE_FULL`: a whole number, so that time maths stays exact. 0 dispels the clone. */
  life: number;
  /** The clone's chakra pool when it was made (the character's pool divided by the number of performers), for the bar. */
  max: number;
  /** Game time the clone was made. */
  born: number;
  /** Items taken from the Bank at creation and everything the clone gets since; goes back to the Bank on dispel. */
  bag: Record<string, number>;
  /** Currencies the clone earned, by currency id (every currency of the content has an entry). */
  purse: Record<string, number>;
  /** The clone's own pouch of tools and pills, filled from its bag. */
  pouch: PouchState;
  /** Skill XP the clone's actions earned (modifiers already applied), by skill; the character gets it when the clone is dispelled. */
  xp: Record<string, number>;
  /** Mastery the clone earned, by mastery key: the amount (modifiers applied), the skill it trains and the pool share. */
  mastery: Record<string, { skill: string; amount: number; pool: number }>;
  /** Insights and Enlightenments the clone's meditation earned, by practice; the character gets them when the clone is dispelled. */
  insight?: Record<string, { insight: number; enlight: number }>;
  /** The fight the clone fights, if its action holds one (the character's is `GameState.combat`). */
  fight: CombatState | null;
  /** Set when the clone is to be dispelled at the end of this moment (it fell in a fight). */
  doomed?: 'death';
}

/** One whole life of a clone, in the units `CloneBody.life` is kept in. */
export const LIFE_FULL = 1_000_000_000;

export interface GameState {
  /** Save format version. */
  v: number;
  /** The packs the state was made with, in load order. Written on create and on every load. */
  packs: PackRef[];
  /** The order of the player ranks when the state was made: a rank a later content lacks falls back along it. */
  rankOrder: string[];
  /** Data of packs that are missing now, by pack id. */
  dormant: Record<string, DormantPack>;
  /** Game time in whole milliseconds. */
  now: number;
  rng: RngStreams;
  player: { name: string; rank: Rank; natures: NatureId[] };
  skills: Record<SkillId, { xp: number }>;
  /** Keyed by mastery id. */
  mastery: Record<string, { xp: number }>;
  pools: Record<SkillId, { xp: number }>;
  bank: Record<string, number>;
  /**
   * Balances by currency id; every currency of the content has an entry. The three currencies of
   * the built-in pack are named in the type only so that the fight code, which still reads them by
   * name, compiles; the pack `core` is always present, so they are always there.
   */
  currencies: Record<string, number>;
  /** Unlocked techniques, recipes and so on. */
  known: Record<string, true>;
  slots: ActionSlot[];
  flags: Record<string, true | number>;
  stats: { /** Action cycles completed over the whole game. */ completed: number };
  /** Whole-number tallies kept by the systems: `kills.<enemy>`, `actions.<kind>`. Quest objectives read them. */
  counters: Record<string, number>;
  /** Quest chains that have started, by quest id. */
  quests: Record<string, QuestProgress>;
  /** The character's running fight (slot 0), if a fight action holds the slot; plain JSON. A clone's fight is `clones[slot].fight`. */
  combat: CombatState | null;
  /** The shadow clones that exist, by the slot they work in. */
  clones: Record<string, CloneBody>;
  /** Mind fatigue left, in thousandths of ms (see `clone-life.ts`); while it lasts no clone can be made and the character is slower. */
  fatigue: number;
  /** Running tonics by item id: the skill (or `allNatures`) they raise and the charges left. */
  buffs: Record<string, { skill: string; charges: number }>;
  /** Herb bushes by herb id: herbs left, size, and the game time of the regrow clock (see `Bush` in field.ts). */
  bushes: Record<string, { stock: number; size: number; at: number }>;
  /** Training gear owned: tiers bought, by gear line id. */
  gear: Record<string, number>;
  /** Meditation: Insights and Enlightenments earned and the levels bought, by practice id. */
  meditation: Record<string, MeditationEntry>;
  /** The Athletics course: the obstacle built in each slot, by slot number. */
  course: Record<string, string>;
  /** The rival's and Aya's natures, fixed when the native nature is chosen; null before. */
  team: TeamNatures | null;
  /** Exploration: where the player stands, how often each cell was explored, the points found and the loot taken. */
  world: WorldState;
  /** The player's district: buildings, resources, treasury, construction. Null until the player is a Genin. */
  village: VillageState | null;
  /** The goals the player pinned for the meta panel, in pin order (at most `GOAL_CAP`). */
  goals: EntityRef[];
  /** The techniques taken into a fight, the signature and the saved loadouts. */
  loadouts: LoadoutState;
  /** The pouch of tools and pills, and the slot the medic pouch uses on its own. */
  pouch: PouchState;
  /** Wound stacks and the time left on the current one. */
  wounds: WoundState;
  /** The Bingo book: sightings, wins and losses per enemy or boss id; the knowledge level is computed from it. */
  bingo: Record<string, BingoEntry>;
  /** Battle reports by target (zone, enemy or operation id): what the fights against it added up to. */
  report: Record<string, TargetReport>;
  /** Entities the interface showed legitimately and `reveal.mark` recorded, by id (the reveal rule's `seen` term). Written only through `addShown` (shown.ts): by that command and when an item is gained. Keys are `<id>@<kind>`. */
  shown: Record<string, true>;
  /** Missions: village resource units earned that no village has taken yet, by resource slug (the village stage consumes them). */
  missions: { pending: Record<string, number> };
  /** One-off notices for the UI, newest last. The UI drains it; it is never saved. */
  events: GameEvent[];
}

export const STATE_VERSION = 23;

/** A fresh game: every skill at 0 xp, one empty action slot, streams seeded from `seed`. */
export function createState(seed: number, content: ContentDb): GameState {
  const skills: Record<string, { xp: number }> = {};
  const pools: Record<string, { xp: number }> = {};
  for (const skill of content.skills) {
    skills[skill.id] = { xp: 0 };
    pools[skill.id] = { xp: 0 };
  }
  const currencies: Record<string, number> = {};
  for (const currency of content.currencies) currencies[currency.id] = 0;
  const state: GameState = {
    v: STATE_VERSION,
    packs: content.packs.map((p) => ({ id: p.id, version: p.version, since: 0 })),
    rankOrder: content.playerRanks.map((r) => r.id),
    dormant: {},
    now: 0,
    rng: createStreams(seed),
    player: { name: '', rank: content.playerRanks[0]?.id ?? '', natures: [] },
    skills,
    mastery: {},
    pools,
    bank: {},
    currencies,
    known: {},
    slots: [{ action: null, progress: 0, share: SHARE_FULL, data: null }],
    flags: {},
    stats: { completed: 0 },
    counters: {},
    quests: {},
    combat: null,
    clones: {},
    fatigue: 0,
    buffs: {},
    gear: {},
    bushes: {},
    loadouts: { active: [], auto: true, signature: null, basis: '', cloneRole: null, saved: {} },
    pouch: { slots: [], medic: null },
    wounds: { stacks: 0, left: 0 },
    bingo: {},
    report: {},
    shown: {},
    meditation: {},
    course: {},
    team: null,
    world: createWorld(content),
    village: null,
    goals: [],
    missions: { pending: {} },
    events: [],
  };
  ensurePouch(state, content);
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  return state;
}
