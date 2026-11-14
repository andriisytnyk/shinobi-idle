import type { ContentDb } from '@shinobi/content';
import { rebalanceShares, stopSlot } from './actions.ts';
import { evalReq } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** A player or bot command. Concrete command types arrive with the stages that need them. */
export type Command =
  | { type: 'action.start'; slot: number; kind: string; id: string }
  | { type: 'action.stop'; slot: number };

export type CommandResult = { ok: true } | { ok: false; reason: string };

/** Consecutive zero-length steps tolerated before the loop is declared stuck. */
const STALL_LIMIT = 10_000;

/**
 * Moves game time forward by `ms` whole milliseconds. Mutates `state`.
 * Jumps from event to event, so the result does not depend on how the time is chunked.
 */
export function advance(
  state: GameState,
  ms: number,
  content: ContentDb,
  rules: Rules = defaultRules,
): void {
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`advance needs whole ms, got ${ms}`);
  let remaining = ms;
  let stalled = 0;
  for (;;) {
    let next: number | null = null;
    for (const system of rules.systems) {
      const wait = system.nextEventIn(state, content, rules);
      if (wait !== null && (next === null || wait < next)) next = wait;
    }
    if (next === null || next > remaining) break;
    stalled = next === 0 ? stalled + 1 : 0;
    if (stalled > STALL_LIMIT) {
      throw new Error('advance made no progress: a system keeps asking for time 0');
    }
    elapse(state, next, content, rules);
    remaining -= next;
    for (const system of rules.systems) system.run(state, content, rules);
  }
  elapse(state, remaining, content, rules);
}

function elapse(state: GameState, dt: number, content: ContentDb, rules: Rules): void {
  if (dt === 0) return;
  for (const system of rules.systems) system.elapse?.(state, dt, content, rules);
  state.now += dt;
}

/** Applies a command to the state. Failures carry a localization key. */
export function dispatch(
  state: GameState,
  command: Command,
  content: ContentDb,
  rules: Rules = defaultRules,
): CommandResult {
  switch (command.type) {
    case 'action.start': {
      const slot = state.slots[command.slot];
      if (!slot) return { ok: false, reason: 'error.invalidSlot' };
      const kind = rules.actionKinds[command.kind];
      if (!kind) return { ok: false, reason: 'error.unknownActionKind' };
      if (!kind.has(command.id, content)) return { ok: false, reason: 'error.unknownAction' };
      const req = kind.requirements(state, command.id, content, rules);
      if (req && !evalReq(state, req, content).met) {
        return { ok: false, reason: 'error.requirementsNotMet' };
      }
      stopSlot(state, command.slot, 'replaced', content, rules);
      slot.action = { kind: command.kind, id: command.id };
      slot.progress = 0;
      slot.data = null;
      rebalanceShares(state);
      kind.start?.(state, command.slot, command.id, content, rules);
      return { ok: true };
    }
    case 'action.stop': {
      const slot = state.slots[command.slot];
      if (!slot) return { ok: false, reason: 'error.invalidSlot' };
      if (!slot.action) return { ok: false, reason: 'error.noAction' };
      stopSlot(state, command.slot, 'manual', content, rules);
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'error.unknownCommand' };
  }
}
