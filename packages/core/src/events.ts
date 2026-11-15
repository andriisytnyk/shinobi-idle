import type { NatureId, SkillId } from '@shinobi/content';
import type { GameState } from './state.ts';

/** The queue keeps the newest events only (battle log lines first to go); the UI drains it long before this matters. */
export const EVENT_CAP = 200;

interface EventBase {
  /** Game time in ms at which the event happened. */
  at: number;
}

export interface LevelUpEvent extends EventBase {
  type: 'levelUp';
  skill: SkillId;
  level: number;
}
export interface MasteryUpEvent extends EventBase {
  type: 'masteryUp';
  key: string;
  level: number;
}
export interface PoolCheckpointEvent extends EventBase {
  type: 'poolCheckpoint';
  skill: SkillId;
  /** Content id of the checkpoint. */
  id: string;
  pct: number;
}
export interface TechniqueLearnedEvent extends EventBase {
  type: 'techniqueLearned';
  id: string;
}
export interface ActionStoppedEvent extends EventBase {
  type: 'actionStopped';
  slot: number;
  kind: string;
  id: string;
  reason: 'manual' | 'requirements' | 'replaced' | 'missing' | 'finished' | 'defeated';
  /** Item id the action ran out of, when it stopped for lack of ingredients. */
  missing?: string | undefined;
}
export interface EnemyDefeatedEvent extends EventBase {
  type: 'enemyDefeated';
  enemy: string;
}
export interface PlayerDefeatedEvent extends EventBase {
  type: 'playerDefeated';
  enemy: string;
}
/** One line of the battle log: who did what, with which technique, for how much damage. */
export interface CombatLogEvent extends EventBase {
  type: 'combatLog';
  side: 'player' | 'enemy';
  /** `cast`: the player began a technique; `hit` and `miss`: an attack landed or not. */
  act: 'cast' | 'hit' | 'miss';
  /** Technique id; null for a basic attack and for every enemy attack. */
  tech: string | null;
  /** Content id of the enemy in the fight. */
  enemy: string;
  /** Damage dealt by a hit; 0 otherwise. */
  dmg: number;
}
export interface QuestStepEvent extends EventBase {
  type: 'questStep';
  quest: string;
  /** Number of steps finished, 1-based. */
  step: number;
}
export interface QuestDoneEvent extends EventBase {
  type: 'questDone';
  quest: string;
}
export interface RankUpEvent extends EventBase {
  type: 'rankUp';
  rank: string;
}
export interface ItemGainedEvent extends EventBase {
  type: 'itemGained';
  id: string;
  n: number;
}
export interface ItemUsedEvent extends EventBase {
  type: 'itemUsed';
  id: string;
  target: string;
}
export interface GoalSetEvent extends EventBase {
  type: 'goalSet';
  kind: string;
  id: string;
}

/** A finished meditation cycle gave an Insight or an Enlightenment. */
export interface MeditationGainEvent extends EventBase {
  type: 'meditationGain';
  practice: string;
  kind: 'insight' | 'enlight';
}
/** A level of a practice modifier was bought; `mod` is `insight.0`, `enlight.2` and so on. */
export interface MeditationBoughtEvent extends EventBase {
  type: 'meditationBought';
  practice: string;
  mod: string;
  level: number;
}
/** An obstacle was built in a slot of the Athletics course. */
export interface ObstacleBuiltEvent extends EventBase {
  type: 'obstacleBuilt';
  slot: number;
  obstacle: string;
}

/** A chakra nature was chosen; `first` marks the native nature found by the test. */
export interface NatureGainedEvent extends EventBase {
  type: 'natureGained';
  nature: NatureId;
  first: boolean;
}

/** The region is open: Scouting and rank allow exploring it. */
export interface RegionOpenedEvent extends EventBase {
  type: 'regionOpened';
  region: string;
}
/** A cell reached a new level; `max` marks the last level it can have. */
export interface CellLevelUpEvent extends EventBase {
  type: 'cellLevelUp';
  cell: string;
  level: number;
  max: boolean;
}
/** A point of interest was found by exploring its cell to level 1. */
export interface PoiFoundEvent extends EventBase {
  type: 'poiFound';
  cell: string;
  poi: string;
}
/** The one-time loot of a cache or a vault was collected. */
export interface PoiClaimedEvent extends EventBase {
  type: 'poiClaimed';
  poi: string;
}
/** The player now stands in a new cell after a walk or an instant trip. */
export interface TravelledEvent extends EventBase {
  type: 'travelled';
  cell: string;
}

export type GameEvent =
  | LevelUpEvent
  | MasteryUpEvent
  | PoolCheckpointEvent
  | TechniqueLearnedEvent
  | ActionStoppedEvent
  | EnemyDefeatedEvent
  | PlayerDefeatedEvent
  | CombatLogEvent
  | QuestStepEvent
  | QuestDoneEvent
  | RankUpEvent
  | ItemGainedEvent
  | ItemUsedEvent
  | GoalSetEvent
  | MeditationGainEvent
  | MeditationBoughtEvent
  | ObstacleBuiltEvent
  | NatureGainedEvent
  | RegionOpenedEvent
  | CellLevelUpEvent
  | PoiFoundEvent
  | PoiClaimedEvent
  | TravelledEvent;

type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;

/** Appends an event stamped with the current game time, dropping the oldest beyond the cap. */
export function emit(state: GameState, event: WithoutAt<GameEvent>): void {
  state.events.push({ ...event, at: state.now } as GameEvent);
  // Battle log lines are the cheapest to lose: they go first so a long fight cannot push out a
  // level, a learned technique or a stopped action that an offline report still needs.
  while (state.events.length > EVENT_CAP) {
    const log = state.events.findIndex((e) => e.type === 'combatLog');
    state.events.splice(log === -1 ? 0 : log, 1);
  }
}
