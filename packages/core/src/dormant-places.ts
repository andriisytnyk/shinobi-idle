import type { GameState } from './state.ts';

/*
 * Every place of the game state that holds an id of the content, and what a save does with such an
 * entry when the pack that owns the id is missing. This table is the one list the loader works from:
 * the dormant bucket of a pack is built from it and emptied into it, so nothing is remembered by hand.
 * `STATE_IDS` names every branch of `GameState`; adding a branch without an entry does not compile,
 * and a test checks that every entry of it agrees with `PLACES`.
 */

/** How the entries of a place are found and put back. */
export type PlaceRule =
  /** A map whose keys are ids (or hold one): the entry moves with its key. */
  | 'keys'
  /** A map whose values are ids (the built obstacles by slot): the entry moves when the id is the pack's; it comes back where the slot is free. */
  | 'values'
  /** A list of ids (the loadout): the ids move with their positions and come back where the list has room. */
  | 'list'
  /** One id or null (the signature technique). */
  | 'single'
  /** The loadouts saved by name: the pack's techniques are cut from each and come back to it. */
  | 'saved'
  /** The pouch: a slot with an item of the pack is emptied; the units come back to the slot if it is free, else to the bank. */
  | 'pouch'
  /** The pinned goal: cleared while the pack is away, restored if nothing else was pinned. */
  | 'goal';

export interface Place {
  /** Dotted path from the state; it also names the field of the dormant bucket. */
  path: string;
  rule: PlaceRule;
}

export const PLACES: readonly Place[] = [
  { path: 'skills', rule: 'keys' },
  { path: 'pools', rule: 'keys' },
  { path: 'mastery', rule: 'keys' },
  { path: 'bank', rule: 'keys' },
  { path: 'currencies', rule: 'keys' },
  { path: 'known', rule: 'keys' },
  { path: 'flags', rule: 'keys' },
  { path: 'counters', rule: 'keys' },
  { path: 'quests', rule: 'keys' },
  { path: 'gear', rule: 'keys' },
  { path: 'bushes', rule: 'keys' },
  { path: 'meditation', rule: 'keys' },
  { path: 'buffs', rule: 'keys' },
  { path: 'bingo', rule: 'keys' },
  { path: 'report', rule: 'keys' },
  { path: 'shown', rule: 'keys' },
  { path: 'course', rule: 'values' },
  { path: 'world.explores', rule: 'keys' },
  { path: 'world.pois', rule: 'keys' },
  { path: 'world.claimed', rule: 'keys' },
  { path: 'world.stock', rule: 'keys' },
  { path: 'village.levels', rule: 'keys' },
  { path: 'village.res', rule: 'keys' },
  { path: 'village.shinobi', rule: 'keys' },
  { path: 'village.raids', rule: 'keys' },
  { path: 'village.damage', rule: 'keys' },
  { path: 'missions.pending', rule: 'keys' },
  { path: 'loadouts.active', rule: 'list' },
  { path: 'loadouts.signature', rule: 'single' },
  { path: 'loadouts.cloneRole', rule: 'single' },
  { path: 'loadouts.saved', rule: 'saved' },
  { path: 'pouch', rule: 'pouch' },
  { path: 'goal', rule: 'goal' },
];

/** What the loader does with each branch of the state. */
export type StateIdRule =
  /** The whole branch is a place of `PLACES` (its path is the branch). */
  | 'place'
  /** Some of its sub-branches are places of `PLACES`. */
  | 'places'
  /** Handled by its own code in the loader: the rank and natures. */
  | 'player'
  /** Holds no id of the content. */
  | 'none'
  /** Holds ids but is rebuilt on load from the rest, never kept. */
  | 'recomputed'
  /** Holds ids but is dropped when its pack is missing and is not kept for it (a fight in progress, the action slots). */
  | 'dropped';

export const STATE_IDS: Record<keyof GameState, StateIdRule> = {
  v: 'none',
  packs: 'none',
  rankOrder: 'none',
  dormant: 'none',
  now: 'none',
  rng: 'none',
  player: 'player',
  skills: 'place',
  mastery: 'place',
  pools: 'place',
  bank: 'place',
  currencies: 'place',
  known: 'place',
  slots: 'dropped',
  flags: 'place',
  stats: 'none',
  counters: 'place',
  quests: 'place',
  combat: 'dropped',
  clones: 'dropped',
  fatigue: 'none',
  buffs: 'place',
  bushes: 'place',
  gear: 'place',
  meditation: 'place',
  course: 'place',
  team: 'recomputed',
  world: 'places',
  village: 'places',
  goal: 'place',
  loadouts: 'places',
  pouch: 'place',
  wounds: 'none',
  bingo: 'place',
  report: 'place',
  shown: 'place',
  missions: 'places',
  events: 'none',
};

/** The top-level branch a place lives in. */
export const branchOf = (path: string): string => path.split('.')[0] ?? path;
