import type { Boss, ContentDb, Enemy, Operation } from '@shinobi/content';
import { stopSlot } from '../actions.ts';
import { bump, killsKey } from '../counters.ts';
import { emit } from '../events.ts';
import { MS_PER_HOUR } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { grantMastery } from '../progression.ts';
import { nextInt, nextSeed } from '../rng.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { System } from '../system.ts';
import { encounterFor } from './fight-encounter.ts';
import { createFight, fightAdvance, fightNextEventIn, fightOutcome } from './fight.ts';
import { secMs } from './numbers.ts';
import { refillPouch, syncPouch } from './pouch.ts';
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

/** The slot's work units for `ms` of game time. Fights run on work units, like action progress. */
export const combatUnits = (ms: number): number => workOf(ms);

/** Index of the slot running a fight or an operation, or -1. */
export function fightSlotIndex(state: GameState): number {
  return state.slots.findIndex((s) => s.action !== null && isCombatKind(s.action.kind));
}

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
): CombatState['fight'] {
  state.seen[entry.id] = true;
  const snapshot = snapshotPlayer(state, content, rules, pools, [entry.id]);
  // The fight gets its own seed from the game's combat stream and runs on a stream of its own.
  return createFight(
    snapshot,
    encounterFor(entry, content),
    nextSeed(state.rng, 'combat'),
    content,
    rules,
  );
}

function blank(
  entry: Enemy | Boss,
  fight: CombatState['fight'],
  run: RunState | null,
): CombatState {
  return {
    enemy: entry.id,
    phase: 'fight',
    fight,
    work: 0,
    pause: 0,
    paid: {},
    carry: 0,
    style: 'tai',
    run,
  };
}

/** A zone fight that has just begun: full health and pools. */
export function newCombat(
  state: GameState,
  entry: Enemy | Boss,
  content: ContentDb,
  rules: Rules,
): CombatState {
  return blank(entry, startFight(state, entry, content, rules), null);
}

/** The enemy of an operation step; a step that draws from a pool draws on the combat stream. */
function enemyOfStep(state: GameState, step: OpStep | undefined): string | null {
  if (!step || step.t === 'approach') return null;
  if (step.t === 'fight') return step.enemy;
  return step.pool[nextInt(state.rng, 'combat', step.pool.length)] ?? null;
}

/** The first moment of an operation run: the approach (if it has one) and the first fight, prepared at full pools. */
export function newOperation(
  state: GameState,
  op: Operation,
  content: ContentDb,
  rules: Rules,
): CombatState | null {
  const steps = opSteps(op);
  const approach = steps[0]?.t === 'approach';
  const at = approach ? 1 : 0;
  const enemy = enemyOfStep(state, steps[at]);
  const entry = enemy ? entryOf(content, enemy) : undefined;
  if (!entry) return null;
  const c = blank(entry, startFight(state, entry, content, rules), { op: op.id, step: at });
  if (approach) {
    c.phase = 'approach';
    c.pause = workOf(approachMs(state, op, content));
  }
  return c;
}

/** Pays mastery XP for the technique time the fight has tallied since the last payment. */
function settle(state: GameState, c: CombatState, content: ContentDb): void {
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
    );
  }
}

/** Hands the fight's battle log lines to the event queue, emptying the fight's own. */
function report(state: GameState, c: CombatState): void {
  const lines = c.fight.log;
  if (!lines) return;
  for (const line of lines.splice(0)) emit(state, { type: 'combatLog', enemy: c.enemy, ...line });
}

/** The Wounds a finished fight costs: the stances it used, and falling low in a won fight; items then shorten the healing. */
function woundsAfter(state: GameState, c: CombatState, content: ContentDb, lost: boolean): void {
  const tally = c.fight.tally;
  const low = c.fight.player.data.low === 1 && !lost ? 1 : 0;
  addWounds(state, (lost ? 1 : 0) + low + tally.wounds, content);
  if (tally.woundMin > 0) shortenWounds(state, tally.woundMin, content);
}

/** The player recovers a share of health and both pools. */
function recover(player: CombatState['fight']['player'], share: number): void {
  player.hp = Math.min(player.maxHp, player.hp + share * player.maxHp);
  player.chakra = Math.min(player.maxChakra, player.chakra + share * player.maxChakra);
  player.stamina = Math.min(player.maxStamina, player.stamina + share * player.maxStamina);
}

/** An operation was finished: its first-clear flag is raised and the event the rewards will hang on is sent. */
function cleared(state: GameState, op: Operation): void {
  const first = state.flags[op.clearFlag] === undefined;
  state.flags[op.clearFlag] = true;
  bump(state, `ops.${op.id}`);
  emit(state, { type: 'operationCleared', op: op.id, first });
}

/**
 * An enemy fell: count it, pay the Wounds, and let the player recover. In a zone the player
 * regains health, pools and the pouch before the same enemy comes again; in an operation only a
 * share, the pouch is not refilled and the next step's enemy comes. Returns true when the
 * operation is over.
 */
function victory(state: GameState, c: CombatState, content: ContentDb): boolean {
  const K = content.balance.K;
  const player = c.fight.player;
  c.phase = 'respawn';
  c.pause = workOf(secMs(K.respawn));
  // The time since the last technique use and the pause are paid with the next fight's first one.
  c.carry += c.fight.t - c.fight.tally.lastUseAt + c.pause;
  bump(state, killsKey(c.enemy));
  emit(state, { type: 'enemyDefeated', enemy: c.enemy });
  woundsAfter(state, c, content, false);
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
    cleared(state, op);
    return true;
  }
  c.enemy = next;
  return false;
}

/**
 * Real-time combat. The slot's share becomes work units; the fight engine spends them on its own
 * clock, so the system only wakes at the fight's next event or the end of the pause.
 */
export const combatSystem: System = {
  nextEventIn(state, content, rules) {
    const c = state.combat;
    const slot = state.slots[fightSlotIndex(state)];
    if (!c || !slot || slot.share <= 0) return null;
    const wait = c.phase === 'fight' ? fightNextEventIn(c.fight, content, rules) : c.pause;
    if (wait === null) return 0;
    return Math.max(0, Math.ceil((wait - c.work) / slot.share));
  },

  elapse(state, dt) {
    const c = state.combat;
    const slot = state.slots[fightSlotIndex(state)];
    if (c && slot) c.work += dt * slot.share;
  },

  run(state, content, rules) {
    const c = state.combat;
    if (!c) return;
    const index = fightSlotIndex(state);
    if (index < 0) {
      state.combat = null;
      return;
    }
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
      settle(state, c, content);
      syncPouch(state, c.fight);
      report(state, c);
      const result = fightOutcome(c.fight);
      if (result === 'ongoing') return;
      if (result === 'timeout') {
        // A fight that ran out of time pays nothing and costs nothing: a new one starts at once.
        c.carry += c.fight.t - c.fight.tally.lastUseAt;
        const p = c.fight.player;
        c.fight = startFight(state, entry, content, rules, {
          hp: p.hp,
          chakra: p.chakra,
          stamina: p.stamina,
        });
        c.paid = {};
        continue;
      }
      if (result === 'defeat') {
        emit(state, { type: 'playerDefeated', enemy: c.enemy });
        woundsAfter(state, c, content, true);
        // A defeat ends an operation run with the action: nothing of it is kept.
        return stopSlot(state, index, 'defeated', content, rules);
      }
      if (victory(state, c, content)) return stopSlot(state, index, 'finished', content, rules);
    }
  },
};
