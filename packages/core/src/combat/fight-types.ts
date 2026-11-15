import type { AiTier, ContentDb, SkillId } from '@shinobi/content';
import type { RngState } from '../rng.ts';

/** Stats an effect can change. Multipliers combine by product, additions as `1 + sum`. */
export type ModStat = 'accuracy' | 'evasion' | 'speed' | 'damageTaken' | 'taiDamage' | 'resist';

interface EffectBase {
  /** One effect per id on a combatant: applying it again refreshes it, it never stacks. */
  id: string;
  /** What put it there: a technique id or `trait:<id>`; damage it deals is credited to this. */
  src: string;
  /** Fight clock time at which it ends; null for an effect that lasts the whole fight. */
  until: number | null;
  /** Id of another effect that does nothing while this one is active. */
  suppresses?: string;
  /** The effect ends when the body with this id leaves the fight, by death or flight. */
  whileAlive?: string;
  /** Stacks held, for a status that stacks; `unit` is the strength of one. */
  stacks?: number;
  unit?: number;
}

/** Changes a stat of its holder for a duration. */
export interface ModifierEffect extends EffectBase {
  kind: 'modifier';
  stat: ModStat;
  op: 'mul' | 'add';
  value: number;
  /** For `resist`: the nature of the attackers whose damage is multiplied by `value`. */
  nature?: string;
}

/** Hurts or heals its holder `amount` every `every` work units until it ends; `stamina` drains the stamina pool instead. */
export interface PeriodicEffect extends EffectBase {
  kind: 'periodic';
  mode: 'damage' | 'heal' | 'stamina';
  amount: number;
  every: number;
  /** Fight clock time of the next tick. */
  next: number;
  /** The amount before any combo boosted it, so a boost never compounds. */
  base?: number;
}

export type Effect = ModifierEffect | PeriodicEffect;

/** A timer that fills by `work x speed`; it is done when `progress` reaches `need`. */
export interface Timer {
  progress: number;
  need: number;
}

/** One fighter. The player and every enemy have this shape. */
export interface Combatant {
  id: string;
  side: 'player' | 'enemy';
  /** Content id of the enemy entry this body came from; empty for the player. */
  entry: string;
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
  nature: string | null;
  /** Traits, as content ids; the fight hooks give them their behaviour. */
  traits: string[];
  /** Further hook ids (boss specials and the like). */
  specials: string[];
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
  /** Timers owned by fight hooks, by name; they fill at the combatant's speed. */
  timers: Record<string, Timer>;
  /** Numbers owned by fight hooks, by name. */
  data: Record<string, number>;
  /** Damage absorbed before health, and the fight clock time it lapses (null: never). */
  ward: number;
  wardUntil: number | null;
  /** Hits left that turn into a miss, and the fight clock time they lapse (null: never). */
  decoys: number;
  decoyUntil: number | null;
  /** The enemy leaves the fight when its health share falls to this; null never. */
  fleeAt: number | null;
  fled: boolean;
}

/** What a technique does besides damage, with its numbers resolved for this player. */
export interface KitEffect {
  /** `damage` for a plain attack, else the kind named by the technique's combat data. */
  kind:
    | 'damage'
    | 'none'
    | 'shield'
    | 'decoy'
    | 'evasionBuff'
    | 'cleanse'
    | 'passiveNegate'
    | 'stance'
    | 'nextCast'
    | 'reveal';
  /** Shield strength, decoy charges. */
  amount: number;
  /** Evasion multiplier, Taijutsu damage share of a stance, cast time scale of the next cast. */
  mult: number;
  durationMs: number;
  /** Stamina per second of a stance, Wounds after the fight it leaves, and the period of a passive. */
  drain: number;
  wounds: number;
  everyMs: number;
  /** Statuses a cleanse removes. */
  statuses: string[];
}

/** A technique as the fight uses it: its content facts and its numbers for this player. */
export interface KitTechnique {
  id: string;
  skill: SkillId;
  role: string;
  rank: string;
  tags: string[];
  state: string | null;
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
  guaranteedCombo: string | null;
  /** Scale of the habituation step: 1, or the signature's slower step. */
  habituationMult: number;
  fx: KitEffect;
  /** Cannot be cast while no stance is active. */
  requiresStance: boolean;
}

/** One slot of the pouch as the fight carries it: an item id (empty when the slot is) and the units left. */
export interface PouchSlot {
  id: string;
  n: number;
}

