import type { ContentDb } from '@shinobi/content';
import { actionKindOf, rebalanceShares, stopSlot } from './actions.ts';
import { growSlots } from './clone.ts';
import { GOAL_CAP, GOAL_LISTS, isStoryGoal, pinGoal, sameGoal } from './goal.ts';
import { createClone, dispelClone } from './clone-life.ts';
import { STAND_KIND, asPerformer } from './performer.ts';
import { startRefusal } from './start-check.ts';
import {
  deleteSavedLoadout,
  loadSavedLoadout,
  prepareLoadout,
  saveLoadout,
  setAutoLoadout,
  setLoadout,
  setSignature,
  setCloneRole,
  setTargetPriority,
} from './combat/loadout.ts';
import { setMedicSlot, setPouchAmount, setPouchSlot, usePouchSlot } from './combat/pouch.ts';
import { buildObstacle } from './athletics.ts';
import { studyEnemy } from './combat/bingo.ts';
import { followChakraPool } from './combat/system.ts';
import { combineParts } from './scrolls.ts';
import type { EntityRef } from './entity.ts';
import { emit } from './events.ts';
import { examFor, SENSEI_TEST_KIND } from './exam.ts';
import { rankIndex } from './vocab.ts';
import { buyGear } from './gear.ts';
import { coatItem, useItem } from './items.ts';
import { placeAt } from './hex.ts';
import { indexOf } from './lookup.ts';
import { buyMeditationLevel } from './meditation.ts';
import { addNature, chooseNature, type NatureChoice } from './natures.ts';
import { markSeen, revealOf } from './reveal.ts';
import { shopBuy, shopSell } from './shop.ts';
import { payStep, updateQuests } from './quests.ts';
import type { ReqResult } from './requirements.ts';
import {
  callSystem,
  chargeEvent,
  disableSystem,
  isDisabled,
  originOf,
  takeNotices,
  validWait,
} from './guard.ts';
import { touchMods, withKeptTotals } from './modifiers.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { System } from './system.ts';
import type { GameState } from './state.ts';
import { cancelBuild, donateToTreasury, spendWorkforce, startBuild } from './village.ts';
import { jumpTo } from './travel.ts';
import { claimPoi, WALK_KIND } from './world.ts';

/** A player or bot command. Concrete command types arrive with the stages that need them. */
export type Command =
  | { type: 'action.start'; slot: number; kind: string; id: string }
  | { type: 'action.stop'; slot: number }
  /**
   * Makes a shadow clone (the technique must be known, the mind not tired): it takes its share of the chakra pool and
   * `items` from the Bank (item id to count; a default pouch when omitted), appears where the character stands and
   * stands there until given an action. `slot` defaults to the first free clone slot.
   */
  | { type: 'clone.create'; slot?: number; items?: Record<string, number> }
  /** Dispels the clone: its action stops, what it knows and carries goes to the character, who is left tired. Without `slot`, every clone is dispelled. */
  | { type: 'clone.dispel'; slot?: number }
  /** Starts the sensei test of the exam that grants `rank`; the checklist must be met. `slot` defaults to 0. */
  | { type: 'exam.start'; rank: string; slot?: number }
  /** Pays for the active step of a chain whose objective is a payment (Intel for tracking someone down). */
  | { type: 'quest.pay'; quest: string }
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
  | { type: 'goal.pin'; ref: EntityRef }
  | { type: 'goal.unpin'; ref: EntityRef }
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
  /** Chooses the role all the combat clones take in a fight (an id of `content.cloneRoles`; null: the default role). */
  | { type: 'loadout.cloneRole'; role: string | null }
  /** Chooses which enemy the player's side attacks first (an id of `content.targetPriorities`; null: the default one). */
  | { type: 'loadout.targetPriority'; priority: string | null }
  /** Builds the best loadout and pouch for a zone, enemy or boss id. */
  | { type: 'loadout.prepare'; encounter: string }
  /** Puts an item (or nothing) in a pouch slot and packs it from the bank. */
  | { type: 'pouch.set'; slot: number; item: string | null }
  | { type: 'pouch.amount'; slot: number; amount: number }
  /** Uses a healing or restoring slot by hand during a fight. */
  | { type: 'pouch.use'; slot: number }
  /** Chooses the slot the medic pouch uses on its own (null: none). */
  | { type: 'pouch.medic'; slot: number | null }
  /** The chakra paper test: sets the native nature, once, as a genin. `random` draws on the world stream. */
  | { type: 'nature.choose'; nature: NatureChoice }
  /** Adds a second nature (Chakra Control 20) or a third (40); only natures not owned. */
  | { type: 'nature.add'; nature: NatureChoice }
  /**
   * Goes to a hex. `walk` (the default): step by step over the hexes the player knows; the walk takes a slot (`slot` defaults to 0) and costs time. `paid`: at once, for ryo, to a surveyed hex the performer can walk to. `outpost`: at once and free, from a found outpost to another of its travel group. `cell` is the address of the target: a cell id, or the key `q,r` of a hex. Only the performer of `slot` moves.
   */
  | { type: 'world.travel'; cell: string; mode?: 'walk' | 'paid' | 'outpost'; slot?: number }
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
  // What the modifiers read may have been changed by hand since the last call: nothing is kept from before.
  touchMods(state);
  withKeptTotals(state, content, rules, () => run(state, ms, content, rules));
}

