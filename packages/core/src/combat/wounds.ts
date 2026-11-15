import type { ContentDb } from '@shinobi/content';
import { MS_PER_MINUTE } from '../formulas.ts';
import type { GameState } from '../state.ts';
import type { System } from '../system.ts';

/*
 * Wounds: stacks of a debuff, never a ban. Each stack cuts the combat stats (see `woundFactor`);
 * one stack heals per heal interval of game time, whatever the player is doing, so the system
 * runs on its own events and also while the game is closed (offline time is `advance` time).
 */

/** Time one stack takes to heal, ms. */
export const woundIntervalMs = (content: ContentDb): number =>
  Math.round(content.balance.K.wound.healMin * MS_PER_MINUTE);

/** The shortest time a stack can be brought down to by healing aids, ms. */
export const woundFloorMs = (content: ContentDb): number =>
  Math.round(content.balance.K.wound.healFloorMin * MS_PER_MINUTE);

/** Adds `n` stacks, up to the cap; the first stack starts its heal clock. */
export function addWounds(state: GameState, n: number, content: ContentDb): void {
  if (!(n > 0)) return;
  const w = state.wounds;
  const had = w.stacks > 0;
  w.stacks = Math.min(content.balance.K.wound.max, w.stacks + Math.floor(n));
  if (!had && w.stacks > 0) w.left = woundIntervalMs(content);
}

/**
 * Shortens the healing of the current stack by `minutes`, but not below the floor (a stack that
 * is already under the floor is left as it is). Returns false when there is no stack to heal.
 */
export function shortenWounds(state: GameState, minutes: number, content: ContentDb): boolean {
  const w = state.wounds;
  if (w.stacks < 1) return false;
  const cut = Math.round(minutes * MS_PER_MINUTE);
  w.left = Math.max(Math.min(w.left, woundFloorMs(content)), w.left - cut);
  return true;
}

export const woundSystem: System = {
  nextEventIn(state) {
    return state.wounds.stacks > 0 ? Math.max(0, state.wounds.left) : null;
  },

  elapse(state, dt) {
    if (state.wounds.stacks > 0) state.wounds.left = Math.max(0, state.wounds.left - dt);
  },

  run(state, content) {
    const w = state.wounds;
    while (w.stacks > 0 && w.left <= 0) {
      w.stacks--;
      w.left = w.stacks > 0 ? woundIntervalMs(content) : 0;
    }
  },
};
