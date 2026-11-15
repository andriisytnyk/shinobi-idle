import type { FightCtx, FightHook } from './fight-types.ts';

/*
 * Containment of the hooks of other packs. A hook of the pack `core` (and of the engine) may throw:
 * that is a bug, and tests must see it. A hook of any other pack must not be able to stop the
 * engine: a call that throws, or a timer that would never settle, ends the fight as a void outcome
 * (no win, no loss, no loot, no Wound), names the pack and the hook, and switches the hook off until
 * the rules are loaded again. The game goes on with a new fight.
 */

import { originOf } from './fight-origin.ts';

/** The pack a hook was registered by (the core pack's and the engine's hooks have none). */
export const packOf = (hook: FightHook): string => originOf(hook) ?? 'core';

/** A hook that the engine trusts to fail loudly: not one a pack added. */
export const trusted = (hook: FightHook): boolean => originOf(hook) === undefined;

const disabled = new WeakMap<readonly FightHook[], Set<string>>();

export const isDisabled = (rules: readonly FightHook[], hook: FightHook): boolean =>
  disabled.get(rules)?.has(hook.id) ?? false;

/** How many hooks of this rule set are switched off; a body re-reads its hooks when it changes. */
export const disabledCount = (rules: readonly FightHook[]): number =>
  disabled.get(rules)?.size ?? 0;

/** Ends the fight as a void outcome and switches the hook off. */
export function fault(ctx: FightCtx, hook: FightHook, error?: unknown): void {
  let set = disabled.get(ctx.rules.fightHooks);
  if (!set) {
    set = new Set();
    disabled.set(ctx.rules.fightHooks, set);
  }
  set.add(hook.id);
  const fight = ctx.fight;
  if (fight.result === 'ongoing') {
    fight.result = 'void';
    fight.fault = {
      pack: packOf(hook),
      hook: hook.id,
      reason:
        error instanceof Error ? error.message : String(error ?? 'the hook did not let time pass'),
    };
  }
}

/** Runs one call of a hook; a hook of another pack that throws is contained and `fallback` stands in. */
export function guard<T>(ctx: FightCtx, hook: FightHook, call: () => T, fallback: T): T {
  if (trusted(hook)) return call();
  try {
    return call();
  } catch (error) {
    fault(ctx, hook, error);
    return fallback;
  }
}
