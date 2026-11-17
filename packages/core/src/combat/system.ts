import {
  FIRST_FIGHT_FLAG,
  type Boss,
  type ContentDb,
  type Enemy,
  type Operation,
} from '@shinobi/content';
import { actionKindOf, stopSlot } from '../actions.ts';
import { chakraDivisor, isCloneSlot } from '../clone.ts';
import { bump, defeatsKey, killsKey } from '../counters.ts';
import { emit } from '../events.ts';
import { MS_PER_HOUR } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { grantMastery } from '../progression.ts';
import { nextInt, nextSeed } from '../rng.ts';
import type { Rules } from '../rules.ts';
import { SHARE_FULL, type GameState } from '../state.ts';
import type { System } from '../system.ts';
import { encounterFor } from './fight-encounter.ts';
import { bossNature } from '../natures.ts';
import { noteBounty, noteFight, noteSighting } from './bingo.ts';
import { grantLoot, rollLoot } from './loot.ts';
import { recordFight, recordItems, recordLoot, recordWounds, stampDefeat } from './report.ts';
import { payOperation } from './rewards.ts';
import type { TeamSupport } from './fight-types.ts';
import { createFight, fightAdvance, fightNextEventIn, fightOutcome } from './fight.ts';
import { CHAKRA_DIVISOR_KEY, secMs } from './numbers.ts';
import { ensurePouch, refillPouch, syncPouch } from './pouch.ts';
import { snapshotPlayer } from './snapshot.ts';
import type { CombatState, RunState } from './types.ts';
import { WORK_PER_MS, workOf } from './units.ts';
import { addWounds, shortenWounds } from './wounds.ts';
import { approachMs, entryOf, opSteps, type OpStep } from './zones.ts';

/** Names of the action kinds that occupy a slot while a fight runs. */
export const FIGHT_KIND = 'fight';
export const OPERATION_KIND = 'operation';

/** Whether an action kind is one the combat system drives. */
export const isCombatKind = (kind: string): boolean =>
  kind === FIGHT_KIND || kind === OPERATION_KIND;

/** The action kind of a mission; its slot holds a fight only while one of its combat stages runs. */
export const MISSION_KIND = 'mission';

/** The slot's work units for `ms` of game time. Fights run on work units, like action progress. */
export const combatUnits = (ms: number): number => workOf(ms);

/** Index of the slot running a fight or an operation, or -1. */
export function fightSlotIndex(state: GameState): number {
  const owner = state.combat?.owner ?? -1;
  const kind = state.slots[owner]?.action?.kind;
  return kind !== undefined && (isCombatKind(kind) || kind === MISSION_KIND) ? owner : -1;
}

/** Whether a fight is going that another slot owns: a slot that wants to fight must wait or be refused. */
export function fightBusy(state: GameState, slot: number): boolean {
  const owner = state.combat?.owner;
  return owner !== undefined && owner !== slot && state.slots[owner]?.action != null;
}

/**
 * Whether another slot runs an action that can hold the fight: a fight, an operation, or a
 * mission that has a combat stage. Only one such action runs at a time.
 */
export function fightCapableElsewhere(state: GameState, slot: number, content: ContentDb): boolean {
  const missions = indexOf(content).missions;
  return state.slots.some((other, index) => {
    const action = other.action;
    if (index === slot || !action) return false;
    if (isCombatKind(action.kind)) return true;
    return (
      action.kind === MISSION_KIND &&
      (missions.get(action.id)?.stages.some((st) => st.t === 'combat') ?? false)
    );
  });
}

/** The reason a fight-capable action cannot start in `slot` now (a localization key), or null. */
export const fightBusyReason = (
  state: GameState,
  slot: number | undefined,
  content: ContentDb,
): string | null =>
  slot !== undefined && fightCapableElsewhere(state, slot, content) ? 'error.fightBusy' : null;

type Pools = { hp: number; chakra: number; stamina: number };

