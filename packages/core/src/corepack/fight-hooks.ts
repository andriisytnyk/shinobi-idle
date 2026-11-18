import {
  alive,
  dealDamage,
  heavyBlow,
  hitChanceOf,
  rollHit,
  roll,
  secWork,
  spawnEnemies,
  speed,
} from '../combat/fight.ts';
import { addEffect, findEffect, isSuppressed, removeEffect } from '../combat/fight-effects.ts';
import { applyStatusById } from '../combat/fight-status.ts';
import type { Combatant, FightCtx, FightHook } from '../combat/fight-types.ts';
import { secMs } from '../combat/numbers.ts';
import { figure } from '../combat/need.ts';
import { needOf, TICK_MS, workOf } from '../combat/units.ts';

/*
 * The fight behaviour of the pack `core` that data cannot say: the enemy traits that cast, hide,
 * poison or dodge, and the boss specials. Each is a hook that the pack's data names (`hook` of a
 * trait, of a boss special), registered with the rule set like the hooks of any other pack. A hook
 * keeps its state in the combatant (effects, timers, data), so a saved fight holds it, and it
 * reads the numbers other hooks publish as data keys of the combatant, never the hooks themselves.
 *
 * Armour and Regeneration are data (`mods`, `regen` of the trait), not hooks.
 */

/** A number of the `K.trait` row of the balance object. */
const trait = (K: { trait: Readonly<Record<string, number>> }, key: string): number =>
  figure(K.trait, key, 'trait');

/** A number of a row of `K.bossFx`; a number the data does not have is an error, not a zero. */
const bf = (ctx: FightCtx, row: string, key: string): number =>
  figure(
    (ctx.content.balance.K.bossFx as Record<string, Record<string, number> | undefined>)[row],
    key,
    `bossFx.${row}`,
  );

const timerOf = (ms: number) => ({ progress: 0, need: needOf(ms) });

// ---------- capabilities: numbers a special publishes for the trait it strengthens ----------

/** Publishes a number once: a body that already has it (a fresh start, a load) keeps it. */
const put = (c: Combatant, key: string, value: number): void => {
  if (c.data[key] === undefined) c.data[key] = value;
};

/** The caster's numbers a heavy-cast boss publishes (ms and a multiplier), read by the Caster trait. */
const CAST = {
  every: 'caster.everyMs',
  cast: 'caster.castMs',
  mult: 'caster.mult',
  stun: 'caster.stunMs',
};
/** The share of evasion at no health a drunken boss ramps to, read by the Evasive trait. */
const RAMP = 'evasive.rampTo';
/** The ms between illusions of a boss that casts them faster than an ordinary illusionist. */
const ILLUSION_EVERY = 'illusionist.everyMs';

/** A boss whose special is a heavy cast: the Caster trait uses the stronger numbers of the boss. */
const heavyCast: FightHook = {
  id: 'special:heavyCast',
  publish(ctx, c) {
    put(c, CAST.every, bf(ctx, 'heavyCast', 'everyMs'));
    put(c, CAST.cast, bf(ctx, 'heavyCast', 'castMs'));
    put(c, CAST.mult, bf(ctx, 'heavyCast', 'damageMult'));
    put(c, CAST.stun, bf(ctx, 'heavyCast', 'stunMs'));
  },
};

/** A boss whose evasion grows as its health falls: the Evasive trait ramps to the boss's number. */
const evasionByMissingHp: FightHook = {
  id: 'special:evasionByMissingHp',
  publish(ctx, c) {
    put(c, RAMP, bf(ctx, 'drunkenEvasion', 'maxMult'));
  },
};

/** The Nameless casts illusions faster than an ordinary illusionist. */
const illusion: FightHook = {
  id: 'special:illusion',
  publish(ctx, c) {
    put(c, ILLUSION_EVERY, bf(ctx, 'illusion', 'everyMs'));
  },
};

// ---------- traits ----------

