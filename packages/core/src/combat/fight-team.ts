import type { NatureId } from '@shinobi/content';
import { alive, cancelCasts, count, dealDamage, secWork, wheelFactor } from './fight.ts';
import { addEffect } from './fight-effects.ts';
import type { Combatant, FightCtx, FightHook, TeamSupport } from './fight-types.ts';
import { TEAM_HOOK } from './fight-team-id.ts';
import { needOf, TICK_MS, workOf } from './units.ts';

/*
 * Team support in a team mission's fight, as a hook of the player's own: every `everyMs` each
 * teammate hits the first living enemy with an attack of their nature, and the nature's state is
 * put on the enemy (burn, wet, stun) under the same effect ids the player's techniques use, so the
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
  const { fight, content } = ctx;
  const K = content.balance.K;
  const now = fight.t;
  if (state === 'burn') {
    const amount = (K.burn.share * base) / K.burn.dur;
    addEffect(target, {
      kind: 'periodic',
      id: 'burn',
      src,
      until: now + secWork(K.burn.dur),
      suppresses: 'regen',
      mode: 'damage',
      amount,
      base: amount,
      every: workOf(TICK_MS),
      next: now + workOf(TICK_MS),
    });
    count(fight.tally.statuses, 'burn');
  } else if (state === 'wet') {
    addEffect(target, {
      kind: 'modifier',
      id: 'wet',
      src,
      until: now + secWork(K.wet.dur),
      stat: 'speed',
      op: 'mul',
      value: 1 - K.wet.slow,
    });
    count(fight.tally.statuses, 'wet');
  } else if (state === 'stun') {
    addEffect(target, {
      kind: 'modifier',
      id: 'stun',
      src,
      until: now + secWork(K.stun.D),
      stat: 'speed',
      op: 'mul',
      value: 0,
    });
    cancelCasts(ctx, target);
    count(fight.tally.statuses, 'stun');
  }
}

/** The state a nature's teammate attack applies, from the balance extension. */
export const supportState = (ctx: FightCtx, nature: NatureId): string | null =>
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
    const src = `team:${support.nature}`;
    const raw = c.damage * support.damage * wheelFactor(support.nature, target.nature, ctx.content);
    dealDamage(ctx, target, raw, src);
    if (alive(target)) applyState(ctx, supportState(ctx, support.nature), target, raw, src);
  },
};