/**
 * Starts a fight against `entry` from the player's current state. `pools` carries health and
 * pools over from the previous fight; without it the player starts full. The entry counts as
 * seen from here on.
 */
function startFight(
  state: GameState,
  entry: Enemy | Boss,
  content: ContentDb,
  rules: Rules,
  pools?: Pools,
  support: readonly TeamSupport[] = [],
): CombatState['fight'] {
  noteSighting(state, entry.id, content);
  const snapshot = snapshotPlayer(state, content, rules, pools, [entry.id]);
  // The fight gets its own seed from the game's combat stream and runs on a stream of its own.
  return createFight(
    snapshot,
    encounterFor(entry, content, [], 'special' in entry ? bossNature(state, entry) : null, support),
    nextSeed(state.rng, 'combat'),
    content,
    rules,
  );
}

function blank(
  entry: Enemy | Boss,
  fight: CombatState['fight'],
  run: RunState | null,
  owner: number,
): CombatState {
  return {
    enemy: entry.id,
    phase: 'fight',
    fight,
    work: 0,
    pause: 0,
    paid: {},
    carry: 0,
    style: fight.tally.style,
    owner,
    run,
  };
}

/** A zone fight that has just begun: full health and pools. */
export function newCombat(
  state: GameState,
  entry: Enemy | Boss,
  content: ContentDb,
  rules: Rules,
  owner: number,
): CombatState {
  return blank(entry, startFight(state, entry, content, rules), null, owner);
}

/** A fight of a mission's combat stage: full pools, the current loadout and pouch (no refill), and the teammates' support. */
export function newMissionCombat(
  state: GameState,
  entry: Enemy | Boss,
  support: readonly TeamSupport[],
  content: ContentDb,
  rules: Rules,
  owner: number,
): CombatState {
  state.flags[FIRST_FIGHT_FLAG] = true;
  // The pouch is topped up from the bank on the way into the fight, as for any fight.
  ensurePouch(state, content);
  refillPouch(state, content);
  return blank(entry, startFight(state, entry, content, rules, undefined, support), null, owner);
}

/** The enemy of an operation step; a step that draws from a pool draws on the combat stream. */
function enemyOfStep(state: GameState, step: OpStep | undefined): string | null {
  if (!step || step.t === 'approach') return null;
  if (step.t === 'fight') return step.enemy;
  return step.pool[nextInt(state.rng, 'combat', step.pool.length)] ?? null;
}

/**
 * The first moment of an operation run: the approach (if it has one) and the first fight, prepared at full pools.
 * `resume` starts the fight of that step instead, with no approach: the run of a save whose fight could not be
 * carried over goes on from the step it was at.
 */
export function newOperation(
  state: GameState,
  op: Operation,
  content: ContentDb,
  rules: Rules,
  owner: number,
  resume?: number,
): CombatState | null {
  const steps = opSteps(op);
  const resumed =
    resume !== undefined && steps[resume] !== undefined && steps[resume].t !== 'approach';
  const approach = !resumed && steps[0]?.t === 'approach';
  const at = resumed ? resume : approach ? 1 : 0;
  const enemy = enemyOfStep(state, steps[at]);
  const entry = enemy ? entryOf(content, enemy) : undefined;
  if (!entry) return null;
  const c = blank(entry, startFight(state, entry, content, rules), { op: op.id, step: at }, owner);
  if (approach) {
    c.phase = 'approach';
    c.pause = workOf(approachMs(state, op, content));
  }
  return c;
}

