/**
 * The named slots of the interface: the public contract of UI packs. Each slot passes its widgets
 * a context describing where it sits. Adding a slot is a compatible change; renaming one is not.
 */

/** A reference to an entity of the game: its kind and content id. */
export interface RefCtx {
  kind: string;
  id: string;
}

export interface SlotContexts {
  /** Under the plate of a skill page. */
  'skill.header': { skill: string };
  /** At the foot of a skill page, after the actions and the pool bar. */
  'skill.footer': { skill: string };
  /** Inside the tile of one action (technique, herb, recipe). */
  'action.tile': { action: RefCtx };
  /** In the «Зараз» bar, once per running slot. */
  'now.bar': { slot: number };
  /** In the goal panel («Мета»). */
  'goal.panel': Record<string, never>;
  /** After every entity page, the generic one included. */
  'entity.sections': { ref: RefCtx };
  /** Under the row of one skill in the sidebar. */
  'sidebar.skill': { skill: string };
  /** In the top bar. */
  topbar: Record<string, never>;
  /** At the end of the settings page. */
  settings: Record<string, never>;
  /** At the top of the village page. */
  'village.header': Record<string, never>;
  /** At the top of the mission board. */
  'missions.header': Record<string, never>;
  /** Under the title of a mission page; `mission` is the mission's id. */
  'mission.header': { mission: string };
  /** At the end of a mission page. */
  'mission.footer': { mission: string };
  /** At the end of every page; `route` is the location hash. */
  'page.footer': { route: string };
  /** Under the arena of a running fight; `target` is what the fight is of (a zone or an operation), null for a mission's fight. */
  'fight.arena': { target: PrepTargetRef | null };
  /** Under the verdict of the preparation screen. `hand` is the hand now, `suggested` the one the game would suggest. */
  'prep.verdict': PrepCtx;
  /** At the foot of the preparation screen, after the pouch. */
  'prep.footer': PrepCtx;
  /** Inside the Bingo book entry of an enemy or boss the player has met; `level` is how well it is known (1 to 3). */
  'bingo.entry': { enemy: string; level: number };
}

/** A fight target: a zone (its id) or an operation. */
export interface PrepTargetRef {
  kind: 'zone' | 'operation';
  id: string;
}

/** What the slots of the preparation screen know of it. */
export interface PrepCtx {
  target: PrepTargetRef;
  /** How well the target is known (the least known of its enemies): 0 to 3. */
  level: number;
  /** The techniques of the hand now and of the suggested hand. */
  hand: readonly string[];
  suggested: readonly string[];
}

export type SlotName = keyof SlotContexts;
export type SlotContext<N extends SlotName = SlotName> = SlotContexts[N];

const SLOT_TABLE: Record<SlotName, true> = {
  'skill.header': true,
  'skill.footer': true,
  'action.tile': true,
  'now.bar': true,
  'goal.panel': true,
  'entity.sections': true,
  'sidebar.skill': true,
  topbar: true,
  settings: true,
  'village.header': true,
  'missions.header': true,
  'mission.header': true,
  'mission.footer': true,
  'page.footer': true,
  'fight.arena': true,
  'prep.verdict': true,
  'prep.footer': true,
  'bingo.entry': true,
};

/** Every slot name, in the order they appear on screen. */
export const SLOT_NAMES = Object.keys(SLOT_TABLE) as readonly SlotName[];

export const isSlotName = (name: string): name is SlotName => Object.hasOwn(SLOT_TABLE, name);
