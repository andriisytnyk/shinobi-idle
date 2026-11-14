import type { ContentDb, Enemy, Technique } from '@shinobi/content';
import { stopSlot } from '../actions.ts';
import { bump, killsKey } from '../counters.ts';
import { emit } from '../events.ts';
import { MS_PER_HOUR, MS_PER_SECOND } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { gainMasteryXp } from '../progression.ts';
import { nextFloat } from '../rng.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
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

/** Pools regenerate once per second of game time. */
const REGEN_MS = MS_PER_SECOND;

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
    enemyHp: stats.maxHp,
    hp: playerMaxHp(state, content),
    chakra: playerMaxChakra(state, content),
    stamina: playerMaxStamina(state, content),
    pPhase: 'ready',
    pAt: state.now,
    cast: null,
    eAt: state.now + stats.intervalMs,
    respawnAt: 0,
    regenAt: state.now + REGEN_MS,
    cd: {},
    style: 'tai',
    lastActionAt: state.now,
    fx: { player: [], enemy: [] },
  };
}

function roll(state: GameState, chance: number): boolean {
  return nextFloat(state.rng, STREAM) < chance;
}

/** Techniques the player knows that can hurt, in content order. */
function knownAttacks(state: GameState, content: ContentDb): Technique[] {
  return content.techniques.filter((t) => state.known[t.id]);
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
  for (const tech of knownAttacks(state, content)) {
    if ((c.cd[tech.id] ?? 0) > state.now) continue;
    const n = techniqueNumbers(state, tech, content, rules);
    if (n.damage <= bestDamage) continue;
    if ((n.pool === 'chakra' ? c.chakra : c.stamina) < n.cost) continue;
    best = tech;
    bestDamage = n.damage;
  }
  return best;
}

/** Mastery XP is paid for the time since the previous action, per balance. */
function noteAction(state: GameState, c: CombatState, content: ContentDb): number {
  const gap = state.now - c.lastActionAt;
  c.lastActionAt = state.now;
  return (content.balance.K.masteryPerHour * gap) / MS_PER_HOUR;
}

function playerAct(
  state: GameState,
  c: CombatState,
  enemy: Enemy,
  content: ContentDb,
  rules: Rules,
) {
  const tech = pickTechnique(state, c, content, rules);
  const mastery = noteAction(state, c, content);
  if (tech) {
    const n = techniqueNumbers(state, tech, content, rules);
    if (n.pool === 'chakra') c.chakra -= n.cost;
    else c.stamina -= n.cost;
    c.style = tech.skill;
    c.cast = tech.id;
    c.pPhase = 'cast';
    c.pAt = state.now + n.castMs;
    gainMasteryXp(state, tech.id, mastery, content);
    return;
  }
  const basic = basicAttack(state, content);
  c.style = 'tai';
  c.pPhase = 'recover';
  c.pAt = state.now + basic.intervalMs;
  const stats = enemyStats(enemy, content);
  if (roll(state, hitChance(basic.accuracy, stats.evasion, content))) c.enemyHp -= basic.damage;
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
  c.cd[tech.id] = state.now + n.cooldownMs;
  const stats = enemyStats(enemy, content);
  const chance = hitChance(playerAccuracy(state, tech.skill, content), stats.evasion, content);
  if (roll(state, chance)) c.enemyHp -= n.damage;
}

function enemyAttack(state: GameState, c: CombatState, enemy: Enemy, content: ContentDb) {
  const stats = enemyStats(enemy, content);
  c.eAt = state.now + stats.intervalMs;
  const chance = hitChance(stats.accuracy, playerEvasion(state, content), content);
  if (roll(state, chance)) c.hp -= stats.damage;
}

/** An enemy fell: count it, let the player recover, and start the pause before the next. */
function enemyDown(state: GameState, c: CombatState, content: ContentDb) {
  const K = content.balance.K;
  c.enemyHp = 0;
  c.phase = 'respawn';
  c.respawnAt = state.now + Math.round(K.respawn * MS_PER_SECOND);
  const maxHp = playerMaxHp(state, content);
  c.hp = Math.min(maxHp, c.hp + K.zoneHpRegen * maxHp);
  c.chakra = playerMaxChakra(state, content);
  c.stamina = playerMaxStamina(state, content);
  bump(state, killsKey(c.enemy));
  emit(state, { type: 'enemyDefeated', enemy: c.enemy });
}

function regenerate(state: GameState, c: CombatState, content: ContentDb) {
  while (c.regenAt <= state.now) {
    c.regenAt += REGEN_MS;
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
 * Real-time combat. Every deadline in `state.combat` is an absolute time, so letting time pass
 * changes nothing and the system only wakes at deadlines: the end of a cast or recovery, the next
 * enemy attack, the next enemy appearing, the next regeneration.
 */
export const combatSystem: System = {
  nextEventIn(state) {
    const c = state.combat;
    if (!c) return null;
    const due = [c.regenAt];
    if (c.pPhase !== 'ready') due.push(c.pAt);
    if (c.phase === 'fight') due.push(c.eAt, ...(c.pPhase === 'ready' ? [state.now] : []));
    else due.push(c.respawnAt);
    return Math.max(0, Math.min(...due) - state.now);
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
      if (c.pPhase === 'recover' && c.pAt <= state.now) c.pPhase = 'ready';
      if (c.phase === 'respawn') {
        if (c.respawnAt > state.now) return;
        c.phase = 'fight';
        c.enemyHp = enemyStats(enemy, content).maxHp;
        c.eAt = state.now + enemyStats(enemy, content).intervalMs;
      }
      if (c.pPhase === 'cast' && c.pAt <= state.now) resolveCast(state, c, enemy, content, rules);
      else if (c.pPhase === 'ready') playerAct(state, c, enemy, content, rules);
      else if (c.eAt <= state.now) {
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