/** Evasive: evasion is multiplied, unless the body is bound; a ramping boss replaces the flat factor. */
const evasive: FightHook = {
  id: 'trait:evasive',
  stat(ctx, c, stat) {
    if (stat !== 'evasion' || isSuppressed(c, 'evasive')) return 1;
    const flat = trait(ctx.content.balance.K, 'evasive');
    const ramp = c.data[RAMP];
    if (ramp === undefined) return flat;
    // From the trait's factor at full health to the special's at none.
    const missing = c.maxHp > 0 ? 1 - Math.max(0, c.hp) / c.maxHp : 0;
    return flat + (ramp - flat) * missing;
  },
};

/** The caster's numbers: the trait's own, or the stronger ones a heavy-cast boss published. */
function casterNumbers(
  ctx: FightCtx,
  c: Combatant,
): { every: number; cast: number; mult: number; stun: number } {
  const every = c.data[CAST.every];
  if (every !== undefined) {
    return {
      every,
      cast: c.data[CAST.cast] ?? 0,
      mult: c.data[CAST.mult] ?? 1,
      stun: c.data[CAST.stun] ?? 0,
    };
  }
  const K = ctx.content.balance.K;
  return {
    every: secMs(trait(K, 'casterEvery')),
    cast: secMs(trait(K, 'casterCast')),
    mult: trait(K, 'casterMult'),
    stun: 0,
  };
}

const casterTimer = (ctx: FightCtx, c: Combatant) => {
  c.timers.caster = { progress: 0, need: needOf(casterNumbers(ctx, c).every) };
};

/** Caster: every so often winds up a heavy blow; an interrupt or a stun cancels the wind-up. */
const caster: FightHook = {
  id: 'trait:caster',
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
      const struck = heavyBlow(ctx, c, c.damage * n.mult);
      c.data['caster.cast'] = 0;
      timer.need = needOf(n.every);
      // A heavy cast of a boss stuns whoever it lands on.
      if (struck !== null && n.stun > 0) {
        // The stun is the stun of the data, for the boss's own time, without the report or a cancelled cast.
        applyStatusById(ctx, struck, 'stun', 'special:heavyCast', {
          durationMs: n.stun,
          refresh: 'replace',
          silent: true,
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
  id: 'trait:illusionist',
  init(ctx, c) {
    const K = ctx.content.balance.K;
    // The Nameless casts faster than an ordinary illusionist.
    const every = c.data[ILLUSION_EVERY];
    const need = every !== undefined ? needOf(every) : needOf(secMs(trait(K, 'illusionEvery')));
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
      until: ctx.fight.t + secWork(trait(K, 'illusionDur')),
      stat: 'accuracy',
      op: 'mul',
      value: trait(K, 'illusionAcc'),
    });
    ctx.fight.tally.statuses.illusion = (ctx.fight.tally.statuses.illusion ?? 0) + 1;
  },
};

/** The body hides: the player's accuracy is cut for a while and the body's next blow is stronger. */
function hide(ctx: FightCtx, c: Combatant, src = 'trait:hidden'): void {
  const K = ctx.content.balance.K;
  c.data['hidden.opening'] = 1;
  addEffect(ctx.fight.player, {
    kind: 'modifier',
    id: 'hidden',
    src,
    until: ctx.fight.t + secWork(trait(K, 'hidden')),
    stat: 'accuracy',
    op: 'mul',
    value: trait(K, 'hiddenAcc'),
  });
}

/** Hidden: the player's accuracy is cut for a while and the enemy's first blow is stronger. */
const hidden: FightHook = {
  id: 'trait:hidden',
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
      plan.damage *= trait(K, 'hiddenFirst');
      plan.chance = K.hitMax;
    }
  },
};

/** Poisoner: a hit may poison the player. */
const poisoner: FightHook = {
  id: 'trait:poisoner',
  onAttackHit(ctx, _c, target) {
    if (alive(target) && roll(ctx.fight, trait(ctx.content.balance.K, 'poisonChance'))) {
      applyStatusById(ctx, target, 'poison', 'trait:poisoner');
    }
  },
};

// ---------- boss specials ----------

/** One attack of a boss technique: it must hit like any attack, then lands for `damage`. */
function strike(ctx: FightCtx, c: Combatant, damage: number): void {
  const player = ctx.fight.player;
  if (!rollHit(ctx, player, hitChanceOf(ctx, c, player))) return;
  dealDamage(ctx, player, damage, c.id);
}

