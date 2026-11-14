import type { ContentDb } from '@shinobi/content';
import { actionSystem, getActionKind, stopSlot } from './actions.ts';
import { evalReq } from './requirements.ts';
import type { GameState } from './state.ts';
import type { System } from './system.ts';

/** A player or bot command. Concrete command types arrive with the stages that need them. */
export type Command =
  | { type: 'action.start'; slot: number; kind: string; id: string }
  | { type: 'action.stop'; slot: number };

export type CommandResult = { ok: true } | { ok: false; reason: string };

const systems: System[] = [actionSystem];

/** Plugs another system (combat, village, wounds) into the game loop. */
export function registerSystem(system: System): void {
  systems.push(system);
}

/** Consecutive zero-length steps tolerated before the loop is declared stuck. */
const STALL_LIMIT = 10_000;

/**
 * Moves game time forward by `ms` whole milliseconds. Mutates `state`.
 * Jumps from event to event, so the result does not depend on how the time is chunked.
 */
export function advance(state: GameState, ms: number, content: ContentDb): void {
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`advance needs whole ms, got ${ms}`);
  let remaining = ms;
  let stalled = 0;
  for (;;) {
    let next: number | null = null;
    for (const system of systems) {
      const wait = system.nextEventIn(state, content);
      if (wait !== null && (next === null || wait < next)) next = wait;
    }
    if (next === null || next > remaining) break;
    stalled = next === 0 ? stalled + 1 : 0;
    if (stalled > STALL_LIMIT)
      throw new Error('advance made no progress: a system keeps asking for time 0');
    elapse(state, next, content);
    remaining -= next;
    for (const system of systems) system.run(state, content);
  }
  elapse(state, remaining, content);
}

function elapse(state: GameState, dt: number, content: ContentDb): void {
  if (dt === 0) return;
  for (const system of systems) system.elapse?.(state, dt, content);
  state.now += dt;
}

/** Applies a command to the state. Failures carry a localization key. */
export function dispatch(state: GameState, command: Command, content: ContentDb): CommandResult {
  switch (command.type) {
    case 'action.start': {
      const slot = state.slots[command.slot];
      if (!slot) return { ok: false, reason: 'error.invalidSlot' };
      const kind = getActionKind(command.kind);
      if (!kind) return { ok: false, reason: 'error.unknownActionKind' };
      if (!kind.has(command.id, content)) return { ok: false, reason: 'error.unknownAction' };
      const req = kind.requirements(state, command.id, content);
      if (req && !evalReq(state, req, content).met) {
        return { ok: false, reason: 'error.requirementsNotMet' };
      }
      slot.action = { kind: command.kind, id: command.id };
      slot.progress = 0;
      return { ok: true };
    }
    case 'action.stop': {
      if (!state.slots[command.slot]) return { ok: false, reason: 'error.invalidSlot' };
      if (!state.slots[command.slot]?.action) return { ok: false, reason: 'error.noAction' };
      stopSlot(state, command.slot, 'manual');
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'error.unknownCommand' };
  }
}
