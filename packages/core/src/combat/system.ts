import type { ContentDb, Enemy, Technique } from '@shinobi/content';
import { stopSlot } from '../actions.ts';
import { bump, killsKey } from '../counters.ts';
import { emit } from '../events.ts';
import { MS_PER_HOUR, MS_PER_SECOND } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { grantMastery } from '../progression.ts';
import { nextFloat } from '../rng.ts';
import type { Rules } from '../rules.ts';
import { SHARE_FULL, type GameState } from '../state.ts';
import type { System } from '../system.ts';
import {
  basicAttack,
  enemyStats,
  hitChance,
  playerAccuracy,
  playerChakraRegen,
  playerEvasion,
  playerMaxChakra,
  playerMaxHp,
  playerMaxStamina,
  playerStaminaRegen,
  techniqueNumbers,
} from './stats.ts';
import type { CombatState } from './types.ts';

/** Name of the action kind that occupies a slot while a fight runs. */
export const FIGHT_KIND = 'fight';

/** The only RNG stream combat draws from. */
const STREAM = 'combat';

/**
 * Combat runs on its own clock, `clock`, counted in work units (ms x SHARE_FULL) like action
 * progress: each real ms adds the fight slot's share. All deadlines are on this clock, so every
 * part of combat slows with the share and integer accounting keeps it chunk-invariant.
 */
export const combatUnits = (ms: number): number => ms * SHARE_FULL;

/** Index of the slot running a fight, or -1. */
export function fightSlotIndex(state: GameState): number {
  return state.slots.findIndex((s) => s.action?.kind === FIGHT_KIND);
}

/** A fight that has just begun: full health and pools, the first enemy already there. */
export function newCombat(state: GameState, enemy: Enemy, content: ContentDb): CombatState {
  const stats = enemyStats(enemy, content);
  return {
    enemy: enemy.id,
    phase: 'fight',
    clock: 0,
    enemyHp: stats.maxHp,
    hp: playerMaxHp(state, content),
    chakra: playerMaxChakra(state, content),
    stamina: playerMaxStamina(state, content),
    pPhase: 'ready',
    pAt: 0,
    cast: null,
    eAt: combatUnits(stats.intervalMs),
    respawnAt: 0,
    regenAt: combatUnits(Math.round(content.balance.K.combat.regenMs)),
    cd: {},
    style: 'tai',
    // Mastery is paid from the previous technique use, or from here at the start of a fight, so
    // time before a fight's first technique is paid once and never carried over from another fight.
    lastActionAt: 0,
    fx: { player: [], enemy: [] },
  };
}

/** Adds a line to the battle log; it reads the fight and never changes it. */
function log(
  state: GameState,
  c: CombatState,
  side: 'player' | 'enemy',
  act: 'cast' | 'hit' | 'miss',
  tech: string | null,
  dmg: number,
): void {
  emit(state, { type: 'combatLog', side, act, tech, enemy: c.enemy, dmg });
}

function roll(state: GameState, chance: number): boolean {
  return nextFloat(state.rng, STREAM) < chance;
}

/** Player AI v0: the strongest ready technique that can be paid for, else null (basic attack). */
function pickTechnique(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
): Technique | null {
  let best: Technique | null = null;
  let bestDamage = 0;
  for (const tech of content.techniques) {
    if (!state.known[tech.id] || (c.cd[tech.id] ?? 0) > c.clock) continue;
    const n = techniqueNumbers(state, tech, content, rules);
    if (n.damage <= bestDamage) continue;
    if ((n.pool === 'chakra' ? c.chakra : c.stamina) < n.cost) continue;
    best = tech;
    bestDamage = n.damage;
  }
  return best;
}

function playerAct(
  state: GameState,
  c: CombatState,
  enemy: Enemy,
  content: ContentDb,
  rules: Rules,
) {
  const tech = pickTechnique(state, c, content, rules);
  if (tech) {
    const n = techniqueNumbers(state, tech, content, rules);
    if (n.pool === 'chakra') c.chakra -= n.cost;
    else c.stamina -= n.cost;
    c.style = tech.skill;
    c.cast = tech.id;
    c.pPhase = 'cast';
    c.pAt = c.clock + combatUnits(n.castMs);
    // Mastery XP is paid for the combat time since the previous technique use (or the fight's
    // start). A basic attack does not move that timestamp, so the time it takes is paid with
    // the next technique rather than lost.
    const gapMs = (c.clock - c.lastActionAt) / SHARE_FULL;
    c.lastActionAt = c.clock;
    const amount = (content.balance.K.masteryPerHour * gapMs) / MS_PER_HOUR;
    grantMastery(state, tech.id, tech.skill, amount, content);
    log(state, c, 'player', 'cast', tech.id, 0);
    return;
  }
  const basic = basicAttack(state, content);
  c.style = 'tai';
  c.pPhase = 'recover';
  c.pAt = c.clock + combatUnits(basic.intervalMs);
  const stats = enemyStats(enemy, content);
  if (roll(state, hitChance(basic.accuracy, stats.evasion, content))) {
    c.enemyHp -= basic.damage;
    log(state, c, 'player', 'hit', null, basic.damage);
  } else log(state, c, 'player', 'miss', null, 0);
}