/** Wolves: the leader calls the pack back at intervals while he lives. */
const packRespawn: FightHook = {
  id: 'special:packRespawn',
  leader: () => true,
  init(ctx, c) {
    c.timers.pack = timerOf(bf(ctx, 'wolfPack', 'everyMs'));
  },
  onTimer(ctx, c, name) {
    if (name !== 'pack' || !alive(c)) return;
    const { fight, content, rules } = ctx;
    const index = fight.encounter.spawns.findIndex((s) =>
      s.specials.includes('special:packMember'),
    );
    if (index < 0) return;
    const living = fight.enemies.filter(
      (e) => alive(e) && e.specials.includes('special:packMember'),
    );
    const missing = bf(ctx, 'wolfPack', 'count') - living.length;
    if (missing > 0) spawnEnemies(fight, index, content, rules, missing);
  },
};

/** The rival: techniques of the nature that beats the player's, and a signature that opens the fight. */
function rival(id: string, key: 'rivalDuel' | 'rivalTournament'): FightHook {
  return {
    id,
    init(ctx, c) {
      const techniques = bf(ctx, key, 'techniques');
      for (let i = 0; i < techniques; i++) {
        const timer = timerOf(bf(ctx, key, 'everyMs'));
        timer.progress = Math.floor((timer.need * (i + 1)) / (techniques + 1));
        c.timers[`rival.${i}`] = timer;
      }
      const sig = timerOf(bf(ctx, key, 'sigEveryMs'));
      sig.progress = Math.max(0, sig.need - needOf(bf(ctx, key, 'sigOpenMs')));
      c.timers['rival.sig'] = sig;
    },
    onTimer(ctx, c, name) {
      if (name === 'rival.sig') strike(ctx, c, c.damage * bf(ctx, key, 'sigMult'));
      else if (name.startsWith('rival.')) strike(ctx, c, c.damage * bf(ctx, key, 'mult'));
    },
    habituation: (ctx) =>
      key === 'rivalTournament' ? bf(ctx, 'rivalTournament', 'habituationMult') : 1,
  };
}

/** The twins: while both fight, a poison mist hangs over the player. */
const twins: FightHook = {
  id: 'special:twins',
  init(ctx, c) {
    const { fight, content } = ctx;
    const K = content.balance.K;
    const bodies = fight.enemies.filter((e) => e.specials.includes('special:twins'));
    if (bodies.length < bf(ctx, 'twins', 'count') || findEffect(fight.player, 'twinMist')) return;
    addEffect(fight.player, {
      kind: 'periodic',
      id: 'twinMist',
      src: c.id,
      until: null,
      mode: 'damage',
      amount: K.poison.pctPerSec * fight.player.maxHp * bf(ctx, 'twins', 'mistMult'),
      every: workOf(TICK_MS),
      next: fight.t + workOf(TICK_MS),
    });
  },
  onLeave(ctx) {
    removeEffect(ctx.fight.player, 'twinMist');
  },
};

/** The mist fugitive: hides again at intervals and binds the player in a water prison. */
const rehide: FightHook = {
  id: 'special:rehide',
  init(ctx, c) {
    c.timers.rehide = timerOf(bf(ctx, 'mistRehide', 'everyMs'));
  },
  onTimer(ctx, c, name) {
    if (name !== 'rehide') return;
    const K = ctx.content.balance.K;
    // A sensed body cannot hide; the prison closes all the same.
    if (!findEffect(c, 'revealed')) hide(ctx, c, 'special:rehide');
    applyStatusById(ctx, ctx.fight.player, 'bind', 'special:rehide', { value: K.bindEva });
  },
};

/**
 * The hooks of the pack. The specials that only strengthen a trait come first, so the trait's hook
 * finds their numbers when it starts.
 */
export const coreFightHooks: readonly FightHook[] = [
  heavyCast,
  evasionByMissingHp,
  illusion,
  caster,
  evasive,
  illusionist,
  hidden,
  poisoner,
  packRespawn,
  rival('special:rival.duel', 'rivalDuel'),
  rival('special:rival.tournament', 'rivalTournament'),
  twins,
  rehide,
];
