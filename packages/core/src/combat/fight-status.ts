import type { ContentDb } from '@shinobi/content';
import { addEffect, findEffect } from './fight-effects.ts';
import { balanceOf, fightData, secondsByRank, type StatusDef, type TagOp } from './fight-data.ts';
import { cancelCasts, count, dealDamage, roll, secWork } from './fight.ts';
import type { Combatant, Effect, FightCtx, FightState, KitTechnique } from './fight-types.ts';
import { TICK_MS, workOf } from './units.ts';

/*
 * Statuses, tags and combos as the fight plays them, from the data of the content (see
 * `fight-data.ts`). A status puts effects on a body; a tag says what a technique or tool does when
 * it hits; a combo says what a hit does to a body that is in a state. No id of any of them is
 * named here.
 */

/** What an application of a status can be told besides who it is applied to. */
export interface ApplyOptions {
  /** The damage of the hit that applies it, for a damage over time that is a share of the hit. */
  base?: number;
  /** Replaces the value of the status's first modifier (the strength of a bind). */
  value?: number;
  /** The rank of the technique, for a duration that depends on it; null: the lowest rank the table has. */
  rank?: string | null;
  /** Multiplies the duration (a combo that stretches the status). */
  scale?: number;
}

/** Puts the status of the content with this id on a combatant, if there is one. */
export function applyStatusById(
  ctx: FightCtx,
  target: Combatant,
  id: string,
  src: string,
  options: ApplyOptions = {},
): boolean {
  const def = fightData(ctx.content).statuses.get(id);
  if (!def) return false;
  applyStatus(ctx, target, def, src, options);
  return true;
}

/** The effect id of the `n`th effect of a status. */
const effectId = (def: StatusDef, n: number): string => (n === 0 ? def.id : `${def.id}#${n}`);

/** Whether an effect id is the id of a status or one of its later effects (`<id>#<n>`). */
export const ownsEffect = (statusId: string, effectIdOf: string): boolean =>
  effectIdOf === statusId || effectIdOf.startsWith(`${statusId}#`);

/** Takes a status (every effect it put on the body) off a combatant; true when there was one. */
export function removeStatus(c: Combatant, id: string): boolean {
  const before = c.effects.length;
  if (before === 0) return false;
  c.effects = c.effects.filter((e) => !ownsEffect(id, e.id));
  return c.effects.length !== before;
}

/** The effect a status put on a combatant under its own id, if it is there. */
export const statusEffect = (c: Combatant, def: StatusDef): Effect | undefined =>
  findEffect(c, def.id);

/**
 * Puts a status on a combatant. A second application refreshes the first (or adds a stack, up to
 * the status's limit); a periodic effect keeps its tick schedule. The effect is credited to `src`.
 * The caster cancels, and the report counts, as the status says.
 */
export function applyStatus(
  ctx: FightCtx,
  target: Combatant,
  def: StatusDef,
  src: string,
  options: ApplyOptions = {},
): void {
  const { fight, content } = ctx;
  const K = balanceOf(content);
  const now = fight.t;
  let length = 0;
  if (def.durationByRank !== null) {
    length = secWork(secondsByRank(content, def.durationByRank, options.rank ?? null));
  } else if (def.duration) length = secWork(def.duration(K));
  if (options.scale !== undefined) length *= options.scale;
  for (const [n, spec] of def.effects.entries()) {
    const id = effectId(def, n);
    const old = findEffect(target, id);
    const stacks = def.stacks > 1 ? Math.min(def.stacks, (old?.stacks ?? 0) + 1) : 0;
    const keep = def.suppresses === null ? {} : { suppresses: def.suppresses };
    if (spec.kind === 'modifier') {
      const unit = n === 0 && options.value !== undefined ? options.value : spec.value(K);
      // The stronger of two modifiers stays: a weaker bind never replaces a stronger one.
      const stronger = def.refresh === 'strongest' && old?.kind === 'modifier' && old.value < unit;
      const value = stronger ? old.value : stacks > 1 ? stackedValue(spec.op, unit, stacks) : unit;
      const until =
        def.refresh === 'longest'
          ? Math.max(now + length, old?.until ?? 0)
          : stronger
            ? old.until
            : now + length;
      addEffect(target, {
        kind: 'modifier',
        id,
        src: stronger ? old.src : src,
        until,
        ...keep,
        stat: spec.stat,
        op: spec.op,
        value,
        ...(stacks > 0 ? { stacks, unit } : {}),
      });
    } else {
      const a = spec.amount(K);
      const unit =
        spec.from === 'maxHp'
          ? a * target.maxHp
          : spec.over
            ? (a * (options.base ?? 0)) / spec.over(K)
            : a * (options.base ?? 0);
      const amount = stacks > 1 ? unit * stacks : unit;
      addEffect(target, {
        kind: 'periodic',
        id,
        src,
        until: now + length,
        ...keep,
        mode: 'damage',
        amount,
        ...(spec.from === 'hit' ? { base: amount } : {}),
        every: workOf(TICK_MS),
        next: now + workOf(TICK_MS),
        ...(stacks > 0 ? { stacks, unit } : {}),
      });
    }
  }
  if (def.interrupts) cancelCasts(ctx, target);
  const tally = def.tally;
  if (
    tally &&
    (!tally.whenSuppressing || (def.suppresses !== null && target.traits.includes(def.suppresses)))
  ) {
    count(fight.tally.statuses, tally.as);
  }
}

