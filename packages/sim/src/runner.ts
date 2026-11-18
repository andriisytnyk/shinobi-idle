import { content as defaultContent, type ContentDb } from '@shinobi/content';
import {
  advance,
  type Command,
  type CommandResult,
  createState,
  defaultRules,
  dispatch,
  type GameEvent,
  type GameState,
  type Rules,
} from '@shinobi/core';
import type { Bot } from './bot.ts';

/** Skill levels worth a line in the timeline. */
export const MILESTONE_LEVELS: readonly number[] = [5, 10, 20, 30, 40, 50];

/** Game time per step while the player is away, ms. */
const AWAY_STEP_MS = 300_000;

/** Rejected commands tolerated before a run is declared failed. */
export const DEFAULT_REJECT_LIMIT = 100;

export type Milestone =
  | { at: number; type: 'skill'; id: string; level: number }
  | { at: number; type: 'questStep'; id: string; step: number }
  | { at: number; type: 'questDone'; id: string }
  | { at: number; type: 'rank'; id: string }
  | { at: number; type: 'renownRank'; id: string };

export interface RunOptions {
  seed: number;
  /** Start from a copy of this state instead of a fresh game (`seed` is then only a label). */
  initialState?: GameState;
  content?: ContentDb;
  rules?: Rules;
  /** Game time between looks at the state, in ms (default 500). A finished action idles up to this long. */
  stepMs?: number;
  /** Hard game-time limit in ms. */
  limitMs: number;
  /**
   * A player who is not always looking: awake for `awakeMs` at the start of every `periodMs`, away
   * for the rest. While away the bot is not asked and time runs in larger steps, as it does offline.
   */
  away?: { periodMs: number; awakeMs: number };
  /** Rejected commands after which the run stops as failed. */
  rejectLimit?: number;
  /** Watches the run without changing it: every command with its result, and every step before time moves. */
  observer?: {
    command?(command: Command, result: CommandResult): void;
    step?(state: Readonly<GameState>, ms: number): void;
  };
}

export interface RunResult {
  bot: string;
  seed: number;
  /** `done` when the goal held, `limit` when time ran out, `failed` after too many rejected commands. */
  ended: 'done' | 'limit' | 'failed';
  /** Game time at the end of the run, ms. */
  endedAt: number;
  /** Game time at which the goal held (the last event of the step it first held in), or null. */
  goalAt: number | null;
  timeline: Milestone[];
  /** Skill XP gained during the run, by skill id (whole numbers). */
  xp: Record<string, number>;
  kills: Record<string, number>;
  actions: Record<string, number>;
  /** Commands the game refused, and the reason of the first one. */
  rejected: number;
  firstRejection: string | null;
  state: GameState;
}

function milestoneOf(event: GameEvent): Milestone | null {
  switch (event.type) {
    case 'levelUp':
      return MILESTONE_LEVELS.includes(event.level)
        ? { at: event.at, type: 'skill', id: event.skill, level: event.level }
        : null;
    case 'questStep':
      return { at: event.at, type: 'questStep', id: event.quest, step: event.step };
    case 'questDone':
      return { at: event.at, type: 'questDone', id: event.quest };
    case 'renownRank':
      return { at: event.at, type: 'renownRank', id: event.rank };
    case 'rankUp':
      return { at: event.at, type: 'rank', id: event.rank };
    default:
      return null;
  }
}

const withPrefix = (counters: Record<string, number>, prefix: string) =>
  Object.fromEntries(
    Object.entries(counters)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, n]) => [key.slice(prefix.length), n]),
  );

/**
 * Plays a game with `bot` through `dispatch` and `advance` only. Time moves in `stepMs` pieces;
 * the bot is asked again whenever a slot is idle or a level, quest step or rank changed. The
 * event queue is drained after every step so the core's cap cannot hide a milestone.
 */
export function runBot(bot: Bot, options: RunOptions): RunResult {
  const content = options.content ?? defaultContent;
  const rules = options.rules ?? defaultRules;
  const stepMs = options.stepMs ?? 500;
  const rejectLimit = options.rejectLimit ?? DEFAULT_REJECT_LIMIT;
  const state = options.initialState
    ? structuredClone(options.initialState)
    : createState(options.seed, content);
  state.events.splice(0);
  const startXp: Record<string, number> = Object.fromEntries(
    Object.entries(state.skills).map(([id, s]) => [id, s.xp]),
  );
  const timeline: Milestone[] = [];
  let rejected = 0;
  let firstRejection: string | null = null;
  let goalAt: number | null = bot.goal.reached(state, content) ? state.now : null;
  let changed = true;
  let lastDecision = -Infinity;

  const away = options.away;
  let wasAwake = true;
  while (goalAt === null && state.now < options.limitMs && rejected <= rejectLimit) {
    const awake = away === undefined || state.now % away.periodMs < away.awakeMs;
    if (awake && !wasAwake) changed = true;
    wasAwake = awake;
    const due = bot.reviewMs !== undefined && state.now - lastDecision >= bot.reviewMs;
    if (awake && (changed || due || state.slots.some((slot) => !slot.action))) {
      changed = false;
      lastDecision = state.now;
      for (const command of bot.decide({ state, content, rules }) ?? []) {
        const result = dispatch(state, command, content, rules);
        options.observer?.command?.(command, result);
        if (!result.ok) {
          rejected++;
          firstRejection ??= result.reason;
        }
      }
    }
    const untilWake = away ? away.periodMs - (state.now % away.periodMs) : Infinity;
    const step = Math.min(
      awake ? stepMs : Math.min(AWAY_STEP_MS, untilWake),
      options.limitMs - state.now,
    );
    options.observer?.step?.(state, step);
    advance(state, step, content, rules);
    const events = state.events.splice(0);
    for (const event of events) {
      const milestone = milestoneOf(event);
      if (milestone) timeline.push(milestone);
      if (event.type === 'levelUp' || event.type === 'questStep' || event.type === 'rankUp') {
        changed = true;
      }
    }
    if (bot.goal.reached(state, content)) goalAt = events[events.length - 1]?.at ?? state.now;
  }

  return {
    bot: bot.name,
    seed: options.seed,
    ended: goalAt !== null ? 'done' : rejected > rejectLimit ? 'failed' : 'limit',
    endedAt: state.now,
    goalAt,
    timeline,
    xp: Object.fromEntries(
      Object.entries(state.skills)
        .map(([id, s]) => [id, Math.round(s.xp - (startXp[id] ?? 0))] as const)
        .filter(([, gained]) => gained > 0),
    ),
    kills: withPrefix(state.counters, 'kills.'),
    actions: withPrefix(state.counters, 'actions.'),
    rejected,
    firstRejection,
    state,
  };
}
