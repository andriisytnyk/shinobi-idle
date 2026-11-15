import type { ContentDb } from '@shinobi/content';
import { actionKindOf, rebalanceShares, stopSlot } from './actions.ts';
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
import { buildObstacle } from './athletics.ts';
import { studyEnemy } from './combat/bingo.ts';
import { combineParts } from './scrolls.ts';
import type { EntityRef } from './entity.ts';
import { emit } from './events.ts';
import { examFor, SENSEI_TEST_KIND } from './exam.ts';
import { rankIndex } from './vocab.ts';
import { buyGear } from './gear.ts';
import { coatItem, useItem } from './items.ts';
import { indexOf } from './lookup.ts';
import { buyMeditationLevel } from './meditation.ts';
import { addNature, chooseNature, type NatureChoice } from './natures.ts';
import { markSeen } from './reveal.ts';
import { shopBuy, shopSell } from './shop.ts';
import { updateQuests } from './quests.ts';
import { evalReq, type ReqResult } from './requirements.ts';
import {
  callSystem,
  chargeEvent,
  disableSystem,
  isDisabled,
  originOf,
  takeNotices,
  validWait,
} from './guard.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { System } from './system.ts';
import { isSkillUnlocked } from './selectors.ts';
import type { GameState } from './state.ts';
import { cancelBuild, donateToTreasury, spendWorkforce, startBuild } from './village.ts';
import { claimPoi, travelInstant, WALK_KIND } from './world.ts';

/** A player or bot command. Concrete command types arrive with the stages that need them. */
export type Command =
  | { type: 'action.start'; slot: number; kind: string; id: string }
  | { type: 'action.stop'; slot: number }
  /** Starts the sensei test of the exam that grants `rank`; the checklist must be met. `slot` defaults to 0. */
  | { type: 'exam.start'; rank: string; slot?: number }
  /** The exam that grants the first rank after the Academy; kept for the code that began with it. Same as `exam.start` for that rank. */
  | { type: 'exam.genin.start'; slot?: number }
  /** Uses a bank item on a target (for the graduate scroll, an academy technique id). */
  | { type: 'item.use'; id: string; target?: string | undefined }
  /** Turns the scroll parts of a technique (`item` names a part or the scroll) into its scroll. */
  | { type: 'item.combine'; item: string }
  /** Spends Intel to raise the Bingo knowledge level of an enemy or boss by one. */
  | { type: 'bingo.study'; enemy: string }
  /** Coats a batch of `base` (senbon) with one `poison`. */
  | { type: 'item.coat'; poison: string; base: string }
  /** Buys `n` of a shop good or tool. */
  | { type: 'shop.buy'; item: string; n: number }
  /** Sells `n` of a trophy or craft product. */
  | { type: 'shop.sell'; item: string; n: number }
  /** Buys the next tier of a training-gear line. */
  | { type: 'gear.buy'; line: string }
  /** Builds one of the two obstacles of an Athletics course slot, replacing what stands there. */
  | { type: 'athletics.build'; slot: number; obstacle: string }
  /** Spends Insights or Enlightenments of a practice on one level of its modifier (`insight.0` .. `enlight.2`). */
  | { type: 'meditation.buy'; practice: string; mod: string }
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
  | { type: 'pouch.medic'; slot: number | null }
  /** The chakra paper test: sets the native nature, once, as a genin. `random` draws on the world stream. */
  | { type: 'nature.choose'; nature: NatureChoice }
  /** Adds a second nature (Chakra Control 20) or a third (40); only natures not owned. */
  | { type: 'nature.add'; nature: NatureChoice }
  /** Goes to a cell explored to level 1, or to an outpost of an open region: `instant` pays ryo by region (free to an outpost), `walk` is free and takes time. `slot` defaults to 0. */
  | { type: 'world.travel'; cell: string; mode: 'instant' | 'walk'; slot?: number }
  /** Takes the one-time loot of a cache or vault the player has found and stands next to. */
  | { type: 'world.claim'; poi: string }
  /** Starts the next level of a building: costs are taken now, the job runs in village ticks. */
  | { type: 'village.build'; building: string }
  /** Cancels the construction job and refunds what it cost. */
  | { type: 'village.cancel' }
  /** Spends one workforce charge to take one tick off the construction job. */
  | { type: 'village.workforce' }
  /** Moves ryo from the player's purse to the village treasury. */
  | { type: 'village.donate'; ryo: number }
  /** The interface says it showed these entities legitimately; idempotent, refused for a ref the reveal rule does not already allow by name. */
  | { type: 'reveal.mark'; refs: EntityRef[] };

