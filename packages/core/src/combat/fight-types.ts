import type {
  ComboId,
  NatureId,
  Rank,
  RoleId,
  SkillId,
  StateId,
  TagId,
  TraitId,
} from '@shinobi/content';
import type { RngState } from '../rng.ts';

/** Stats an effect can change. Multipliers combine by product, additions as `1 + sum`. */
export type ModStat = 'accuracy' | 'evasion' | 'speed' | 'damageTaken';

interface EffectBase {
  /** One effect per id on a combatant: applying it again refreshes it, it never stacks. */
  id: string;
  /** What put it there: a technique id or `trait:<id>`; damage it deals is credited to this. */
  src: string;
  /** Fight clock time at which it ends; null for an effect that lasts the whole fight. */
  until: number | null;
  /** Id of another effect that does nothing while this one is active. */
  suppresses?: string;
}

/** Changes a stat of its holder for a duration. */
export interface ModifierEffect extends EffectBase {
  kind: 'modifier';
  stat: ModStat;
  op: 'mul' | 'add';
  value: number;
}

/** Hurts or heals its holder `amount` every `every` work units until it ends. */
export interface PeriodicEffect extends EffectBase {
  kind: 'periodic';
  mode: 'damage' | 'heal';
  amount: number;
  every: number;
  /** Fight clock time of the next tick. */
  next: number;
}

export type Effect = ModifierEffect | PeriodicEffect;

/** A timer that fills by `work x speed`; it is done when `progress` reaches `need`. */
export interface Timer {
  progress: number;
  need: number;
}

/** What an enemy's heavy attack is doing: waiting for its turn or winding up the cast. */
export interface HeavyTimer extends Timer {
  phase: 'wait' | 'cast';
}

/** One fighter. The player and every enemy have this shape. */
export interface Combatant {
  id: string;
  side: 'player' | 'enemy';
  hp: number;
  maxHp: number;
  chakra: number;
  maxChakra: number;
  stamina: number;
  maxStamina: number;
  /** Basic attack and defence numbers: accuracy, evasion, damage, and ms between attacks. */
  accuracy: number;
  evasion: number;
  damage: number;
  intervalMs: number;
  nature: NatureId | null;
  traits: TraitId[];
  effects: Effect[];
  /** Fight clock time at which each technique is ready again. */
  cd: Record<string, number>;
  /**
   * `idle`: the player is free to act. `cast` and `recover`: the player is busy until `timer`
   * fills. `attack`: an enemy counts down to its next blow.
   */
  phase: 'idle' | 'cast' | 'recover' | 'attack';
  /** Technique being cast, while `phase` is `cast`. */
  cast: string | null;
  timer: Timer;
  /** Caster trait: the periodic heavy attack. */
  heavy: HeavyTimer | null;
  /** Illusionist trait: countdown to the next illusion. */
  illusion: Timer | null;
  /** Hidden trait: the enemy's first blow is still to come. */
  opening: boolean;
}

/** A technique as the fight uses it: its content facts and its numbers for this player. */
export interface KitTechnique {
  id: string;
  skill: SkillId;
  role: RoleId;
  rank: Rank;
  tags: TagId[];
  state: StateId | null;
  damage: number;
  castMs: number;
  cooldownMs: number;
  pool: 'chakra' | 'stamina';
  cost: number;
  accuracy: number;
  /** Chance of a combo when the rules are met. */
  comboChance: number;
  /** Whether it hits every enemy (area role or tag, or a series the data marks as hitting all). */
  hitsAll: boolean;
  /** The combo that fires whenever its rule is met, without a roll. */
  guaranteedCombo: ComboId | null;
}

/** What the player brings into the fight. */
export interface PlayerKit {
  techniques: KitTechnique[];
  /** Meditation level: it resists illusions. */
  med: number;
  chakraRegen: number;
  staminaRegen: number;
}

/** What happened in a fight; battle analysis averages these over many fights. */
export interface FightTally {
  /** Damage dealt to enemies, by technique id (`basic` for basic attacks); damage over time counts for its technique. */
  damage: Record<string, number>;
  /** Finished casts per technique. */
  uses: Record<string, number>;
  basic: number;
  /** Statuses applied: burn, wet, stun, bind, armorBreak, poison, illusion. */
  statuses: Record<string, number>;
  /** Combos that fired: fanBurn, shockWet, mudEva, steam. */
  combos: Record<string, number>;
  interrupts: number;
  /** Enemies killed. */
  kills: number;
  /** Damage the player took. */
  taken: number;
  /** Fight clock time in work units. */
  time: number;
  /** Skill of the technique cast last; Taijutsu after a basic attack. */
  style: SkillId;
  /** Fight clock time of the previous technique cast, or 0. */
  lastUseAt: number;
  /** Work units between a technique's start and the one before it, per technique: the basis of mastery XP. */
  masteryWork: Record<string, number>;
}

/** One line of the battle log: who did what, with which technique, for how much damage. */
export interface FightLogLine {
  side: 'player' | 'enemy';
  /** `cast`: the player began a technique; `hit` and `miss`: an attack landed or not. */
  act: 'cast' | 'hit' | 'miss';
  /** Technique id; null for a basic attack and for every enemy attack. */
  tech: string | null;
  /** Damage dealt by a hit; 0 otherwise. */
  dmg: number;
}

export interface FightState {
  /** The fight clock in work units. */
  t: number;
  /** The fight's own random stream. */
  rng: RngState;
  result: 'ongoing' | 'victory' | 'defeat';
  /** Content id of the enemy entry. */
  enemy: string;
  player: Combatant;
  enemies: Combatant[];
  kit: PlayerKit;
  /** Times each technique has finished casting against this enemy, for habituation. */
  uses: Record<string, number>;
  /** Fight clock time of the next pool regeneration. */
  poolAt: number;
  tally: FightTally;
  /** Lines for the battle log since the reader last emptied it; null when nobody reads it. */
  log: FightLogLine[] | null;
}

export type Decision = { kind: 'technique'; id: string } | { kind: 'basic' };

export interface ReadyTechnique {
  tech: KitTechnique;
  /** Damage it is expected to do now, after habituation, the nature wheel and the number of targets. */
  expected: number;
}

/** What the player AI sees when it must choose; nothing in it is live state to mutate. */
export interface FightView {
  t: number;
  player: Readonly<Combatant>;
  /** Living enemies. */
  enemies: readonly Readonly<Combatant>[];
  /** Techniques that are off cooldown and affordable. */
  ready: readonly ReadyTechnique[];
  /** Work units until the soonest cast of a living caster ends; null when none is casting. */
  castEndsIn: number | null;
  /** Work units until the soonest living caster that is waiting starts its cast; null when none. */
  nextCastIn: number | null;
  casterAlive: boolean;
  /** The player's accuracy is cut by a hidden enemy. */
  hidden: boolean;
  illusion: boolean;
  poisoned: boolean;
  /** A living enemy's Evasive is working. */
  evasive: boolean;
  /** A living enemy's armour is up. */
  armored: boolean;
  /** A living enemy's Regeneration is working. */
  regenUnchecked: boolean;
}

export type CombatAi = (view: FightView) => Decision;

/** The part of the rule set a fight reads. */
export interface FightRules {
  combatAi: CombatAi;
}
