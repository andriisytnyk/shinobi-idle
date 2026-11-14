import type { SkillId } from '@shinobi/content';
import type { GameState } from './state.ts';

/** The queue keeps the newest events only; the UI drains it long before this matters. */
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
}
export interface EnemyDefeatedEvent extends EventBase {
  type: 'enemyDefeated';
  enemy: string;
}
export interface PlayerDefeatedEvent extends EventBase {
  type: 'playerDefeated';
  enemy: string;
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

export type GameEvent =
  | LevelUpEvent
  | MasteryUpEvent
  | PoolCheckpointEvent
  | TechniqueLearnedEvent
  | ActionStoppedEvent
  | EnemyDefeatedEvent
  | PlayerDefeatedEvent
  | QuestStepEvent
  | QuestDoneEvent
  | RankUpEvent
  | ItemGainedEvent
  | ItemUsedEvent
  | GoalSetEvent;

type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;

/** Appends an event stamped with the current game time, dropping the oldest beyond the cap. */
export function emit(state: GameState, event: WithoutAt<GameEvent>): void {
  state.events.push({ ...event, at: state.now } as GameEvent);
  if (state.events.length > EVENT_CAP) state.events.splice(0, state.events.length - EVENT_CAP);
}
