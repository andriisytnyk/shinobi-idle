import { FIRST_FIGHT_FLAG, type ContentDb } from '@shinobi/content';
import { fightData } from './fight-data.ts';
import type { ActionKind } from '../actions.ts';
import { MS_PER_HOUR, rate } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import type { Req } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import { earnXp, payOnStop } from './pending.ts';
import { ensurePouch, refillPouch } from './pouch.ts';
import { fightBusyReason, newCombat, newOperation } from './system.ts';
import { entryOf, fightTarget, zoneBlocked, zoneRequirement } from './zones.ts';

/** Combat XP of one tick against the enemy being fought. Combat XP is paid by time, at the fight's own (full) speed, whoever fights. */
function payTick(state: GameState, fallback: string, content: ContentDb, rules: Rules): void {
  const entry = entryOf(content, state.combat?.enemy ?? fallback);
  if (!entry) return;
  const K = content.balance.K;
  const perTick = (rate(entry.cl, content) * K.combat.xpTickMs) / MS_PER_HOUR;
  // `style` is the skill of the technique last used (a basic attack's style before any); every other key is a skill.
  for (const [key, mult] of Object.entries(K.combatXp)) {
    const skill = key === 'style' ? (state.combat?.style ?? fightData(content).basicSkill) : key;
    if (skill) earnXp(state, skill, mult * perTick, content, rules);
  }
}

/**
 * Fighting in a zone, or an enemy by its own id. The slot holds the action; the fight itself
 * lives in `state.combat` and is driven by the combat system. A cycle of this action is one tick
 * of combat XP.
 */
export const fightKind: ActionKind = {
  has: (id, content) => fightTarget(content, id) !== null,
  requirements(_state, id, content): Req | null {
    // An enemy id is gated like the zone that holds the enemy.
    const zone = indexOf(content).zones.get(id) ?? indexOf(content).zoneByEnemy.get(id);
    return zone ? zoneRequirement(zone) : null;
  },
  blocked(state, id, content, _rules, slot) {
    const busy = fightBusyReason(state, slot, content);
    if (busy) return busy;
    // A region zone is fought only once its cell has been explored.
    const zone = indexOf(content).zones.get(id) ?? indexOf(content).zoneByEnemy.get(id);
    return zone ? zoneBlocked(state, zone, content) : null;
  },
  intervalMs: (_state, _id, content) => content.balance.K.combat.xpTickMs,
  fullSpeed: true,

  complete(state, id, content, rules) {
    payTick(state, fightTarget(content, id)?.enemy.id ?? id, content, rules);
  },

  start(state, slot, id, content, rules) {
    const target = fightTarget(content, id);
    if (!target) return;
    // The pouch is topped up from the bank on the way out.
    ensurePouch(state, content);
    refillPouch(state, content);
    state.combat = newCombat(state, target.enemy, content, rules, slot);
    // The first fight opens Vitality and Evasion, whose skills train only in combat.
    state.flags[FIRST_FIGHT_FLAG] = true;
  },

  stop(state, slot, _id, content, rules) {
    // Only the slot that owns the fight ends it; a clone dispelled mid-fight is paid what it earned.
    payOnStop(state, slot, content, rules);
    if (state.combat?.owner === slot) state.combat = null;
  },
};

/**
 * An operation: the fights of its stages in order, with partial recovery between them and no
 * refill of the pouch. Finishing it raises its first-clear flag; a defeat or a stop resets the run.
 */
export const operationKind: ActionKind = {
  has: (id, content) => indexOf(content).operations.has(id),
  requirements: (_state, id, content): Req | null =>
    indexOf(content).operations.get(id)?.unlock ?? null,
  blocked: (state, _id, content, _rules, slot) => fightBusyReason(state, slot, content),
  intervalMs: (_state, _id, content) => content.balance.K.combat.xpTickMs,
  fullSpeed: true,

  complete(state, id, content, rules) {
    payTick(state, id, content, rules);
  },

  start(state, slot, id, content, rules) {
    const op = indexOf(content).operations.get(id);
    if (!op) return;
    // The pouch is packed once, for the whole run.
    ensurePouch(state, content);
    refillPouch(state, content);
    state.combat = newOperation(state, op, content, rules, slot);
    state.flags[FIRST_FIGHT_FLAG] = true;
  },

  stop(state, slot, _id, content, rules) {
    // Only the slot that owns the fight ends it; a clone dispelled mid-fight is paid what it earned.
    payOnStop(state, slot, content, rules);
    if (state.combat?.owner === slot) state.combat = null;
  },
};
