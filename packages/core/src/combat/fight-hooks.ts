import { applyPoison, alive, heavyBlow, roll, secWork, speed } from './fight.ts';
import { addEffect, findEffect, isSuppressed } from './fight-effects.ts';
import type { Combatant, FightCtx, FightHook } from './fight-types.ts';
import { secMs } from './numbers.ts';
import { needOf, TICK_MS, workOf } from './units.ts';

/*
 * The enemy traits as fight hooks. Each is keyed by its trait id and keeps its state in the
 * combatant (effects, timers, data), so a boss special can be added the same way. Pack has no
 * hook: it is a property of the encounter, which spawns several bodies.
 */

/** Armour: incoming damage is cut, unless a pierce hit has switched the armour off. */
const armor: FightHook = {
  id: 'armor',
  stat: (ctx, c, stat) =>
    stat === 'damageTaken' && !isSuppressed(c, 'armor') ? 1 - ctx.content.balance.K.trait.armor : 1,
};

/** Evasive: evasion is multiplied, unless the body is bound. */
const evasive: FightHook = {
  id: 'evasive',
  stat: (ctx, c, stat) =>
    stat === 'evasion' && !isSuppressed(c, 'evasive') ? ctx.content.balance.K.trait.evasive : 1,
};

/** Regeneration: heals a share of maximum health every second; burning or poison stops it. */
const regen: FightHook = {
  id: 'regen',
  init(ctx, c) {
    addEffect(c, {
      kind: 'periodic',
      id: 'regen',
      src: 'trait:regen',
      until: null,
      mode: 'heal',
      amount: ctx.content.balance.K.trait.regenPct * c.maxHp,
      every: workOf(TICK_MS),
      next: ctx.fight.t + workOf(TICK_MS),
    });
  },
};

const casterTimer = (ctx: FightCtx, c: Combatant, seconds: number) => {
  c.timers.caster = { progress: 0, need: needOf(secMs(seconds)) };
};

/** Caster: every so often winds up a heavy blow; an interrupt or a stun cancels the wind-up. */
const caster: FightHook = {
  id: 'caster',
  init(ctx, c) {
    casterTimer(ctx, c, ctx.content.balance.K.trait.casterEvery);
    c.data['caster.cast'] = 0;
  },
  onTimer(ctx, c, name) {
    const K = ctx.content.balance.K;
    const timer = c.timers.caster;
    if (name !== 'caster' || !timer) return;
    if (c.data['caster.cast'] === 0) {
      c.data['caster.cast'] = 1;
      timer.need = needOf(secMs(K.trait.casterCast));
    } else {
      heavyBlow(ctx, c, c.damage * K.trait.casterMult);
      c.data['caster.cast'] = 0;
      timer.need = needOf(secMs(K.trait.casterEvery));
    }
  },
  onCancel(ctx, c) {
    c.data['caster.cast'] = 0;
    casterTimer(ctx, c, ctx.content.balance.K.trait.casterEvery);
  },
  castInfo(ctx, c) {
    const timer = c.timers.caster;
    if (!timer) return null;
    const rate = speed(ctx, c);
    return {
      kind: 'heavy',
      interruptible: true,
      casting: c.data['caster.cast'] === 1,
      inWork: rate > 0 ? Math.ceil(Math.max(0, timer.need - timer.progress) / rate) : null,
    };
  },
};

/** Illusionist: every so often tries to cut the player's accuracy; Meditation resists. */
const illusionist: FightHook = {
  id: 'illusionist',
  init(ctx, c) {
    c.timers.illusionist = {
      progress: 0,
      need: needOf(secMs(ctx.content.balance.K.trait.illusionEvery)),
    };
  },
  onTimer(ctx, _c, name) {
    if (name !== 'illusionist') return;
    const K = ctx.content.balance.K;
    if (roll(ctx.fight, ctx.fight.kit.med * K.illusionResist)) return;
    addEffect(ctx.fight.player, {
      kind: 'modifier',
      id: 'illusion',
      src: 'trait:illusionist',
      until: ctx.fight.t + secWork(K.trait.illusionDur),
      stat: 'accuracy',
      op: 'mul',
      value: K.trait.illusionAcc,
    });
    ctx.fight.tally.statuses.illusion = (ctx.fight.tally.statuses.illusion ?? 0) + 1;
  },
};

/** Hidden: the player's accuracy is cut for a while and the enemy's first blow is stronger. */
const hidden: FightHook = {
  id: 'hidden',
  init(ctx, c) {
    const K = ctx.content.balance.K;
    c.data['hidden.opening'] = 1;
    addEffect(ctx.fight.player, {
      kind: 'modifier',
      id: 'hidden',
      src: 'trait:hidden',
      until: ctx.fight.t + secWork(K.trait.hidden),
      stat: 'accuracy',
      op: 'mul',
      value: K.trait.hiddenAcc,
    });
  },
  working: (ctx) => findEffect(ctx.fight.player, 'hidden') !== undefined,
  onAttack(ctx, c, plan) {
    if (c.data['hidden.opening'] !== 1) return;
    c.data['hidden.opening'] = 0;
    // The opening blow, while the player has not yet found the enemy, is stronger and sure.
    if (findEffect(ctx.fight.player, 'hidden')) {
      const K = ctx.content.balance.K;
      plan.damage *= K.trait.hiddenFirst;
      plan.chance = K.hitMax;
    }
  },
};

/** Poisoner: a hit may poison the player. */
const poisoner: FightHook = {
  id: 'poisoner',
  onAttackHit(ctx, _c, target) {
    if (alive(target) && roll(ctx.fight, ctx.content.balance.K.trait.poisonChance)) {
      applyPoison(ctx, target, 'trait:poisoner');
    }
  },
};

/** The default set, in the order the hooks are consulted. */
export const defaultFightHooks: readonly FightHook[] = [
  armor,
  caster,
  evasive,
  regen,
  illusionist,
  hidden,
  poisoner,
];