/** Pays mastery XP for the technique time the fight has tallied since the last payment. */
function settle(state: GameState, c: CombatState, content: ContentDb, rules: Rules): void {
  const K = content.balance.K;
  const tally = c.fight.tally;
  c.style = tally.style;
  for (const [id, work] of Object.entries(tally.masteryWork)) {
    const due = work - (c.paid[id] ?? 0);
    const tech = indexOf(content).techniques.get(id);
    if (!tech || (due <= 0 && c.carry <= 0)) continue;
    c.paid[id] = work;
    const paying = Math.max(0, due) + c.carry;
    c.carry = 0;
    // The signature technique learns a little faster.
    const bonus = state.loadouts.signature === id ? 1 + K.signature.xpBonus : 1;
    grantMastery(
      state,
      id,
      tech.skill,
      (bonus * K.masteryPerHour * paying) / WORK_PER_MS / MS_PER_HOUR,
      content,
      rules,
    );
  }
}

/** Hands the fight's battle log lines to the event queue, emptying the fight's own. */
function report(state: GameState, c: CombatState): void {
  const lines = c.fight.log;
  if (!lines) return;
  for (const line of lines.splice(0)) emit(state, { type: 'combatLog', enemy: c.enemy, ...line });
}

/**
 * The Wounds a finished fight costs: the stances it used, losing, and falling low in a won fight;
 * items then shorten the healing. A clone's body is not the player's: its defeat and its near
 * defeat cost no Wound (the price of a stance the clone chose still counts).
 */
function woundsAfter(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
  lost: boolean,
  key: string,
  clone: boolean,
): void {
  const tally = c.fight.tally;
  const low = c.fight.player.data.low === 1 && !lost && !clone ? 1 : 0;
  const n = (lost && !clone ? 1 : 0) + low + tally.wounds;
  addWounds(state, n, content, rules);
  recordWounds(state, key, n);
  if (tally.woundMin > 0) shortenWounds(state, tally.woundMin, content);
}

/** The id the battle report of the running fight is filed under: the zone, enemy or operation the slot holds. */
function reportKey(state: GameState, index: number): string {
  return state.slots[index]?.action?.id ?? '';
}

/** Copies the fight's pouch to the state and returns the units it used since the last copy. */
function syncAndCount(state: GameState, c: CombatState): Record<string, number> {
  const before = state.pouch.slots.map((s) => s.n);
  syncPouch(state, c.fight);
  const used: Record<string, number> = {};
  state.pouch.slots.forEach((s, i) => {
    const spent = (before[i] ?? 0) - s.n;
    if (spent > 0 && s.id !== '') used[s.id] = (used[s.id] ?? 0) + spent;
  });
  return used;
}

/** The player recovers a share of health and both pools. */
function recover(player: CombatState['fight']['player'], share: number): void {
  player.hp = Math.min(player.maxHp, player.hp + share * player.maxHp);
  player.chakra = Math.min(player.maxChakra, player.chakra + share * player.maxChakra);
  player.stamina = Math.min(player.maxStamina, player.stamina + share * player.maxStamina);
}

/** An operation was finished: its first-clear flag is raised and the event the rewards will hang on is sent. */
function cleared(state: GameState, op: Operation, content: ContentDb): void {
  const first = state.flags[op.clearFlag] === undefined;
  state.flags[op.clearFlag] = true;
  bump(state, `ops.${op.id}`);
  emit(state, { type: 'operationCleared', op: op.id, first });
  payOperation(state, op, first, content);
}

/**
 * An enemy fell: count it, pay the Wounds, and let the player recover. In a zone the player
 * regains health, pools and the pouch before the same enemy comes again; in an operation only a
 * share, the pouch is not refilled and the next step's enemy comes. Returns true when the
 * operation is over.
 */
