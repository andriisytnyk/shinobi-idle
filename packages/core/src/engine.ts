import type { ContentDb } from '@shinobi/content';
import type { GameState } from './state.ts';

/** A player or bot command. Concrete command types arrive with the stages that need them. */
export interface Command {
  type: string;
}

export type CommandResult = { ok: true } | { ok: false; reason: string };

/**
 * Moves game time forward by `ms` whole milliseconds. Mutates `state`.
 * For now it only advances the clock; the event scheduler arrives in stage 1.
 */
export function advance(state: GameState, ms: number, _content: ContentDb): void {
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`advance needs whole ms, got ${ms}`);
  state.now += ms;
}

/** Applies a command to the state. Every command is unknown until later stages add them. */
export function dispatch(_state: GameState, _command: Command, _content: ContentDb): CommandResult {
  return { ok: false, reason: 'error.unknownCommand' };
}
