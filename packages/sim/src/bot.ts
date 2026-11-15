import type { ContentDb } from '@shinobi/content';
import type { Command, GameState, Rules } from '@shinobi/core';

/** What a bot sees: the live state (read it, never write it) and the content and rules the game runs on. */
export interface BotContext {
  state: Readonly<GameState>;
  content: ContentDb;
  /** Pass this to every selector so decisions match the rules the game really uses. */
  rules: Rules;
}

/** What a bot is trying to reach; the runner stops when it holds. */
export interface BotGoal {
  /** Ukrainian name shown in reports, for example «Генін». */
  label: string;
  reached(state: Readonly<GameState>): boolean;
}

/**
 * A bot is a strategy: it returns the commands to issue now, or null to leave everything as it
 * is. The runner calls it when a slot is idle and whenever a skill level, quest step or rank
 * changed. A bot reads the state; it never writes to it.
 */
export interface Bot {
  name: string;
  /** One line shown by `pnpm sim` (Ukrainian). */
  description: string;
  goal: BotGoal;
  /** When set, the runner also asks again after this much game time without a decision (ms). */
  reviewMs?: number;
  decide(ctx: BotContext): Command[] | null;
}
