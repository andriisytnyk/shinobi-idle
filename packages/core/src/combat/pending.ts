import type { ContentDb } from '@shinobi/content';
import { actingBody } from '../performer.ts';
import { gainXp, grantMastery } from '../progression.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { CombatState, Pending } from './types.ts';

/**
 * What a clone's fight has earned and not yet been paid: a clone's fight pays only when the clone
 * wins it. Skill XP is kept as the raw amount and Mastery as the amount handed to `grantMastery`,
 * so modifiers apply at the moment of payment. The state holds it (`CombatState.pending`).
 */

/** Whether the fight the state holds (the one of the performer being computed) is a clone's. */
export const cloneFights = (state: GameState): boolean =>
  state.combat !== null && actingBody(state) !== null;

const MAX = 1e15;

function bucket(c: CombatState): Pending {
  return (c.pending ??= { xp: {}, mastery: {} });
}

/** Skill XP earned in a fight: paid at once for the character, kept for the win for a clone. */
export function earnXp(
  state: GameState,
  skill: string,
  amount: number,
  content: ContentDb,
  rules: Rules,
): void {
  const c = state.combat;
  if (c && cloneFights(state)) {
    if (amount > 0) {
      const p = bucket(c);
      p.xp[skill] = Math.min(MAX, (p.xp[skill] ?? 0) + amount);
    }
    return;
  }
  gainXp(state, skill, amount, content, rules);
}

/** Mastery earned in a fight: paid at once for the character, kept for the win for a clone. */
export function earnMastery(
  state: GameState,
  c: CombatState,
  clone: boolean,
  key: string,
  skill: string,
  amount: number,
  content: ContentDb,
  rules: Rules,
): void {
  if (!clone) return grantMastery(state, key, skill, amount, content, rules);
  if (!(amount > 0)) return;
  const p = bucket(c);
  const entry = (p.mastery[key] ??= { skill, amount: 0 });
  entry.amount = Math.min(MAX, entry.amount + amount);
}

/** Pays what the clone's fight has kept, and empties it. */
export function payPending(
  state: GameState,
  c: CombatState,
  content: ContentDb,
  rules: Rules,
): void {
  const p = c.pending;
  if (!p) return;
  delete c.pending;
  for (const [skill, amount] of Object.entries(p.xp)) gainXp(state, skill, amount, content, rules);
  for (const [key, m] of Object.entries(p.mastery)) {
    grantMastery(state, key, m.skill, m.amount, content, rules);
  }
}

/** The clone lost: what its fight kept is gone. */
export function dropPending(c: CombatState): void {
  delete c.pending;
}

/** The slot's action ends (dispelled or replaced): the player chose to stop, so what was earned is paid. */
export function payOnStop(state: GameState, slot: number, content: ContentDb, rules: Rules): void {
  const c = state.combat;
  if (c?.owner === slot) payPending(state, c, content, rules);
}
