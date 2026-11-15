import { content as defaultContent, type ContentDb } from '@shinobi/content';
import {
  advance,
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

export type Milestone =
  | { at: number; type: 'skill'; id: string; level: number }
  | { at: number; type: 'questStep'; id: string; step: number }
  | { at: number; type: 'questDone'; id: string }
  | { at: number; type: 'rank'; id: string };

export interface RunOptions {
  seed: number;
  /** Hard game-time limit in ms. */
  limitMs: number;
  /** Game time between looks at the state, in ms. */
  stepMs?: number;
  content?: ContentDb;
  rules?: Rules;
}

export interface RunResult {
  bot: string;
  seed: number;
  /** `done` when the bot's goal held, `limit` when the time ran out first. */
  ended: 'done' | 'limit';
  /** Game time at the end of the run, ms. */
  endedAt: number;
  timeline: Milestone[];
  /** Skill XP gained, by skill id (whole numbers). */
  xp: Record<string, number>;
  kills: Record<string, number>;
  actions: Record<string, number>;
  /** Commands the game refused (a bot bug or a race with a defeat). */
  rejected: number;
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
 * Plays a fresh game with `bot` through `dispatch` and `advance` only. Time moves in `stepMs`
 * pieces; the bot is asked again whenever a slot is idle or a level, quest step or rank changed.
 */
export function runBot(bot: Bot, options: RunOptions): RunResult {
  const content = options.content ?? defaultContent;
  const rules = options.rules ?? defaultRules;
  const stepMs = options.stepMs ?? 500;
  const state = createState(options.seed, content);
  const timeline: Milestone[] = [];
  const seen = new WeakSet<GameEvent>();
  let rejected = 0;
  let changed = true;

  while (state.now < options.limitMs && !bot.isDone(state)) {
    if (changed || state.slots.some((slot) => !slot.action)) {
      changed = false;
      for (const command of bot.decide(state, content) ?? []) {
        if (!dispatch(state, command, content, rules).ok) rejected++;
      }
    }
    advance(state, Math.min(stepMs, options.limitMs - state.now), content, rules);
    for (const event of state.events) {
      if (seen.has(event)) continue;
      seen.add(event);
      const milestone = milestoneOf(event);
      if (milestone) timeline.push(milestone);
      if (event.type === 'levelUp' || event.type === 'questStep' || event.type === 'rankUp') {
        changed = true;
      }
    }
  }

  return {
    bot: bot.name,
    seed: options.seed,
    ended: bot.isDone(state) ? 'done' : 'limit',
    endedAt: state.now,
    timeline,
    xp: Object.fromEntries(
      Object.entries(state.skills)
        .filter(([, s]) => s.xp > 0)
        .map(([id, s]) => [id, Math.round(s.xp)]),
    ),
    kills: withPrefix(state.counters, 'kills.'),
    actions: withPrefix(state.counters, 'actions.'),
    rejected,
    state,
  };
}
