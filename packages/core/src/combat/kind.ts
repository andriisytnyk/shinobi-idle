import { stopSlot, type ActionKind } from '../actions.ts';
import { MS_PER_HOUR, MS_PER_SECOND, rate } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { gainXp } from '../progression.ts';
import { FIGHT_KIND, newCombat } from './system.ts';

/**
 * Combat XP is paid by time, once per this long, so it follows the slot's speed share and lands
 * at fixed moments whatever the chunking of `advance`.
 */
export const COMBAT_XP_TICK_MS = MS_PER_SECOND;

/**
 * Fighting an enemy. The slot holds the action; the fight itself lives in `state.combat` and is
 * driven by the combat system. A cycle of this action is one tick of combat XP.
 */
export const fightKind: ActionKind = {
  has: (id, content) => indexOf(content).enemies.has(id),
  requirements: () => null,
  intervalMs: () => COMBAT_XP_TICK_MS,

  complete(state, id, content, rules) {
    const enemy = indexOf(content).enemies.get(id);
    if (!enemy) return;
    const K = content.balance.K;
    const perTick = (rate(enemy.cl, content) * COMBAT_XP_TICK_MS) / MS_PER_HOUR;
    gainXp(state, state.combat?.style ?? 'tai', K.combatXp.style * perTick, content, rules);
    gainXp(state, 'vit', K.combatXp.vit * perTick, content, rules);
    gainXp(state, 'eva', K.combatXp.eva * perTick, content, rules);
  },

  start(state, slot, id, content, rules) {
    const enemy = indexOf(content).enemies.get(id);
    if (!enemy) return;
    // One fight at a time: a fight already running in another slot gives way.
    state.slots.forEach((other, index) => {
      if (index !== slot && other.action?.kind === FIGHT_KIND) {
        stopSlot(state, index, 'replaced', content, rules);
      }
    });
    state.combat = newCombat(state, enemy, content);
  },

  stop(state) {
    state.combat = null;
  },
};