/** Longest player name. */
export const PLAYER_NAME_MAX = 24;

/** A refusal carries the requirement tree that was not met when the command was a learning one. */
/** A refusal: a localization key, with the values the text names in `params` (the currency a player lacks, for one). */
export type CommandResult =
  | { ok: true }
  | { ok: false; reason: string; req?: ReqResult; params?: Record<string, string | number> };

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
  // Systems that a pack added are guarded (see guard.ts); with none, the loop is the plain one.
  const guarded = rules.systems.some((system) => originOf(system) !== undefined);
  // Consecutive steps at +0 ms for each system of a pack other than core.
  const zeros = new Map<System, number>();
  for (;;) {
    let next: number | null = null;
    // Guarded runs only: the waits of the systems of packs, and whether a core system asked for +0 ms.
    const packWaits = new Map<System, number>();
    let coreZero = false;
    for (const system of rules.systems) {
      let wait: number | null;
      if (guarded) {
        if (isDisabled(state, system)) continue;
        wait = callSystem(
          state,
          system,
          () => system.nextEventIn(state, content, rules),
          null,
          validWait,
        );
        const pack = originOf(system);
        if (pack === undefined) {
          if (wait === 0) coreZero = true;
        } else {
          if (wait !== null) packWaits.set(system, wait);
          const streak = wait === 0 ? (zeros.get(system) ?? 0) + 1 : 0;
          zeros.set(system, streak);
          // A system of a pack that keeps asking for an event now, with no time passing, is switched off.
          if (streak >= STALL_LIMIT) {
            disableSystem(state, system, pack, new Error('asks for an event at +0 ms without end'));
            continue;
          }
        }
      } else {
        wait = system.nextEventIn(state, content, rules);
      }
      if (wait !== null && (next === null || wait < next)) next = wait;
    }
    if (next === null || next > remaining) break;
    if (guarded) {
      // Each event of a system of a pack is charged to it; one over its hourly budget is switched off.
      let dropped = false;
      const limit = content.balance.K.engine.packEventsPerHour;
      for (const [system, wait] of packWaits) {
        const pack = originOf(system);
        if (wait === next && pack !== undefined && chargeEvent(state, system, pack, limit)) {
          dropped = true;
        }
      }
      if (dropped) continue;
    }
    // Only steps that core systems asked for at +0 ms count as a stall; a system of a pack has its own limit.
    stalled = (guarded ? coreZero : next === 0) ? stalled + 1 : 0;
    if (stalled > STALL_LIMIT) {
      throw new Error('advance made no progress: a system keeps asking for time 0');
    }
    if (guarded && next > 0) zeros.clear();
    elapse(state, next, content, rules, guarded);
    remaining -= next;
    for (const system of rules.systems) {
      if (!guarded) system.run(state, content, rules);
      else if (!isDisabled(state, system)) {
        callSystem(state, system, () => system.run(state, content, rules), undefined);
      }
    }
  }
  elapse(state, remaining, content, rules, guarded);
  if (guarded) {
    for (const notice of takeNotices()) emit(state, { type: 'ruleDisabled', ...notice });
  }
}

