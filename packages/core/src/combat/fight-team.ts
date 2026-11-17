import { alive, dealDamage, wheelFactor } from './fight.ts';
import { fightData } from './fight-data.ts';
import { applyStatus } from './fight-status.ts';
import type { Combatant, FightCtx, FightHook, TeamSupport } from './fight-types.ts';
import { TEAM_HOOK } from './fight-team-id.ts';
import { needOf } from './units.ts';

/*
 * Team support in a team mission's fight, as a hook of the player's own: every `everyMs` each
 * teammate hits the first living enemy with an attack of their nature, and the nature's state is
 * put on the enemy under the same effect ids the player's techniques use, so the
 * player's techniques find them and the status combos can fire. The hit always lands. The
 * encounter carries the supports; the numbers come from `K.team`.
 */

const timerName = (index: number): string => `team.${index}`;

/** Puts the state of the teammate's nature on `target`, the way a technique of that nature does. */
function applyState(
  ctx: FightCtx,
  state: string | null | undefined,
  target: Combatant,
  base: number,
  src: string,
): void {
  const def = state ? fightData(ctx.content).byState.get(state) : undefined;
  // A teammate's hit has no technique rank: a duration that depends on it takes the lowest the data gives.
  if (def) applyStatus(ctx, target, def, src, { base, rank: null });
}

/** The state a nature's teammate attack applies, from the balance extension. */
export const supportState = (ctx: FightCtx, nature: string): string | null =>
  ctx.content.balance.K.team.states[nature] ?? null;

export const teamSupportHook: FightHook = {
  id: TEAM_HOOK,
  init(ctx, c) {
    const supports = ctx.fight.encounter.support ?? [];
    supports.forEach((s, i) => {
      // The second teammate starts half a period after the first.
      c.timers[timerName(i)] = { progress: 0, need: needOf(s.everyMs + (i * s.everyMs) / 2) };
    });
  },
  onTimer(ctx, c, name) {
    const index = (ctx.fight.encounter.support ?? []).findIndex((_, i) => timerName(i) === name);
    const support: TeamSupport | undefined = ctx.fight.encounter.support?.[index];
    const timer = c.timers[name];
    if (!support || !timer) return;
    timer.need = needOf(support.everyMs);
    const target = ctx.fight.enemies.find(alive);
    if (!target) return;
    // A bare id: a damage source is read back by the pack its id names, and no pack is called `team`.
    const src = `team.${support.nature}`;
    const raw = c.damage * support.damage * wheelFactor(support.nature, target.nature, ctx.content);
    dealDamage(ctx, target, raw, src);
    if (alive(target)) applyState(ctx, supportState(ctx, support.nature), target, raw, src);
  },
};
