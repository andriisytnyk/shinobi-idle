import type { ContentDb } from '@shinobi/content';
import type { Command, GameState } from '@shinobi/core';

/**
 * A bot is a strategy: given the state it returns the commands to issue now, or null to leave
 * everything as it is. The runner calls it when the bot has no running action and whenever a
 * skill level, quest step or rank changed. A bot reads the state; it never writes to it.
 */
export interface Bot {
  name: string;
  /** One line shown by `pnpm sim` (Ukrainian). */
  description: string;
  decide(state: Readonly<GameState>, content: ContentDb): Command[] | null;
  /** When this holds the run is over; the runner also stops at its time limit. */
  isDone(state: Readonly<GameState>): boolean;
}