function resolveCast(
  state: GameState,
  c: CombatState,
  enemy: Enemy,
  content: ContentDb,
  rules: Rules,
) {
  const tech = c.cast === null ? undefined : indexOf(content).techniques.get(c.cast);
  c.cast = null;
  c.pPhase = 'ready';
  if (!tech) return;
  const n = techniqueNumbers(state, tech, content, rules);
  c.cd[tech.id] = c.clock + combatUnits(n.cooldownMs);
  const stats = enemyStats(enemy, content);
  const chance = hitChance(playerAccuracy(state, tech.skill, content), stats.evasion, content);
  if (roll(state, chance)) {
    c.enemyHp -= n.damage;
    log(state, c, 'player', 'hit', tech.id, n.damage);
  } else log(state, c, 'player', 'miss', tech.id, 0);
}

function enemyAttack(state: GameState, c: CombatState, enemy: Enemy, content: ContentDb) {
  const stats = enemyStats(enemy, content);
  c.eAt = c.clock + combatUnits(stats.intervalMs);
  const chance = hitChance(stats.accuracy, playerEvasion(state, content), content);
  if (roll(state, chance)) {
    c.hp -= stats.damage;
    log(state, c, 'enemy', 'hit', null, stats.damage);
  } else log(state, c, 'enemy', 'miss', null, 0);
}

/** An enemy fell: count it, let the player recover, and start the pause before the next. */
function enemyDown(state: GameState, c: CombatState, content: ContentDb) {
  const K = content.balance.K;
  c.enemyHp = 0;
  c.phase = 'respawn';
  c.respawnAt = c.clock + combatUnits(Math.round(K.respawn * MS_PER_SECOND));
  const maxHp = playerMaxHp(state, content);
  c.hp = Math.min(maxHp, c.hp + K.zoneHpRegen * maxHp);
  c.chakra = playerMaxChakra(state, content);
  c.stamina = playerMaxStamina(state, content);
  bump(state, killsKey(c.enemy));
  emit(state, { type: 'enemyDefeated', enemy: c.enemy });
}

function regenerate(state: GameState, c: CombatState, content: ContentDb) {
  const step = combatUnits(Math.round(content.balance.K.combat.regenMs));
  while (c.regenAt <= c.clock) {
    c.regenAt += step;
    c.chakra = Math.min(
      playerMaxChakra(state, content),
      c.chakra + playerChakraRegen(state, content),
    );
    c.stamina = Math.min(
      playerMaxStamina(state, content),
      c.stamina + playerStaminaRegen(state, content),
    );
  }
}

/**
 * Real-time combat on the fight slot's own clock. The system only wakes at deadlines: the end of
 * a cast or recovery, the next enemy attack, the next enemy appearing, the next regeneration.
 */
export const combatSystem: System = {
  nextEventIn(state) {
    const c = state.combat;
    const slot = state.slots[fightSlotIndex(state)];
    if (!c || !slot || slot.share <= 0) return null;
    const due = [c.regenAt];
    if (c.pPhase !== 'ready') due.push(c.pAt);
    if (c.phase === 'fight') due.push(c.eAt, ...(c.pPhase === 'ready' ? [c.clock] : []));
    else due.push(c.respawnAt);
    return Math.max(0, Math.ceil((Math.min(...due) - c.clock) / slot.share));
  },

  elapse(state, dt) {
    const c = state.combat;
    const slot = state.slots[fightSlotIndex(state)];
    if (c && slot) c.clock += dt * slot.share;
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
    regenerate(state, c, content);
    for (;;) {
      if (c.pPhase === 'recover' && c.pAt <= c.clock) c.pPhase = 'ready';
      if (c.phase === 'respawn') {
        if (c.respawnAt > c.clock) return;
        c.phase = 'fight';
        c.enemyHp = enemyStats(enemy, content).maxHp;
        c.eAt = c.clock + combatUnits(enemyStats(enemy, content).intervalMs);
      }
      if (c.pPhase === 'cast' && c.pAt <= c.clock) resolveCast(state, c, enemy, content, rules);
      else if (c.pPhase === 'ready') playerAct(state, c, enemy, content, rules);
      else if (c.eAt <= c.clock) {
        enemyAttack(state, c, enemy, content);
        if (c.hp <= 0) {
          emit(state, { type: 'playerDefeated', enemy: c.enemy });
          return stopSlot(state, index, 'defeated', content, rules);
        }
        continue;
      } else return;
      if (c.enemyHp <= 0) enemyDown(state, c, content);
    }
  },
};
