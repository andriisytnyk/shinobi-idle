import type { ContentDb } from '@shinobi/content';
import { rebalanceShares, stopSlot } from './actions.ts';
import { examFor, SENSEI_TEST_KIND } from './exam.ts';
import { useItem } from './items.ts';
import { updateQuests } from './quests.ts';
import { evalReq, RANK_ORDER } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** A player or bot command. Concrete command types arrive with the stages that need them. */
export type Command =
  | { type: 'action.start'; slot: number; kind: string; id: string }
  | { type: 'action.stop'; slot: number }
  /** Starts the Genin exam's sensei test; the checklist must be met. `slot` defaults to 0. */
  | { type: 'exam.genin.start'; slot?: number }
  /** Uses a bank item on a target (for the graduate scroll, an academy technique id). */
  | { type: 'item.use'; id: string; target: string };

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
  // The state may have changed since the last call (a loaded save, a command that was not
  // followed by time), so quest objectives are checked before any time passes.
  updateQuests(state, content);
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

function startAction(
  state: GameState,
  slotIndex: number,
  kindName: string,
  id: string,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const slot = state.slots[slotIndex];
  if (!slot) return { ok: false, reason: 'error.invalidSlot' };
  const kind = rules.actionKinds[kindName];
  if (!kind) return { ok: false, reason: 'error.unknownActionKind' };
  if (!kind.has(id, content)) return { ok: false, reason: 'error.unknownAction' };
  const req = kind.requirements(state, id, content, rules);
  if (req && !evalReq(state, req, content).met) {
    return { ok: false, reason: 'error.requirementsNotMet' };
  }
  stopSlot(state, slotIndex, 'replaced', content, rules);
  slot.action = { kind: kindName, id };
  slot.progress = 0;
  slot.data = null;
  rebalanceShares(state);
  kind.start?.(state, slotIndex, id, content, rules);
  return { ok: true };
}

/** Applies a command to the state. Failures carry a localization key. */
export function dispatch(
  state: GameState,
  command: Command,
  content: ContentDb,
  rules: Rules = defaultRules,
): CommandResult {
  const result = apply(state, command, content, rules);
  if (result.ok) updateQuests(state, content);
  return result;
}

function apply(
  state: GameState,
  command: Command,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  switch (command.type) {
    case 'action.start':
      return startAction(state, command.slot, command.kind, command.id, content, rules);
    case 'action.stop': {
      const slot = state.slots[command.slot];
      if (!slot) return { ok: false, reason: 'error.invalidSlot' };
      if (!slot.action) return { ok: false, reason: 'error.noAction' };
      stopSlot(state, command.slot, 'manual', content, rules);
      return { ok: true };
    }
    case 'exam.genin.start': {
      const exam = examFor(content, 'genin');
      if (!exam) return { ok: false, reason: 'error.examNotAvailable' };
      if (RANK_ORDER.indexOf(state.player.rank) >= RANK_ORDER.indexOf(exam.rank)) {
        return { ok: false, reason: 'error.examPassed' };
      }
      return startAction(state, command.slot ?? 0, SENSEI_TEST_KIND, exam.id, content, rules);
    }
    case 'item.use':
      return useItem(state, command.id, command.target, content);
    default:
      return { ok: false, reason: 'error.unknownCommand' };
  }
}
