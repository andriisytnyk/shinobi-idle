import type { ContentDb } from '@shinobi/content';
import {
  LIFE_FULL,
  cloneRefusal,
  dispatch as coreDispatch,
  freeCloneSlot,
  lifeRate,
  slotCount,
  type GameState,
  type Rules,
} from '@shinobi/core';
import type { DevResult } from './commands.ts';

/*
 * The clone controls of the developer panel. A clone has life of its own (parts of `LIFE_FULL`,
 * spent by chakra), a pouch from the Bank, and leaves a mind fatigue when dispelled. The panel
 * makes and dispels clones through the game's own `clone.create` / `clone.dispel` commands, so a
 * clone made here is one the game could make; only the life is then set, which no command does.
 */

/** How long a new clone lives: minutes at the rate of what it does now, or a share of full life. */
interface LifeChoice {
  lifeMin?: number;
  lifePct?: number;
}

export type CloneDevCommand =
  /** Makes a clone in a free slot (learning the clone technique first when none is known). */
  | ({ type: 'clone.create'; pouch?: 'default' | 'empty'; technique?: string } & LifeChoice)
  /** Sets the life of the clone in `slot`. */
  | ({ type: 'clone.setLife'; slot: number } & LifeChoice)
  /** Fills the life of the clone in `slot`. */
  | { type: 'clone.refill'; slot: number }
  /** Dispels the clone in `slot`, or every clone when `slot` is omitted. */
  | { type: 'clone.dispel'; slot?: number }
  /** Clears the mind fatigue. */
  | { type: 'clone.clearFatigue' };

/** The upper bound of a life in minutes: far beyond any clone, and a finite number all the same. */
export const MAX_LIFE_MIN = 100_000;

/** The techniques that open a clone slot, in slot order. */
export function cloneTechniques(content: ContentDb): string[] {
  return content.techniques
    .filter((t) => t.opensSlot !== undefined)
    .sort((a, b) => (a.opensSlot ?? 0) - (b.opensSlot ?? 0))
    .map((t) => t.id);
}

const fail = (reason: string): DevResult => ({ ok: false, reason });

/** The life asked for, in parts of `LIFE_FULL` (a whole number, 1..`LIFE_FULL`), or null when the choice is wrong. */
function lifeOf(
  state: GameState,
  slot: number,
  content: ContentDb,
  rules: Rules,
  choice: LifeChoice,
): number | null {
  if (choice.lifeMin !== undefined) {
    const min = choice.lifeMin;
    if (!Number.isFinite(min) || min <= 0 || min > MAX_LIFE_MIN) return null;
    const parts = Math.round(min * 60_000 * lifeRate(state, slot, content, rules));
    return Math.min(LIFE_FULL, Math.max(1, parts));
  }
  if (choice.lifePct !== undefined) {
    const pct = choice.lifePct;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
    return Math.max(1, Math.round((LIFE_FULL * pct) / 100));
  }
  return LIFE_FULL;
}

export function cloneCommand(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  command: CloneDevCommand,
  helpers: { learn(state: GameState, id: string, content: ContentDb): DevResult },
): DevResult {
  switch (command.type) {
    case 'clone.clearFatigue':
      state.fatigue = 0;
      return { ok: true };
    case 'clone.create': {
      const wanted = command.technique ?? cloneTechniques(content)[0];
      if (command.technique !== undefined && !cloneTechniques(content).includes(command.technique))
        return fail('dev.err.unknown');
      if (lifeOf(state, 1, content, rules, command) === null) return fail('dev.err.badNumber');
      if (state.fatigue > 0) return fail('dev.err.fatigued');
      if (slotCount(state, content) < 2) {
        if (wanted === undefined) return fail('dev.err.noCloneTechnique');
        const learned = helpers.learn(state, wanted, content);
        if (!learned.ok) return learned;
      }
      if (cloneRefusal(state, content) !== null) return fail('dev.err.noFreeSlot');
      const at = freeCloneSlot(state, content) as number;
      const made = coreDispatch(
        state,
        { type: 'clone.create', slot: at, ...(command.pouch === 'empty' ? { items: {} } : {}) },
        content,
        rules,
      );
      if (!made.ok) return fail('dev.err.noFreeSlot');
      const body = state.clones[at];
      const life = lifeOf(state, at, content, rules, command);
      if (!body || life === null) return fail('dev.err.badNumber');
      body.life = life;
      return { ok: true };
    }
    case 'clone.setLife': {
      const body = Number.isInteger(command.slot) ? state.clones[command.slot] : undefined;
      if (!body) return fail('dev.err.noClone');
      const life = lifeOf(state, command.slot, content, rules, command);
      if (life === null || (command.lifeMin === undefined && command.lifePct === undefined))
        return fail('dev.err.badNumber');
      body.life = life;
      return { ok: true };
    }
    case 'clone.refill': {
      const body = Number.isInteger(command.slot) ? state.clones[command.slot] : undefined;
      if (!body) return fail('dev.err.noClone');
      body.life = LIFE_FULL;
      return { ok: true };
    }
    case 'clone.dispel': {
      if (command.slot !== undefined && !state.clones[command.slot]) return fail('dev.err.noClone');
      const done = coreDispatch(
        state,
        command.slot === undefined
          ? { type: 'clone.dispel' }
          : { type: 'clone.dispel', slot: command.slot },
        content,
        rules,
      );
      return done.ok ? { ok: true } : fail('dev.err.noClone');
    }
  }
}
