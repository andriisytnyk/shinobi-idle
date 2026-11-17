import type { GameState } from './state.ts';

/** The queue keeps the newest events only (battle log lines first to go); the UI drains it long before this matters. */
export const EVENT_CAP = 200;

interface EventBase {
  /** Game time in ms at which the event happened. */
  at: number;
}

export interface LevelUpEvent extends EventBase {
  type: 'levelUp';
  skill: string;
  level: number;
}
export interface MasteryUpEvent extends EventBase {
  type: 'masteryUp';
  key: string;
  level: number;
}
export interface PoolCheckpointEvent extends EventBase {
  type: 'poolCheckpoint';
  skill: string;
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
  reason:
    'manual' | 'dispelled' | 'requirements' | 'replaced' | 'missing' | 'finished' | 'defeated';
  /** Item id the action ran out of, when it stopped for lack of ingredients. */
  missing?: string | undefined;
  /** A localization key that says why the action could not go on, when it stopped for a cause of its own. */
  cause?: string | undefined;
}
export interface EnemyDefeatedEvent extends EventBase {
  type: 'enemyDefeated';
  enemy: string;
}
export interface PlayerDefeatedEvent extends EventBase {
  type: 'playerDefeated';
  enemy: string;
  /** A clone lost the fight: no Wounds and no defeat for the player, the fight starts again. */
  clone?: boolean | undefined;
}
/** One line of the battle log: who did what, with which technique, for how much damage. */
export interface CombatLogEvent extends EventBase {
  type: 'combatLog';
  side: 'player' | 'enemy';
  /** `cast`: an action began; `resolve` and `interrupted`: it ended with its effect or was broken off; `hit` and `miss`: an attack landed or not. */
  act: 'cast' | 'resolve' | 'interrupted' | 'hit' | 'miss';
  /** Technique id; null for a basic attack and for every enemy attack. */
  tech: string | null;
  /** Content id of the enemy in the fight. */
  enemy: string;
  /** Damage dealt by a hit; 0 otherwise. */
  dmg: number;
  /** The id of the combatant whose action it is (on `cast`, `resolve` and `interrupted`). */
  by?: string;
}
/** What a win paid: ryo, the bounty of a boss, trophies and scroll parts. */
export interface LootEvent extends EventBase {
  type: 'loot';
  enemy: string;
  ryo: number;
  bounty: number;
  items: { id: string; n: number }[];
}
/** The Bingo book raised the knowledge level of an enemy. */
export interface BingoLevelEvent extends EventBase {
  type: 'bingoLevel';
  enemy: string;
  level: number;
}
/** A cleared operation paid its rewards. */
export interface OperationPaidEvent extends EventBase {
  type: 'operationPaid';
  op: string;
  first: boolean;
  ryo: number;
  rep: number;
  items: { id: string; n: number }[];
}
/** An operation was finished; `first` is true the first time. The rewards of a clear hang on this. */
export interface OperationClearedEvent extends EventBase {
  type: 'operationCleared';
  op: string;
  first: boolean;
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
/** The written test of an exam taken in two parts was passed; the rest of the exam is open. */
export interface ExamPassedEvent extends EventBase {
  type: 'examPassed';
  exam: string;
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
  nature: string;
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
/** The player arrived where a walk was going; `cell` is the address of the hex (a cell id, or the hex key). */
export interface TravelledEvent extends EventBase {
  type: 'travelled';
  cell: string;
}
/** The player entered a hex, one step of a walk: `hex` is its key, `by` how the player got there. */
export interface HexEnteredEvent extends EventBase {
  type: 'hexEntered';
  hex: string;
  terrain: string;
  by: 'walk';
  /** The action slot of the performer that moved: 0 is the character. */
  slot: number;
}
/** A hex that is no cell reached a new survey level; `max` marks the last level. */
export interface HexSurveyedEvent extends EventBase {
  type: 'hexSurveyed';
  hex: string;
  level: number;
  max: boolean;
}

/** One attempt at a mission stage ended; `ok` is false when it must be repeated. */
export interface MissionStageEvent extends EventBase {
  type: 'missionStage';
  mission: string;
  stage: number;
  ok: boolean;
}
/**
 * A mission was finished and paid. It carries what was really granted, so that nothing else is
 * needed to describe the completion: `ryo` and `rep` (the money and Reputation), every currency
 * that was added (those two, Intel and any currency a pack pays), the items that reached the bank
 * (a scroll part only when it dropped), and the village resource units.
 */
export interface MissionDoneEvent extends EventBase {
  type: 'missionDone';
  mission: string;
  ryo: number;
  rep: number;
  currencies: { currency: string; n: number }[];
  items: { id: string; n: number }[];
  /** The village resource the mission brought: `units` earned, `added` to the village, `lost` to a full store; `waiting` when there is no village yet and the units wait for it. Null when the mission brings none. */
  resource: { slug: string; units: number; added: number; lost: number; waiting: number } | null;
}
/** A building reached a new level. */
export interface BuildingBuiltEvent extends EventBase {
  type: 'buildingBuilt';
  building: string;
  level: number;
}
/** The village reached a new stage (Reputation at the threshold). */
export interface VillageStageEvent extends EventBase {
  type: 'villageStage';
  stage: number;
}
/** A civil resource filled the store; what the tick produced beyond it is lost. */
export interface StorageFullEvent extends EventBase {
  type: 'storageFull';
  resource: string;
}

/** A loaded save was made with other packs than the content has now: these appeared (`added`) or vanished (`removed`). */
export interface PacksChangedEvent extends EventBase {
  type: 'packsChanged';
  added: string[];
  removed: string[];
  /** Packs present both times whose version changed. */
  updated: { id: string; from: string; to: string }[];
}

/** A rule that a pack added failed and was switched off for this session: its pack, the rule and why. */
export interface RuleDisabledEvent extends EventBase {
  type: 'ruleDisabled';
  pack: string;
  rule: string;
  reason: string;
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
  | OperationClearedEvent
  | OperationPaidEvent
  | LootEvent
  | BingoLevelEvent
  | QuestStepEvent
  | QuestDoneEvent
  | RankUpEvent
  | ExamPassedEvent
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
  | TravelledEvent
  | HexEnteredEvent
  | HexSurveyedEvent
  | MissionStageEvent
  | MissionDoneEvent
  | BuildingBuiltEvent
  | VillageStageEvent
  | StorageFullEvent
  | PacksChangedEvent
  | RuleDisabledEvent;

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