function elapse(
  state: GameState,
  dt: number,
  content: ContentDb,
  rules: Rules,
  guarded: boolean,
): void {
  if (dt === 0) return;
  for (const system of rules.systems) {
    if (!guarded) system.elapse?.(state, dt, content, rules);
    else if (!isDisabled(state, system)) {
      callSystem(state, system, () => system.elapse?.(state, dt, content, rules), undefined);
    }
  }
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
  const kind = actionKindOf(rules, kindName);
  if (!kind) return { ok: false, reason: 'error.unknownActionKind' };
  if (!kind.has(id, content)) return { ok: false, reason: 'error.unknownAction' };
  // A skill that is still shut refuses every action it would train, whatever else holds.
  const skill = kind.skill?.(id, content);
  if (skill && !isSkillUnlocked(state, skill, content)) {
    return { ok: false, reason: 'error.skillLocked' };
  }
  const blocked = kind.blocked?.(state, id, content, rules, slotIndex);
  if (blocked) return { ok: false, reason: blocked };
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
  // The kinds that can be pinned are the kinds of the content that have a list to look the id up in.
  const list = content.entityKinds.find((k) => k.id === ref.kind)?.list;
  if (list === null || list === undefined || !PINNABLE.has(list)) return false;
  const entities = (content as unknown as Record<string, readonly { id: string }[]>)[list];
  return Array.isArray(entities) && entities.some((e) => e.id === ref.id);
}

/** The lists of entities that a goal may point at. */
const PINNABLE: ReadonlySet<string> = new Set([
  'techniques',
  'skills',
  'items',
  'enemies',
  'quests',
]);

/** Starts the sensei test of the exam that grants `rank`. */
function startExam(
  state: GameState,
  rank: unknown,
  slot: number | undefined,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const exam = typeof rank === 'string' ? examFor(content, rank) : undefined;
  if (!exam) return { ok: false, reason: 'error.examNotAvailable' };
  if (rankIndex(content, state.player.rank) >= rankIndex(content, exam.rank)) {
    return { ok: false, reason: 'error.examPassed' };
  }
  return startAction(state, slot ?? 0, SENSEI_TEST_KIND, exam.id, content, rules);
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
    case 'exam.start':
      return startExam(state, command.rank, command.slot, content, rules);
    case 'exam.genin.start': {
      const graduation = indexOf(content).graduateRank;
      if (graduation === null) return { ok: false, reason: 'error.examNotAvailable' };
      return startExam(state, graduation, command.slot, content, rules);
    }
    case 'item.use':
      return useItem(state, command.id, command.target, content, rules);
    case 'item.combine':
      return combineParts(state, command.item, content);
    case 'bingo.study':
      return studyEnemy(state, command.enemy, content);
    case 'item.coat':
      return coatItem(state, command.poison, command.base, content);
    case 'shop.buy':
      return shopBuy(state, command.item, command.n, content, rules);
    case 'shop.sell':
      return shopSell(state, command.item, command.n, content);
    case 'gear.buy':
      return buyGear(state, command.line, content);
    case 'athletics.build':
      return buildObstacle(state, command.slot, command.obstacle, content, rules);
    case 'meditation.buy':
      return buyMeditationLevel(state, command.practice, command.mod, content);
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
    case 'nature.choose':
      return chooseNature(state, command.nature, content);
    case 'nature.add':
      return addNature(state, command.nature, content);
    case 'world.travel':
      if (command.mode === 'instant') return travelInstant(state, command.cell, content, rules);
      if (command.mode !== 'walk') return { ok: false, reason: 'error.unknownCommand' };
      return startAction(state, command.slot ?? 0, WALK_KIND, command.cell, content, rules);
    case 'world.claim':
      return claimPoi(state, command.poi, content);
    case 'village.build':
      return startBuild(state, command.building, content);
    case 'village.cancel':
      return cancelBuild(state);
    case 'village.workforce':
      return spendWorkforce(state);
    case 'village.donate':
      return donateToTreasury(state, command.ryo, content);
    case 'reveal.mark':
      return markSeen(state, command.refs, content);
    default:
      return { ok: false, reason: 'error.unknownCommand' };
  }
}
