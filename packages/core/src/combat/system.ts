import type { ContentDb, Enemy } from '@shinobi/content';
import { stopSlot } from '../actions.ts';
import { bump, killsKey } from '../counters.ts';
import { emit } from '../events.ts';
import { MS_PER_HOUR } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { grantMastery } from '../progression.ts';
import { nextSeed } from '../rng.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { System } from '../system.ts';
import { encounterFor } from './fight-encounter.ts';
import { createFight, fightAdvance, fightNextEventIn, fightOutcome } from './fight.ts';
import { secMs } from './numbers.ts';
import { snapshotPlayer } from './snapshot.ts';
import type { CombatState } from './types.ts';
import { WORK_PER_MS, workOf } from './units.ts';

/** Name of the action kind that occupies a slot while a fight runs. */
export const FIGHT_KIND = 'fight';

/** The slot's work units for `ms` of game time. Fights run on work units, like action progress. */
export const combatUnits = (ms: number): number => workOf(ms);

/** Index of the slot running a fight, or -1. */
export function fightSlotIndex(state: GameState): number {
  return state.slots.findIndex((s) => s.action?.kind === FIGHT_KIND);
}

/**
 * Starts a fight against `enemy` from the player's current state. `pools` carries health and
 * pools over from the previous fight; without it the player starts full.
 */
function startFight(
  state: GameState,
  enemy: Enemy,
  content: ContentDb,
  rules: Rules,
  pools?: { hp: number; chakra: number; stamina: number },
): CombatState['fight'] {
  const snapshot = snapshotPlayer(state, content, rules, pools);
  // The fight gets its own seed from the game's combat stream and runs on a stream of its own.
  return createFight(
    snapshot,
    encounterFor(enemy, content),
    nextSeed(state.rng, 'combat'),
    content,
    rules,
  );
}

/** A fight that has just begun: full health and pools. */
export function newCombat(
  state: GameState,
  enemy: Enemy,
  content: ContentDb,
  rules: Rules,
): CombatState {
  return {
    enemy: enemy.id,
    phase: 'fight',
    fight: startFight(state, enemy, content, rules),
    work: 0,
    pause: 0,
    paid: {},
    carry: 0,
    style: 'tai',
  };
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
    grantMastery(
      state,
      id,
      tech.skill,
      (K.masteryPerHour * paying) / WORK_PER_MS / MS_PER_HOUR,
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

/** An enemy fell: count it, let the player recover, and start the pause before the next. */
function victory(state: GameState, c: CombatState, content: ContentDb): void {
  const K = content.balance.K;
  const player = c.fight.player;
  c.phase = 'respawn';
  c.pause = workOf(secMs(K.respawn));
  // The time since the last technique use and the pause are paid with the next fight's first one.
  c.carry += c.fight.t - c.fight.tally.lastUseAt + c.pause;
  player.hp = Math.min(player.maxHp, player.hp + K.zoneHpRegen * player.maxHp);
  player.chakra = player.maxChakra;
  player.stamina = player.maxStamina;
  bump(state, killsKey(c.enemy));
  emit(state, { type: 'enemyDefeated', enemy: c.enemy });
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
    const enemy = indexOf(content).enemies.get(c.enemy);
    if (!enemy) return stopSlot(state, index, 'missing', content, rules);
    for (;;) {
      if (c.phase === 'respawn') {
        if (c.work < c.pause) {
          c.pause -= c.work;
          c.work = 0;
          return;
        }
        c.work -= c.pause;
        c.pause = 0;
        const p = c.fight.player;
        c.fight = startFight(state, enemy, content, rules, {
          hp: p.hp,
          chakra: p.chakra,
          stamina: p.stamina,
        });
        c.paid = {};
        c.phase = 'fight';
      }
      c.work = fightAdvance(c.fight, c.work, content, rules);
      settle(state, c, content, rules);
      report(state, c);
      const result = fightOutcome(c.fight);
      if (result === 'ongoing') return;
      if (result === 'timeout') {
        // A fight that ran out of time pays nothing and costs nothing: a new one starts at once.
        c.carry += c.fight.t - c.fight.tally.lastUseAt;
        const p = c.fight.player;
        c.fight = startFight(state, enemy, content, rules, {
          hp: p.hp,
          chakra: p.chakra,
          stamina: p.stamina,
        });
        c.paid = {};
        continue;
      }
      if (result === 'defeat') {
        emit(state, { type: 'playerDefeated', enemy: c.enemy });
        return stopSlot(state, index, 'defeated', content, rules);
      }
      victory(state, c, content);
    }
  },
};
