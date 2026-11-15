import type { SkillId } from '@shinobi/content';
import type { JsonValue } from '../state.ts';

/**
 * A timed effect on one combatant (burn, stun, a tool's bonus and so on). Stage 3 adds the kinds;
 * for now the lists stay empty. An effect names the moment it ends so it needs no per-tick upkeep,
 * and the combat system will fold `until` into its next-event time.
 */
export interface CombatEffect {
  kind: string;
  /** Combat clock time at which the effect ends. */
  until: number;
  data: JsonValue;
}

/** Where the player is in the technique lifecycle: free, casting, or recovering from a swing. */
export type PlayerPhase = 'ready' | 'cast' | 'recover';

/**
 * The running fight, as plain JSON. Combat has its own clock in work units (ms x the fight slot's
 * share, like action progress) and every deadline below is a time on that clock, so combat of any
 * speed share is exact in whole numbers and any chunking of `advance` gives identical saves.
 */
export interface CombatState {
  /** Content id of the enemy being fought. */
  enemy: string;
  /** `fight`: an enemy is alive. `respawn`: the pause before the next one appears. */
  phase: 'fight' | 'respawn';
  /** Combat time in work units; advances by the slot share per ms. */
  clock: number;
  enemyHp: number;
  hp: number;
  chakra: number;
  stamina: number;
  pPhase: PlayerPhase;
  /** When the player's current phase ends (cast resolves, recovery ends). */
  pAt: number;
  /** Technique being cast, if `pPhase` is `cast`. */
  cast: string | null;
  /** When the enemy next attacks. */
  eAt: number;
  /** When the next enemy appears, during `respawn`. */
  respawnAt: number;
  /** When pools next regenerate (once per second of game time). */
  regenAt: number;
  /** Cooldown end per technique id; absent or in the past means ready. */
  cd: Record<string, number>;
  /** Skill that earns combat style XP: that of the technique last used; basic attacks are Taijutsu. */
  style: SkillId;
  /** Clock time of the player's previous technique use, or the fight's start. */
  lastActionAt: number;
  fx: { player: CombatEffect[]; enemy: CombatEffect[] };
}
