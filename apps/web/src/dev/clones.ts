import type { ContentDb } from '@shinobi/content';
import type { GameState } from '@shinobi/core';
import type { DevResult } from './commands.ts';

/*
 * The clone controls of the developer panel, kept in this one small module: the clone is being
 * redesigned (life and chakra of its own, allies in combat), and these are the only lines to adapt.
 * Today a clone is a slot opened by a technique (`opensSlot`) and has neither life nor chakra of
 * its own, so «create» means «learn the technique» and «fatigue» means the wounds of the character.
 */

export type CloneDevCommand =
  /** Opens a clone slot: learns the technique that opens it (the first one when `technique` is omitted). */
  | { type: 'clone.create'; technique?: string }
  /** Clears the wounds (the fatigue the character carries). */
  | { type: 'clone.clearFatigue' };

/** The techniques that open a clone slot, in slot order. */
export function cloneTechniques(content: ContentDb): string[] {
  return content.techniques
    .filter((t) => t.opensSlot !== undefined)
    .sort((a, b) => (a.opensSlot ?? 0) - (b.opensSlot ?? 0))
    .map((t) => t.id);
}

export function cloneCommand(
  state: GameState,
  content: ContentDb,
  command: CloneDevCommand,
  helpers: { learn(state: GameState, id: string, content: ContentDb): DevResult },
): DevResult {
  if (command.type === 'clone.clearFatigue') {
    state.wounds.stacks = 0;
    state.wounds.left = 0;
    return { ok: true };
  }
  const id = command.technique ?? cloneTechniques(content)[0];
  if (id === undefined || !cloneTechniques(content).includes(id))
    return { ok: false, reason: 'dev.err.unknown' };
  return helpers.learn(state, id, content);
}
