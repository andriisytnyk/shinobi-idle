import type { SkillId } from '@shinobi/content';
import type { FightState } from './fight-types.ts';

/**
 * The running fight as the game keeps it, plain JSON. The fight itself is a self-contained
 * `FightState` with its own clock; this wraps it with what the game needs around it: the work
 * the slot has fed in, the pause between enemies, and what has already been paid out.
 */
export interface CombatState {
  /** Content id of the enemy being fought. */
  enemy: string;
  /** `fight`: the fight runs. `respawn`: the pause before the next enemy appears. */
  phase: 'fight' | 'respawn';
  /**
   * The current fight, or the one just won while `phase` is `respawn`; the player's pools there
   * are the ones carried into the next fight.
   */
  fight: FightState;
  /** Work units (ms x share) received since the fight or the pause was last advanced. */
  work: number;
  /** Work units left of the pause between enemies, during `respawn`. */
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
}