function victory(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
  key: string,
  clone: boolean,
): boolean {
  const K = content.balance.K;
  const player = c.fight.player;
  c.phase = 'respawn';
  c.pause = workOf(secMs(K.respawn));
  // The time since the last technique use and the pause are paid with the next fight's first one.
  c.carry += c.fight.t - c.fight.tally.lastUseAt + c.pause;
  bump(state, killsKey(c.enemy));
  emit(state, { type: 'enemyDefeated', enemy: c.enemy });
  // Loot is rolled before the book counts the win, so the first win pays the full bounty. A
  // fight that ended with an enemy leaving counts as won.
  const fallen = entryOf(content, c.enemy);
  if (fallen) {
    const loot = rollLoot(state, fallen);
    grantLoot(state, c.enemy, loot, content);
    recordLoot(state, key, loot);
    noteBounty(state, c.enemy, loot.bounty);
  }
  noteFight(state, c.enemy, 'win', content);
  recordFight(state, key, c.fight, 'win', content, clone);
  woundsAfter(state, c, content, rules, false, key, clone);
  if (!c.run) {
    player.hp = Math.min(player.maxHp, player.hp + K.zoneHpRegen * player.maxHp);
    player.chakra = player.maxChakra;
    player.stamina = player.maxStamina;
    refillPouch(state, content);
    return false;
  }
  const op = indexOf(content).operations.get(c.run.op);
  if (!op) return true;
  recover(player, K[op.regen]);
  c.run.step++;
  const next = enemyOfStep(state, opSteps(op)[c.run.step]);
  if (next === null) {
    cleared(state, op, content);
    return true;
  }
  c.enemy = next;
  return false;
}

/**
 * A lost fight. The player's defeat is counted (event, counter, Bingo book, Wound); a clone's is
 * not: it is marked in the event and in the battle report and costs the player nothing.
 */
function lose(
  state: GameState,
  c: CombatState,
  key: string,
  content: ContentDb,
  rules: Rules,
  clone: boolean,
): void {
  emit(state, { type: 'playerDefeated', enemy: c.enemy, ...(clone ? { clone: true } : {}) });
  if (!clone) {
    bump(state, defeatsKey(c.enemy));
    noteFight(state, c.enemy, 'loss', content);
  }
  recordFight(state, key, c.fight, 'loss', content, clone);
  stampDefeat(state, key);
  woundsAfter(state, c, content, rules, true, key, clone);
}

/**
 * The chakra pool of the fight in progress follows the clones that exist (the character's pool
 * divided by `n + 1`): the maximum changes at once, the chakra the performer has now is kept,
 * cut only to a smaller maximum.
 */
export function followChakraPool(state: GameState, content: ContentDb): void {
  const c = state.combat;
  if (!c) return;
  const player = c.fight.player;
  // The body remembers what its pool was divided by; the pool is scaled from that to the divisor now.
  const had = player.data[CHAKRA_DIVISOR_KEY] ?? 1;
  // One slot, no clone: nothing to follow (the common case, kept cheap).
  if (had === 1 && state.slots.length < 2) return;
  const now = chakraDivisor(state, content);
  if (had === now) return;
  player.maxChakra = (player.maxChakra * had) / now;
  player.chakra = Math.min(player.chakra, player.maxChakra);
  if (now > 1) player.data[CHAKRA_DIVISOR_KEY] = now;
  else delete player.data[CHAKRA_DIVISOR_KEY];
}

/**
 * Real-time combat. A fight runs at full speed whoever fights (the clone's slot share does not
 * slow it); the fight engine spends the work on its own clock, so the system only wakes at the
 * fight's next event or the end of the pause.
 */