function stackedValue(op: 'mul' | 'add', unit: number, stacks: number): number {
  return op === 'mul' ? unit ** stacks : unit * stacks;
}

/** The first of a combatant's effects a status owns that holds periodic damage, for combos that strengthen it. */
function periodicOf(c: Combatant, id: string): Extract<Effect, { kind: 'periodic' }> | undefined {
  const e = findEffect(c, id);
  return e?.kind === 'periodic' ? e : undefined;
}

/** Runs the operations of a tag on a body: statuses applied, casts stopped. Returns whether any ran. */
export function runTagOps(
  ctx: FightCtx,
  target: Combatant,
  ops: readonly TagOp[],
  src: string,
  rank: string | null = null,
): void {
  const K = balanceOf(ctx.content);
  for (const op of ops) {
    if (op.op === 'status') {
      applyStatus(ctx, target, op.def, src, {
        rank,
        ...(op.value ? { value: op.value(K) } : {}),
      });
    } else if (cancelCasts(ctx, target, true)) ctx.fight.tally.interrupts++;
  }
}

/** Whether a combo whose rule is met fires: always for its guaranteed technique, else by chance. Counts it. */
function fires(fight: FightState, tech: KitTechnique, id: string): boolean {
  const yes = tech.guaranteedCombo === id || roll(fight, tech.comboChance);
  if (yes) count(fight.tally.combos, id);
  return yes;
}

/** The effect ids that stand for a combo's state on a body, resolved from the statuses of the content. */
function stateEffect(content: ContentDb, state: string): string | null {
  return fightData(content).byState.get(state)?.id ?? null;
}

/** What the combos of the content ask of a hit, read before the hit changes anything. */
export interface ComboPriors {
  /** The effect each combo needs on the target, as it was before the hit; undefined when not there. */
  prior: (Effect | undefined)[];
}

/** Whether a technique can trigger a combo: its skill is the combo's nature, or it carries the combo's tag. */
function triggers(tech: KitTechnique, nature: string | null, tag: string | null): boolean {
  return (nature !== null && tech.skill === nature) || (tag !== null && tech.tags.includes(tag));
}

export function comboPriors(ctx: FightCtx, tech: KitTechnique, target: Combatant): ComboPriors {
  const prior: (Effect | undefined)[] = [];
  for (const c of fightData(ctx.content).combos) {
    const id = triggers(tech, c.nature, c.tag) ? stateEffect(ctx.content, c.onState) : null;
    prior.push(id === null ? undefined : findEffect(target, id));
  }
  return { prior };
}

/**
 * The combos that stretch the status the technique itself applies: each that is triggered and fires
 * multiplies its duration. Evaluated at the moment the status is applied.
 */
export function comboScale(ctx: FightCtx, tech: KitTechnique, priors: ComboPriors): number {
  const K = balanceOf(ctx.content);
  let scale = 1;
  for (const [i, c] of fightData(ctx.content).combos.entries()) {
    if (c.kind !== 'lengthen' || !priors.prior[i]) continue;
    if (fires(ctx.fight, tech, c.id)) scale *= numberOf(K, c.id);
  }
  return scale;
}

function numberOf(K: Record<string, unknown>, id: string): number {
  const table = K.combo as Record<string, number>;
  return table[id] ?? 1;
}

/** The combos that act after the technique's own status: boost, a status of their own, a burst. */
export function runCombos(
  ctx: FightCtx,
  tech: KitTechnique,
  target: Combatant,
  priors: ComboPriors,
  base: number,
): void {
  const { fight, content } = ctx;
  const K = balanceOf(content);
  const data = fightData(content);
  for (const [i, c] of data.combos.entries()) {
    const prior = priors.prior[i];
    if (c.kind === 'lengthen' || !prior) continue;
    if (c.kind === 'boost') {
      const own = periodicOf(target, prior.id);
      if (!own || !fires(fight, tech, c.id)) continue;
      // The boost is applied to the effect's own strength, once, however many times it fires.
      const unit = own.base ?? own.amount;
      own.base = unit;
      own.amount = unit * numberOf(K, c.id);
      const status = data.byState.get(c.onState);
      if (status?.duration) own.until = fight.t + secWork(status.duration(K));
    } else if (c.kind === 'status') {
      if (c.status && fires(fight, tech, c.id)) {
        applyStatus(ctx, target, c.status, tech.id, { value: numberOf(K, c.id) });
      }
    } else if (fires(fight, tech, c.id)) {
      const id = stateEffect(content, c.onState);
      if (id !== null) removeStatus(target, id);
      dealDamage(ctx, target, numberOf(K, c.id) * base, tech.id);
    }
  }
}

/** Takes the effects a tag removes off the caster. */
export function removeTagged(c: Combatant, ids: readonly string[]): void {
  for (const id of ids) removeStatus(c, id);
}
