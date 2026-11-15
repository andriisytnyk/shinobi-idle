import {
  alive,
  applyBind,
  dealDamage,
  hitChanceOf,
  rollHit,
  secWork,
  spawnEnemies,
} from './fight.ts';
import { addEffect, findEffect, removeEffect } from './fight-effects.ts';
import type { Combatant, FightCtx, FightHook } from './fight-types.ts';
import { secMs } from './numbers.ts';
import { needOf, TICK_MS, workOf } from './units.ts';

/*
 * Boss specials as fight hooks. A boss entry names its special in the content data; the
 * encounter gives the bodies the matching hook id, and the numbers come from `K.bossFx`.
 */

/** The body hides: the player's accuracy is cut for a while and the body's next blow is stronger. */
export function hide(ctx: FightCtx, c: Combatant, src = 'trait:hidden'): void {
  const K = ctx.content.balance.K;
  c.data['hidden.opening'] = 1;
  addEffect(ctx.fight.player, {
    kind: 'modifier',
    id: 'hidden',
    src,
    until: ctx.fight.t + secWork(K.trait.hidden),
    stat: 'accuracy',
    op: 'mul',
    value: K.trait.hiddenAcc,
  });
}

const timerOf = (ms: number) => ({ progress: 0, need: needOf(ms) });

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
    c.timers.pack = timerOf(ctx.content.balance.K.bossFx.wolfPack.everyMs);
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
    const missing = content.balance.K.bossFx.wolfPack.count - living.length;
    if (missing > 0) spawnEnemies(fight, index, content, rules, missing);
  },
};

/** The rival: techniques of the nature that beats the player's, and a signature that opens the fight. */
function rival(id: string, key: 'rivalDuel' | 'rivalTournament'): FightHook {
  return {
    id,
    init(ctx, c) {
      const K = ctx.content.balance.K;
      const fx = K.bossFx[key];
      for (let i = 0; i < fx.techniques; i++) {
        const timer = timerOf(fx.everyMs);
        timer.progress = Math.floor((timer.need * (i + 1)) / (fx.techniques + 1));
        c.timers[`rival.${i}`] = timer;
      }
      const sig = timerOf(fx.sigEveryMs);
      sig.progress = Math.max(0, sig.need - needOf(secMs(2)));
      c.timers['rival.sig'] = sig;
    },
    onTimer(ctx, c, name) {
      const fx = ctx.content.balance.K.bossFx[key];
      if (name === 'rival.sig') strike(ctx, c, c.damage * fx.sigMult);
      else if (name.startsWith('rival.')) strike(ctx, c, c.damage * fx.mult);
    },
    habituation: (ctx) =>
      key === 'rivalTournament' ? ctx.content.balance.K.bossFx.rivalTournament.habituationMult : 1,
  };
}

/** The twins: while both fight, a poison mist hangs over the player. */
const twins: FightHook = {
  id: 'special:twins',
  init(ctx, c) {
    const { fight, content } = ctx;
    const K = content.balance.K;
    const bodies = fight.enemies.filter((e) => e.specials.includes('special:twins'));
    if (bodies.length < K.bossFx.twins.count || findEffect(fight.player, 'twinMist')) return;
    addEffect(fight.player, {
      kind: 'periodic',
      id: 'twinMist',
      src: c.id,
      until: null,
      mode: 'damage',
      amount: K.poison.pctPerSec * fight.player.maxHp * K.bossFx.twins.mistMult,
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
    c.timers.rehide = timerOf(ctx.content.balance.K.bossFx.mistRehide.everyMs);
  },
  onTimer(ctx, c, name) {
    if (name !== 'rehide') return;
    const K = ctx.content.balance.K;
    // A sensed body cannot hide; the prison closes all the same.
    if (!findEffect(c, 'revealed')) hide(ctx, c, 'special:rehide');
    applyBind(ctx, ctx.fight.player, K.bindEva, 'special:rehide');
  },
};

/** The Body Replacement: every so often one hit is negated; it needs no slot. */
const passiveNegate: FightHook = {
  id: 'passiveNegate',
  init(ctx, c) {
    const tech = ctx.fight.kit.techniques.find((t) => t.fx.kind === 'passiveNegate');
    if (tech) c.timers.negate = timerOf(tech.fx.everyMs);
  },
  onTimer(_ctx, c, name) {
    if (name === 'negate' && c.decoys < 1) c.decoys = 1;
  },
};

/**
 * The boss hooks. Four specials are an enhanced trait and need no hook of their own: the heavy
 * cast and the drunken evasion change the numbers of the Caster and Evasive hooks (which read the
 * `special:heavyCast` and `special:evasionByMissingHp` ids), the Nameless does the same for the
 * Illusionist, and its flight is a share of health on the spawn.
 */
export const bossFightHooks: readonly FightHook[] = [
  packRespawn,
  rival('special:rival.duel', 'rivalDuel'),
  rival('special:rival.tournament', 'rivalTournament'),
  twins,
  rehide,
  passiveNegate,
];
