import type { Combatant, FightCtx, FightHook, FightState } from './fight-types.ts';
import { originOf } from './fight-origin.ts';
import { secMs } from './numbers.ts';
import { needOf, WORK_PER_MS } from './units.ts';

/*
 * Containment of the hooks of other packs, at the boundary: every call of a hook goes through
 * `guard`, which also checks what comes back (the value returned, the shape of what the hook left in
 * the combatant's `timers`, `data` and `effects`) and how often the hook runs. It knows nothing of
 * the phases of a fight, so it does not depend on how the fight loop is built.
 *
 * A hook of the pack `core` (and of the engine) may throw: that is a bug, and tests must see it. A
 * hook of any other pack must not be able to stop, hang or corrupt the engine by mistake: a call that
 * throws, a wrong value, a wrong shape, a timer that is too small or an event rate above the budget
 * ends the fight as a void outcome (no win, no loss, no loot, no Wound), names the pack and the hook,
 * and switches that hook off for the rule set until it is loaded again. The game goes on.
 * Deliberate sabotage of the state is out of scope.
 */

/** The pack a hook was registered by (the core pack's and the engine's hooks have none). */
export const packOf = (hook: FightHook): string => originOf(hook) ?? 'core';

/** A hook that the engine trusts to fail loudly: not one a pack added. */
export const trusted = (hook: FightHook): boolean => originOf(hook) === undefined;

/** Hooks switched off, by the registered entry (not by its id): a fault of one pack never switches off another's. */
const disabled = new WeakMap<readonly FightHook[], Set<FightHook>>();
const voids = new WeakMap<readonly FightHook[], number>();

export const isDisabled = (rules: readonly FightHook[], hook: FightHook): boolean =>
  disabled.get(rules)?.has(hook) ?? false;

/** How many hooks of this rule set are switched off; a body re-reads its hooks when it changes. */
export const disabledCount = (rules: readonly FightHook[]): number =>
  disabled.get(rules)?.size ?? 0;

/** How many fights this rule set has voided by a hook failure. */
export const voidCount = (rules: readonly FightHook[]): number => voids.get(rules) ?? 0;

/** Which hook armed each hook timer of a body, kept while the process lives (a loaded body falls back to the first hook with a timer handler). */
const armedBy = new WeakMap<Combatant, Map<string, FightHook>>();

/** The hook that armed the timer `name` of a body, if known. */
export const timerOwner = (c: Combatant, name: string): FightHook | undefined =>
  armedBy.get(c)?.get(name);

/** Ends the fight as a void outcome and switches the hook off. */
export function fault(ctx: FightCtx, hook: FightHook, error?: unknown): void {
  let set = disabled.get(ctx.rules.fightHooks);
  if (!set) {
    set = new Set();
    disabled.set(ctx.rules.fightHooks, set);
  }
  set.add(hook);
  const fight = ctx.fight;
  if (fight.result === 'ongoing') {
    fight.result = 'void';
    voids.set(ctx.rules.fightHooks, voidCount(ctx.rules.fightHooks) + 1);
    fight.fault = {
      pack: packOf(hook),
      hook: hook.id,
      reason:
        error instanceof Error ? error.message : String(error ?? 'the hook did not let time pass'),
    };
  }
}

// ---------- limits from data ----------

interface Limits {
  /** The smallest size of a hook timer, in timer units. */
  timerMin: number;
  /** Events of one hook allowed in one fight second. */
  events: number;
  /** The largest value a hook may return for a stat or a factor. */
  statMax: number;
}

const limitsOf = (ctx: FightCtx): Limits => {
  const c = ctx.content.balance.K.combat;
  return { timerMin: needOf(c.timerMinMs), events: c.hookEventsPerSec, statMax: c.hookStatMax };
};

// ---------- shape checks ----------

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const MOD_STATS = new Set(['accuracy', 'evasion', 'speed', 'damageTaken', 'taiDamage', 'resist']);

/** A factor a hook returns: finite, from 0 to the bound of the data. */
export const isFactor = (x: unknown, ctx: FightCtx): boolean =>
  isNum(x) && x >= 0 && x <= limitsOf(ctx).statMax;

export const isBoolean = (x: unknown): boolean => typeof x === 'boolean';

/** What `castInfo` may return: nothing, or the documented object. */
export function validCastInfo(x: unknown, _ctx?: FightCtx): boolean {
  if (x === null) return true;
  if (!isObj(x)) return false;
  return (
    typeof x.kind === 'string' &&
    typeof x.casting === 'boolean' &&
    typeof x.interruptible === 'boolean' &&
    (x.inWork === null || (isNum(x.inWork) && x.inWork >= 0)) &&
    isNum(x.total) &&
    x.total >= 0 &&
    isNum(x.mult) &&
    x.mult >= 0
  );
}

