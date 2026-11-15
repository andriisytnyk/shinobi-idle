import { applyPoison, alive, heavyBlow, roll, secWork, speed } from './fight.ts';
import { bossFightHooks, hide } from './fight-boss.ts';
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

/** Evasive: evasion is multiplied, unless the body is bound; the drunken fighter's own ramp replaces the flat factor. */
const evasive: FightHook = {
  id: 'evasive',
  stat(ctx, c, stat) {
    if (stat !== 'evasion' || isSuppressed(c, 'evasive')) return 1;
    const K = ctx.content.balance.K;
    if (!c.specials.includes('special:evasionByMissingHp')) return K.trait.evasive;
    // From the trait's factor at full health to the special's at none.
    const missing = c.maxHp > 0 ? 1 - Math.max(0, c.hp) / c.maxHp : 0;
    return K.trait.evasive + (K.bossFx.drunkenEvasion.maxMult - K.trait.evasive) * missing;
  },
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

/** The caster's numbers: the trait's own, or the stronger ones of a boss whose special is a heavy cast. */
function casterNumbers(
  ctx: FightCtx,
  c: Combatant,
): { every: number; cast: number; mult: number; stun: number } {
  const K = ctx.content.balance.K;
  if (c.specials.includes('special:heavyCast')) {
    const fx = K.bossFx.heavyCast;
    return { every: fx.everyMs, cast: fx.castMs, mult: fx.damageMult, stun: fx.stunMs };
  }
  const t = K.trait;
  return { every: secMs(t.casterEvery), cast: secMs(t.casterCast), mult: t.casterMult, stun: 0 };
}

const casterTimer = (ctx: FightCtx, c: Combatant) => {
  c.timers.caster = { progress: 0, need: needOf(casterNumbers(ctx, c).every) };
};

/** Caster: every so often winds up a heavy blow; an interrupt or a stun cancels the wind-up. */
const caster: FightHook = {
  id: 'caster',
  init(ctx, c) {
    casterTimer(ctx, c);
    c.data['caster.cast'] = 0;
  },
  onTimer(ctx, c, name) {
    const timer = c.timers.caster;
    if (name !== 'caster' || !timer) return;
    const n = casterNumbers(ctx, c);
    if (c.data['caster.cast'] === 0) {
      c.data['caster.cast'] = 1;
      timer.need = needOf(n.cast);
    } else {
      const landed = heavyBlow(ctx, c, c.damage * n.mult);
      c.data['caster.cast'] = 0;
      timer.need = needOf(n.every);
      // A heavy cast of a boss stuns whoever it lands on.
      if (landed && n.stun > 0) {
        addEffect(ctx.fight.player, {
          kind: 'modifier',
          id: 'stun',
          src: 'special:heavyCast',
          until: ctx.fight.t + workOf(n.stun),
          stat: 'speed',
          op: 'mul',
          value: 0,
        });
      }
    }
  },
  onCancel(ctx, c) {
    c.data['caster.cast'] = 0;
    casterTimer(ctx, c);
  },
  castInfo(ctx, c) {
    const timer = c.timers.caster;
    if (!timer) return null;
    const rate = speed(ctx, c);
    const n = casterNumbers(ctx, c);
    return {
      kind: 'heavy',
      interruptible: true,
      casting: c.data['caster.cast'] === 1,
      inWork: rate > 0 ? Math.ceil(Math.max(0, timer.need - timer.progress) / rate) : null,
      total: workOf(n.cast),
      mult: n.mult,
    };
  },
};

/** Illusionist: every so often tries to cut the player's accuracy; Meditation resists. */
const illusionist: FightHook = {
  id: 'illusionist',
  init(ctx, c) {
    const K = ctx.content.balance.K;
    // The Nameless casts faster than an ordinary illusionist.
    const need = c.specials.includes('special:illusion')
      ? needOf(K.bossFx.illusion.everyMs)
      : needOf(secMs(K.trait.illusionEvery));
    c.timers.illusionist = { progress: 0, need };
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
    hide(ctx, c);
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
  ...bossFightHooks,
];