function run(state: GameState, ms: number, content: ContentDb, rules: Rules): void {
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
  // A technique learned by other means than the scroll (a tool, a test) has opened its slot by now.
  if (slotIndex >= state.slots.length && growSlots(state, content)) rebalanceShares(state, content);
  const refusal = startRefusal(state, slotIndex, kindName, id, content, rules);
  if (refusal) return { ok: false, reason: refusal.reason };
  const slot = state.slots[slotIndex];
  const kind = actionKindOf(rules, kindName);
  if (!slot || !kind) return { ok: false, reason: 'error.invalidSlot' };
  // A clone slot with no clone: one is made first (with the default pouch), and the action has to pass
  // its checks with what that clone carries, not with what the Bank holds.
  if (slotIndex > 0 && !state.clones[slotIndex]) {
    const made = createClone(state, slotIndex, undefined, content, rules);
    if (!made.ok) return made;
    const again = startRefusal(state, slotIndex, kindName, id, content, rules);
    if (again) {
      dispelClone(state, slotIndex, 'manual', content, rules, true);
      return { ok: false, reason: again.reason };
    }
  }
  const replaced = slot.action !== null;
  stopSlot(state, slotIndex, 'replaced', content, rules);
  // A clone appears where the character stands, then goes on by itself; one given a new action stays.
  if (slotIndex > 0 && !replaced) placeAt(state, slotIndex, state.world.location);
  slot.action = { kind: kindName, id };
  slot.progress = 0;
  slot.data = null;
  rebalanceShares(state, content);
  asPerformer(state, slotIndex, () => kind.start?.(state, slotIndex, id, content, rules));
  followChakraPool(state, content);
  return { ok: true };
}

/** Whether a goal reference names an entity the content has, of a kind that can be pinned. */
function goalExists(ref: EntityRef, content: ContentDb): boolean {
  if (typeof ref !== 'object' || ref === null || typeof ref.id !== 'string') return false;
  // The kinds that can be pinned are the kinds of the content that have a list to look the id up in.
  const list = content.entityKinds.find((k) => k.id === ref.kind)?.list;
  if (list === null || list === undefined || !GOAL_LISTS.has(list)) return false;
  const entities = (
    content as unknown as Record<string, readonly { id: string; board?: boolean }[]>
  )[list];
  // A mission can be pinned when it is on the board.
  return (
    Array.isArray(entities) &&
    entities.some((e) => e.id === ref.id && (list !== 'missions' || e.board === true))
  );
}

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
  touchMods(state);
  const result = apply(state, command, content, rules);
  // A mark is bookkeeping for the reveal rule: it changes nothing a quest or a village could read.
  if (result.ok && command.type !== 'reveal.mark') updateQuests(state, content);
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
      // A clone that is told to stop what it does stands; told again, while it stands, it is dispelled.
      if (command.slot > 0 && state.clones[command.slot] && slot.action.kind === STAND_KIND)
        dispelClone(state, command.slot, 'manual', content, rules);
      else stopSlot(state, command.slot, 'manual', content, rules);
      followChakraPool(state, content);
      return { ok: true };
    }
    case 'quest.pay':
      return payStep(state, command.quest, content);
    case 'clone.create':
      return createClone(state, command.slot, command.items, content, rules);
    case 'clone.dispel': {
      if (command.slot !== undefined && !state.slots[command.slot])
        return { ok: false, reason: 'error.invalidSlot' };
      const living = Object.keys(state.clones)
        .map(Number)
        .filter((at) => command.slot === undefined || command.slot === at)
        .sort((a, b) => a - b);
      if (living.length === 0) return { ok: false, reason: 'error.noClone' };
      for (const at of living) dispelClone(state, at, 'manual', content, rules);
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
    case 'goal.pin': {
      if (!goalExists(command.ref, content)) return { ok: false, reason: 'error.invalidGoal' };
      // A typed id must not let the goal panel print what the player has not discovered.
      if (revealOf(state, command.ref, content, rules) === 'hidden') {
        return { ok: false, reason: 'error.invalidGoal' };
      }
      // Pinning what is already pinned (the story chain always is) changes nothing.
      if (isStoryGoal(command.ref, content) || state.goals.some((g) => sameGoal(g, command.ref))) {
        return { ok: true };
      }
      if (state.goals.length >= GOAL_CAP) {
        return { ok: false, reason: 'error.goalCap', params: { n: GOAL_CAP } };
      }
      pinGoal(state, command.ref);
      emit(state, { type: 'goalSet', kind: command.ref.kind, id: command.ref.id });
      return { ok: true };
    }
    case 'goal.unpin': {
      state.goals = state.goals.filter((g) => !sameGoal(g, command.ref));
      return { ok: true };
    }
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
    case 'loadout.cloneRole':
      return setCloneRole(state, command.role, content);
    case 'loadout.targetPriority':
      return setTargetPriority(state, command.priority, content);
    case 'loadout.prepare':
      return prepareLoadout(state, command.encounter, content);
    case 'pouch.amount':
      return setPouchAmount(state, command.slot, command.amount, content);
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
      if (command.mode === 'paid' || command.mode === 'outpost')
        return jumpTo(state, command.slot ?? 0, command.cell, command.mode, content, rules);
      if (command.mode !== undefined && command.mode !== 'walk')
        return { ok: false, reason: 'error.unknownCommand' };
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