export const combatSystem: System = {
  nextEventIn(state, content, rules) {
    const c = state.combat;
    const slot = state.slots[fightSlotIndex(state)];
    if (!c || !slot || slot.share <= 0) return null;
    const wait = c.phase === 'fight' ? fightNextEventIn(c.fight, content, rules) : c.pause;
    if (wait === null) return 0;
    return Math.max(0, Math.ceil((wait - c.work) / SHARE_FULL));
  },

  elapse(state, dt) {
    const c = state.combat;
    const slot = state.slots[fightSlotIndex(state)];
    if (c && slot) c.work += dt * SHARE_FULL;
  },

  run(state, content, rules) {
    const c = state.combat;
    if (!c) return;
    const index = fightSlotIndex(state);
    if (index < 0) {
      state.combat = null;
      return;
    }
    const clone = isCloneSlot(state, content, index);
    followChakraPool(state, content);
    for (;;) {
      const entry = entryOf(content, c.enemy);
      if (!entry) return stopSlot(state, index, 'missing', content, rules);
      if (c.phase !== 'fight') {
        if (c.work < c.pause) {
          c.pause -= c.work;
          c.work = 0;
          return;
        }
        c.work -= c.pause;
        c.pause = 0;
        // After an approach the fight is already prepared; after a win the next one begins.
        if (c.phase === 'respawn') {
          const p = c.fight.player;
          c.fight = startFight(state, entry, content, rules, {
            hp: p.hp,
            chakra: p.chakra,
            stamina: p.stamina,
          });
          c.paid = {};
        }
        c.phase = 'fight';
      }
      c.work = fightAdvance(c.fight, c.work, content, rules);
      settle(state, c, content, rules);
      const key = reportKey(state, index);
      recordItems(state, key, syncAndCount(state, c));
      report(state, c);
      const result = fightOutcome(c.fight);
      if (result === 'ongoing') return;
      if (result === 'void') {
        // A hook of a pack failed: no win, no loss, no loot, no Wound. A new fight starts at once, without the hook.
        emit(state, {
          type: 'ruleDisabled',
          pack: c.fight.fault?.pack ?? '',
          rule: `fightHook.${c.fight.fault?.hook ?? ''}`,
          reason: c.fight.fault?.reason ?? '',
        });
        c.carry += c.fight.t - c.fight.tally.lastUseAt;
        const p = c.fight.player;
        c.fight = startFight(
          state,
          entry,
          content,
          rules,
          { hp: p.hp, chakra: p.chakra, stamina: p.stamina },
          c.fight.encounter.support,
        );
        c.paid = {};
        continue;
      }
      if (result === 'timeout') {
        // A fight that ran out of time pays nothing and costs nothing: a new one starts at once.
        noteFight(state, c.enemy, 'timeout', content);
        recordFight(state, key, c.fight, 'timeout', content, clone);
        c.carry += c.fight.t - c.fight.tally.lastUseAt;
        const p = c.fight.player;
        c.fight = startFight(
          state,
          entry,
          content,
          rules,
          { hp: p.hp, chakra: p.chakra, stamina: p.stamina },
          c.fight.encounter.support,
        );
        c.paid = {};
        continue;
      }
      const owner = rules.actionKinds[state.slots[index]?.action?.kind ?? ''];
      if (owner?.combatEnded) {
        // The action that started the fight decides what follows (a mission's combat stage).
        if (result === 'defeat') {
          lose(state, c, key, content, rules, clone);
        } else {
          bump(state, killsKey(c.enemy));
          emit(state, { type: 'enemyDefeated', enemy: c.enemy });
          // A mission pays its own rewards; the book and the report still count the fight.
          noteFight(state, c.enemy, 'win', content);
          recordFight(state, key, c.fight, 'win', content, clone);
          woundsAfter(state, c, content, rules, false, key, clone);
        }
        return owner.combatEnded(
          state,
          index,
          result === 'defeat' ? 'defeat' : 'victory',
          content,
          rules,
        );
      }
      if (result === 'defeat') {
        lose(state, c, key, content, rules, clone);
        // A clone that lost is dispelled and made anew: its action starts again (a zone fight with
        // fresh pools, an operation from its first step), the pouch refilled from the shared bank.
        if (clone) {
          const action = state.slots[index]?.action;
          if (!action) return;
          actionKindOf(rules, action.kind)?.start?.(state, index, action.id, content, rules);
          return;
        }
        // A defeat ends an operation run with the action: nothing of it is kept.
        return stopSlot(state, index, 'defeated', content, rules);
      }
      if (victory(state, c, content, rules, key, clone))
        return stopSlot(state, index, 'finished', content, rules);
    }
  },
};
