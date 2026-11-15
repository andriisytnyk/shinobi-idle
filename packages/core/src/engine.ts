import type { ContentDb } from '@shinobi/content';
import { rebalanceShares, stopSlot } from './actions.ts';
import {
  deleteSavedLoadout,
  loadSavedLoadout,
  prepareLoadout,
  saveLoadout,
  setAutoLoadout,
  setLoadout,
  setSignature,
} from './combat/loadout.ts';
import { setMedicSlot, setPouchSlot, usePouchSlot } from './combat/pouch.ts';
import type { EntityRef } from './entity.ts';
import { emit } from './events.ts';
import { examFor, SENSEI_TEST_KIND } from './exam.ts';
import { buyGear } from './gear.ts';
import { coatItem, useItem } from './items.ts';
import { indexOf } from './lookup.ts';
import { shopBuy, shopSell } from './shop.ts';
import { updateQuests } from './quests.ts';
import { evalReq, RANK_ORDER } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import { isSkillUnlocked } from './selectors.ts';
import type { GameState } from './state.ts';

/** A player or bot command. Concrete command types arrive with the stages that need them. */
export type Command =
  | { type: 'action.start'; slot: number; kind: string; id: string }
  | { type: 'action.stop'; slot: number }
  /** Starts the Genin exam's sensei test; the checklist must be met. `slot` defaults to 0. */
  | { type: 'exam.genin.start'; slot?: number }
  /** Uses a bank item on a target (for the graduate scroll, an academy technique id). */
  | { type: 'item.use'; id: string; target?: string | undefined }
  /** Coats a batch of `base` (senbon) with one `poison`. */
  | { type: 'item.coat'; poison: string; base: string }
  /** Buys `n` of a shop good or tool. */
  | { type: 'shop.buy'; item: string; n: number }
  /** Sells `n` of a trophy or craft product. */
  | { type: 'shop.sell'; item: string; n: number }
  /** Buys the next tier of a training-gear line. */
  | { type: 'gear.buy'; line: string }
  /** Pins a goal for the meta panel; the entity must exist and be a kind that can be a goal. */
  | { type: 'goal.set'; ref: EntityRef }
  | { type: 'goal.clear' }
  /** Names the player: 1 to 24 characters once trimmed. */
  | { type: 'player.setName'; name: string }
  /** Sets the loadout by hand (this switches the automatic loadout off). */
  | { type: 'loadout.set'; techniques: string[] }
  /** Switches the automatic loadout on or off; on rebuilds it at once. */
  | { type: 'loadout.auto'; on: boolean }
  | { type: 'loadout.save'; name: string }
  | { type: 'loadout.load'; name: string }
  | { type: 'loadout.delete'; name: string }
  /** Marks a technique of the loadout (mastery 25 or more) as the signature, or clears it. */
  | { type: 'loadout.signature'; technique: string | null }
  /** Builds the best loadout and pouch for a zone, enemy or boss id. */
  | { type: 'loadout.prepare'; encounter: string }
  /** Puts an item (or nothing) in a pouch slot and packs it from the bank. */
  | { type: 'pouch.set'; slot: number; item: string | null }
  /** Uses a healing or restoring slot by hand during a fight. */
  | { type: 'pouch.use'; slot: number }
  /** Chooses the slot the medic pouch uses on its own (null: none). */
  | { type: 'pouch.medic'; slot: number | null };

/** Longest player name. */
export const PLAYER_NAME_MAX = 24;

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
  // A skill that is still shut refuses every action it would train, whatever else holds.
  const skill = kind.skill?.(id, content);
  if (skill && !isSkillUnlocked(state, skill, content)) {
    return { ok: false, reason: 'error.skillLocked' };
  }
  const req = kind.requirements(state, id, content, rules);
  if (req && !evalReq(state, req, content).met) {
    // An action that lacks an ingredient says so; anything else is a plain unmet requirement.
    const lacking = kind.missing?.(state, id, content, rules);
    return { ok: false, reason: lacking ? 'error.missingIngredient' : 'error.requirementsNotMet' };
  }
  stopSlot(state, slotIndex, 'replaced', content, rules);
  slot.action = { kind: kindName, id };
  slot.progress = 0;
  slot.data = null;
  rebalanceShares(state);
  kind.start?.(state, slotIndex, id, content, rules);
  return { ok: true };
}

/** Whether a goal reference names an entity the content has, of a kind that can be pinned. */
function goalExists(ref: EntityRef, content: ContentDb): boolean {
  if (typeof ref !== 'object' || ref === null || typeof ref.id !== 'string') return false;
  const index = indexOf(content);
  switch (ref.kind) {
    case 'technique':
      return index.techniques.has(ref.id);
    case 'skill':
      return content.skills.some((s) => s.id === ref.id);
    case 'item':
      return index.items.has(ref.id);
    case 'enemy':
      return index.enemies.has(ref.id);
    case 'quest':
      return index.quests.has(ref.id);
    default:
      return false;
  }
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
    case 'item.coat':
      return coatItem(state, command.poison, command.base, content);
    case 'shop.buy':
      return shopBuy(state, command.item, command.n, content);
    case 'shop.sell':
      return shopSell(state, command.item, command.n, content);
    case 'gear.buy':
      return buyGear(state, command.line, content);
    case 'goal.set': {
      if (!goalExists(command.ref, content)) return { ok: false, reason: 'error.invalidGoal' };
      state.goal = { kind: command.ref.kind, id: command.ref.id };
      emit(state, { type: 'goalSet', kind: command.ref.kind, id: command.ref.id });
      return { ok: true };
    }
    case 'goal.clear':
      state.goal = null;
      return { ok: true };
    case 'player.setName': {
      const name = typeof command.name === 'string' ? command.name.trim() : '';
      // No control characters: a name is one line of plain text.
      if (name.length < 1 || name.length > PLAYER_NAME_MAX || /\p{Cc}/u.test(name)) {
        return { ok: false, reason: 'error.invalidName' };
      }
      state.player.name = name;
      return { ok: true };
    }
    case 'loadout.set':
      return setLoadout(state, command.techniques, content);
    case 'loadout.auto':
      return setAutoLoadout(state, command.on, content);
    case 'loadout.save':
      return saveLoadout(state, command.name, content);
    case 'loadout.load':
      return loadSavedLoadout(state, command.name, content);
    case 'loadout.delete':
      return deleteSavedLoadout(state, command.name);
    case 'loadout.signature':
      return setSignature(state, command.technique, content);
    case 'loadout.prepare':
      return prepareLoadout(state, command.encounter, content);
    case 'pouch.set':
      return setPouchSlot(state, command.slot, command.item, content);
    case 'pouch.use':
      return usePouchSlot(state, command.slot, content, rules);
    case 'pouch.medic':
      return setMedicSlot(state, command.slot, content);
    default:
      return { ok: false, reason: 'error.unknownCommand' };
  }
}
