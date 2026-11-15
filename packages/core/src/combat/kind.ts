import { stopSlot, type ActionKind } from '../actions.ts';
import { MS_PER_HOUR, rate } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { gainXp } from '../progression.ts';
import { FIGHT_KIND, newCombat } from './system.ts';

/**
 * Fighting an enemy. The slot holds the action; the fight itself lives in `state.combat` and is
 * driven by the combat system. A cycle of this action is one tick of combat XP.
 */
export const fightKind: ActionKind = {
  has: (id, content) => indexOf(content).enemies.has(id),
  requirements: () => null,
  // Combat XP is paid by time, once per tick, so it follows the slot share like all combat time.
  intervalMs: (_state, _id, content) => content.balance.K.combat.xpTickMs,

  complete(state, id, content, rules) {
    const enemy = indexOf(content).enemies.get(id);
    if (!enemy) return;
    const K = content.balance.K;
    const perTick = (rate(enemy.cl, content) * K.combat.xpTickMs) / MS_PER_HOUR;
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
    // The first fight opens Vitality and Evasion, whose skills train only in combat.
    state.flags.firstFight = true;
  },

  stop(state) {
    state.combat = null;
  },
};