function validEffect(e: unknown, statMax: number): boolean {
  if (!isObj(e) || typeof e.id !== 'string' || typeof e.src !== 'string') return false;
  if (e.until !== null && !Number.isInteger(e.until)) return false;
  if (e.kind === 'modifier') {
    return (
      typeof e.stat === 'string' &&
      MOD_STATS.has(e.stat) &&
      (e.op === 'mul' || e.op === 'add') &&
      isNum(e.value) &&
      e.value >= 0 &&
      e.value <= statMax
    );
  }
  if (e.kind === 'periodic') {
    return (
      (e.mode === 'damage' || e.mode === 'heal' || e.mode === 'stamina') &&
      isNum(e.amount) &&
      e.amount >= 0 &&
      Number.isInteger(e.every) &&
      (e.every as number) >= WORK_PER_MS &&
      Number.isInteger(e.next)
    );
  }
  return false;
}

/**
 * Checks what a hook left in a body and takes out what the engine could not run: a timer that is not
 * an object, whose numbers are not whole and finite, or that is smaller than the floor of the data; a
 * number of `data` that is not finite; an effect of the wrong shape. Returns whether all was well.
 */
export function sanitizeBody(ctx: FightCtx, c: Combatant, limits: Limits = limitsOf(ctx)): boolean {
  let ok = true;
  const timers = c.timers as Record<string, unknown>;
  for (const name of Object.keys(timers)) {
    const t = timers[name];
    const good =
      isObj(t) &&
      isNum(t.progress) &&
      t.progress >= 0 &&
      Number.isInteger(t.need) &&
      (t.need as number) >= limits.timerMin;
    if (!good) {
      delete timers[name];
      ok = false;
    }
  }
  const data = c.data as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!isNum(data[key])) {
      delete data[key];
      ok = false;
    }
  }
  if (!Array.isArray(c.effects)) {
    c.effects = [];
    return false;
  }
  if (!c.effects.every((e) => validEffect(e, limits.statMax))) {
    c.effects = c.effects.filter((e) => validEffect(e, limits.statMax));
    ok = false;
  }
  return ok;
}

// ---------- event budget ----------

const budgets = new WeakMap<FightState, Map<FightHook, { second: number; n: number }>>();

function overBudget(ctx: FightCtx, hook: FightHook, limit: number): boolean {
  let map = budgets.get(ctx.fight);
  if (!map) budgets.set(ctx.fight, (map = new Map()));
  const second = Math.floor(ctx.fight.t / (WORK_PER_MS * secMs(1)));
  const have = map.get(hook);
  if (!have || have.second !== second) {
    map.set(hook, { second, n: 1 });
    return false;
  }
  return ++have.n > limit;
}

// ---------- the boundary ----------

export interface GuardOptions<T> {
  /** Whether a returned value is acceptable. */
  check?: (value: T, ctx: FightCtx) => boolean;
  /** The bodies the call may have changed: their timers, data and effects are checked afterwards. */
  bodies?: readonly Combatant[];
  /** The call is an event of the hook (a start, a timer, a hit): it counts against the budget. */
  event?: boolean;
  /** A check of what the call did to a thing it was handed (an attack plan), after it ran. */
  after?: () => boolean;
}

/**
 * Runs one call of a hook. A hook of the core is run plain. A hook of another pack that throws,
 * returns what `check` refuses, leaves a body in a shape the engine cannot run, changes what it was
 * handed to a wrong value or runs more often than the budget is contained: the fight is voided, the
 * hook is switched off and `fallback` stands in for the value.
 */
export function guard<T>(
  ctx: FightCtx,
  hook: FightHook,
  call: () => T,
  fallback: T,
  options: GuardOptions<T> = {},
): T {
  if (trusted(hook)) return call();
  const limits = limitsOf(ctx);
  if (options.event && overBudget(ctx, hook, limits.events)) {
    fault(ctx, hook, 'the hook ran more often than the budget allows');
    return fallback;
  }
  const bodies = options.bodies ?? [];
  const before = bodies.map((b) => new Set(Object.keys(b.timers)));
  let value: T;
  try {
    value = call();
  } catch (error) {
    fault(ctx, hook, error);
    return fallback;
  }
  if (options.check && !options.check(value, ctx)) {
    fault(ctx, hook, 'the hook returned a value outside what is allowed');
    return fallback;
  }
  for (const [i, body] of bodies.entries()) {
    // A timer that appeared in the call was armed by this hook.
    let owners = armedBy.get(body);
    for (const name of Object.keys(body.timers)) {
      if (before[i]?.has(name)) continue;
      if (!owners) armedBy.set(body, (owners = new Map()));
      owners.set(name, hook);
    }
    if (!sanitizeBody(ctx, body, limits)) {
      fault(ctx, hook, 'the hook left a timer, a number or an effect in a shape the engine cannot run');
      return fallback;
    }
  }
  if (options.after && !options.after()) {
    fault(ctx, hook, 'the hook changed what it was handed to a value outside what is allowed');
    return fallback;
  }
  return value;
}