/** What the player brings into the fight. */
export interface PlayerKit {
  /** The techniques of the loadout. */
  techniques: KitTechnique[];
  /** Damage of a thrown tool, wounds counted. */
  toolDamage: number;
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
  /** Wounds the fight has earned beyond defeat and low health: stances. */
  wounds: number;
  /** Minutes of Wound healing the items used in the fight will shorten after it. */
  woundMin: number;
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

/** One kind of enemy body an encounter puts into the fight. */
export interface Spawn {
  /** Content id of the enemy or boss entry. */
  enemy: string;
  cl: number;
  traits: string[];
  nature: string | null;
  /** How many bodies of this kind. */
  count: number;
  /** Scaling of health and damage against the level formulas. */
  hpMult: number;
  dmgMult: number;
  /** The body leaves when its health share falls to this; null never. */
  fleeAt: number | null;
  /** Hook ids only the bodies of this spawn carry (a pack leader's own mechanic). */
  specials: string[];
}

/** A teammate's support in a fight: every `everyMs` a hit of `damage` x the player's basic damage, with the state of the nature. */
export interface TeamSupport {
  nature: string;
  everyMs: number;
  damage: number;
}

/** What a fight is against: a list of spawns plus special hooks every body of the fight carries. */
export interface Encounter {
  /** Content id of the entry the encounter was built from. */
  id: string;
  spawns: Spawn[];
  specials: string[];
  /** The teammates who support the player (a team mission); absent for none. */
  support?: TeamSupport[];
}

export type FightResult = 'ongoing' | 'victory' | 'defeat' | 'fled' | 'timeout';

export interface FightState {
  /** The fight clock in work units. */
  t: number;
  /** The fight ends as a timeout at this clock time. */
  cap: number;
  /** The fight's own random stream. */
  rng: RngState;
  result: FightResult;
  /** Content id of the entry fought. */
  enemy: string;
  encounter: Encounter;
  /** Bodies spawned so far, for naming. */
  spawned: number;
  player: Combatant;
  enemies: Combatant[];
  kit: PlayerKit;
  /** string tier of the player. */
  tier: number;
  /** The player's natures, first one first (a `wheel` enemy counters the first). */
  natures: string[];
  /** Id of the body the cast under way is aimed at; null when none. */
  target: string | null;
  /** Trait ids the player knows per enemy entry id; an entry without a record is fully known. `special` stands for the boss mechanic. */
  knowledge: Record<string, string[]>;
  /** The pouch, slot by slot, and the slot the medic pouch uses on its own (null: none). */
  pouch: PouchSlot[];
  medic: number | null;
  /** Times each technique has finished casting against this enemy, for habituation. */
  uses: Record<string, number>;
  /** Fight clock time of the next pool regeneration. */
  poolAt: number;
  tally: FightTally;
  /** Lines for the battle log since the reader last emptied it; null when nobody reads it. */
  log: FightLogLine[] | null;
}

// ---------- the player's decisions ----------

export type Decision =
  | { type: 'technique'; id: string; target?: string }
  | { type: 'basic'; target?: string }
  | { type: 'item'; id: string; target?: string }
  | { type: 'wait' };

export interface ViewEffect {
  id: string;
  kind: 'modifier' | 'periodic';
  /** Work units left; null for an effect that lasts the whole fight. */
  remaining: number | null;
}

export interface ViewTechnique {
  tech: Readonly<KitTechnique>;
  /** Work units until it is off cooldown; 0 when ready. */
  cooldownLeft: number;
  affordable: boolean;
  /** Off cooldown and affordable. */
  ready: boolean;
  /** Times it has been cast in this fight. */
  uses: number;
  /** Damage it is expected to do now, after habituation, the nature wheel and the number of targets. */
  expected: number;
  /** Its raw damage, with nothing counted: what a plain tactic ranks by. */
  power: number;
  /** False while it needs a stance and none is active. */
  stanceOk: boolean;
  /** The traits it answers: it carries the tag that counters them, or its state switches them off. */
  answers: readonly string[];
  /** Whether it stops interruptible casts. */
  interrupts: boolean;
}

/** A pouch slot as the AI sees it. */
export interface ViewPouch {
  slot: number;
  id: string;
  n: number;
  /** Tags the item answers with, and what using it does. */
  tags: readonly string[];
  use: string;
  /** The traits it answers, whether it stops interruptible casts, whether it guards against heavy casts. */
  answers: readonly string[];
  interrupts: boolean;
  guard: boolean;
}

/** What the player AI knows of the traits of the content. */
export interface AiVocab {
  /** Traits whose effects on the player the AI answers, in order, with the effect ids they inflict. */
  inflicted: readonly { trait: string; effects: readonly string[] }[];
  /** Traits the AI answers on their own, in order. */
  answered: readonly string[];
  /** Traits that wind up heavy casts. */
  casters: readonly string[];
}

export interface ViewEnemy {
  id: string;
  hp: number;
  hpShare: number;
  nature: string | null;
  effects: readonly ViewEffect[];
  /** Traits of this enemy the player knows. */
  knownTraits: readonly string[];
  /** Known traits that are working at the moment (not switched off). */
  workingTraits: readonly string[];
  /** A cast under way: its kind, the work units until it ends and in all, how strong it is (x damage) and whether an interrupt stops it. */
  cast: {
    kind: string;
    remaining: number;
    total: number;
    mult: number;
    interruptible: boolean;
    /** Whether the player knows this cast to be a heavy one (its trait or boss mechanic is known). */
    known: boolean;
  } | null;
  /** Work units until a waiting caster of this body starts its cast; null when none. */
  nextCastIn: number | null;
  /** The body the fight turns on, which the AI aims at first. */
  leader: boolean;
}

/** What the player AI sees when it must choose. Everything in it is a copy. */
export interface FightView {
  t: number;
  tier: number;
  player: {
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    effects: readonly ViewEffect[];
    /** Damage the ward still absorbs, and the decoy charges left. */
    ward: number;
    decoys: number;
  };
  /** Every technique of the loadout. */
  techniques: readonly ViewTechnique[];
  /** Living enemies. */
  enemies: readonly ViewEnemy[];
  /** Casts per technique so far (habituation counts). */
  habituation: Readonly<Record<string, number>>;
  /** The tier of the AI that plays: its ordered rule list and how the rules behave. */
  ai: AiTier;
  /** Traits that show on sight. */
  visibleTraits: readonly string[];
  /** What the traits of the content are, as the rules need them. */
  vocab: AiVocab;
  pouch: readonly ViewPouch[];
  /** The pouch slot used automatically and the health share it triggers below; null without the medic pouch. */
  medic: { slot: number; below: number } | null;
  /** The technique id of the active stance, if any. */
  stance: string | null;
  /** Whether the next cast is already hastened. */
  hastened: boolean;
  /** The reaction delay of this tier in work units, and the share of health below which a spare buff is cast. */
  reactWork: number;
  guardBelow: number;
  /** Work units a tool or pill takes to use. */
  itemWork: number;
}

export type CombatAi = (view: FightView) => Decision;

// ---------- fight hooks ----------

/** What a hook gets to work with. */
export interface FightCtx {
  fight: FightState;
  content: ContentDb;
  rules: FightRules;
}

/** An enemy's basic attack about to be made; a hook may change it. */
export interface AttackPlan {
  chance: number;
  damage: number;
}

/**
 * Behaviour attached to a trait or special id. A combatant carries a hook for each id in its
 * `traits` and `specials`. A hook keeps its state in the combatant's `timers`, `data` and
 * `effects`, so it is part of the plain-JSON fight, and wakes through the normal event search.
 */
export interface FightHook {
  id: string;
  /** A body has appeared: add effects, timers and data. */
  init?(ctx: FightCtx, c: Combatant): void;
  /** A multiplier on one of the combatant's stats, computed from its current state; 1 for none. */
  stat?(ctx: FightCtx, c: Combatant, stat: ModStat): number;
  /** Whether the trait is doing anything now (the view shows it); defaults to not being switched off. */
  working?(ctx: FightCtx, c: Combatant): boolean;
  /** One of this hook's timers (`timers[name]`) has filled and has been emptied by its size. */
  onTimer?(ctx: FightCtx, c: Combatant, name: string): void;
  /** A cast of this hook is being interrupted or stunned away. */
  onCancel?(ctx: FightCtx, c: Combatant): void;
  /** Whether a cast of this hook is under way, and the work units until it ends or starts. */
  castInfo?(
    ctx: FightCtx,
    c: Combatant,
  ): {
    kind: string;
    casting: boolean;
    interruptible: boolean;
    inWork: number | null;
    /** Work units the whole wind-up takes, and how hard the blow is (x the body's damage). */
    total: number;
    mult: number;
  } | null;
  /** The combatant is about to make its basic attack. */
  onAttack?(ctx: FightCtx, c: Combatant, plan: AttackPlan): void;
  /** The combatant's attack hit `target` for `dealt`. */
  onAttackHit?(ctx: FightCtx, c: Combatant, target: Combatant, dealt: number): void;
  /** The combatant lost health. */
  onDamaged?(ctx: FightCtx, c: Combatant, dealt: number, src: string): void;
  /** The combatant fell. */
  onDeath?(ctx: FightCtx, c: Combatant): void;
  /** Whether the body is the one the fight turns on (a pack leader that keeps calling the pack back): the AI aims at it first. */
  leader?(ctx: FightCtx, c: Combatant): boolean;
  /** A multiplier on the habituation step of the player's techniques used against this combatant; 1 for none. */
  habituation?(ctx: FightCtx, c: Combatant): number;
  /** The combatant left the fight, by death or flight; fires once, after `onDeath` for a death. */
  onLeave?(ctx: FightCtx, c: Combatant): void;
}

/** The part of the rule set a fight reads. */
export interface FightRules {
  combatAi: CombatAi;
  /** Handlers by trait or special id, in the order they are consulted. */
  fightHooks: readonly FightHook[];
}
