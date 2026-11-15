import type { SkillId } from '@shinobi/content';
import type { FightState } from './fight-types.ts';

/** An operation run in progress: which operation and which step of it the fight belongs to. */
export interface RunState {
  /** Content id of the operation. */
  op: string;
  /** Index of the step under way in the operation's flattened step list. */
  step: number;
}

/**
 * The running fight as the game keeps it, plain JSON. The fight itself is a self-contained
 * `FightState` with its own clock; this wraps it with what the game needs around it: the work
 * the slot has fed in, the pause between enemies, and what has already been paid out.
 */
export interface CombatState {
  /** Content id of the enemy or boss being fought (or fought next, during `respawn`). */
  enemy: string;
  /**
   * `fight`: the fight runs. `respawn`: the pause before the next enemy appears. `approach`: the
   * first stage of an operation, a pause before its first fight, which is already prepared.
   */
  phase: 'fight' | 'respawn' | 'approach';
  /**
   * The current fight, or the one just won while `phase` is `respawn`; the player's pools there
   * are the ones carried into the next fight.
   */
  fight: FightState;
  /** Work units (ms x share) received since the fight or the pause was last advanced. */
  work: number;
  /** Work units left of the pause between enemies, during `respawn` and `approach`. */
  pause: number;
  /** Mastery work of this fight, per technique, that has already been paid out. */
  paid: Record<string, number>;
  /**
   * Work units since the last technique use that earlier fights and pauses left unpaid; the next
   * technique use is paid for them, so mastery follows combat time across enemies.
   */
  carry: number;
  /** Skill that earns combat style XP: that of the technique last used; basic attacks are Taijutsu. */
  style: SkillId;
  /** The operation run this fight belongs to; null for a zone fight. */
  run: RunState | null;
}

/** The player's loadout: the techniques taken into a fight, and the ones saved under a name. */
export interface LoadoutState {
  /** Technique ids in the slots; outside the slots only the techniques marked out-of-loadout are used. */
  active: string[];
  /** Whether the loadout is rebuilt on its own whenever the player learns a technique. */
  auto: boolean;
  /** The signature technique (a slot of the active loadout), or null. */
  signature: string | null;
  /** What the automatic loadout was last built from (rank and number of known techniques). */
  basis: string;
  saved: Record<string, { techniques: string[]; signature: string | null }>;
}

/** The pouch: a stack of one item per slot (an empty slot has an empty id), and the slot the medic pouch uses. */
export interface PouchState {
  slots: { id: string; n: number }[];
  medic: number | null;
}

/** Wound stacks and the time left before the current one heals, in ms. */
export interface WoundState {
  stacks: number;
  left: number;
}
