import type { ContentDb } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import type { CombatAi } from './combat/fight-types.ts';
import { emit } from './events.ts';
import type { ModRules, Modifier, ModifierProvider } from './modifiers.ts';
import type { HexEnteredHook } from './hex-hooks.ts';
import type { Req } from './requirements.ts';
import type { GameState } from './state.ts';
import type { System } from './system.ts';

/*
 * Containment of the rules that a pack other than `core` adds: whatever such a rule does by mistake
 * (wrong values, a throw, a tight loop, absurd numbers) it must not crash, hang or silently corrupt
 * `advance`. A rule that fails is switched off for the session and the UI is told (`ruleDisabled`);
 * the rules of the `core` pack are never guarded, so a bug in them stays loud in tests. The guard is
 * applied by `composeRules`, which also records which pack each rule came from. A pack that
 * deliberately sabotages the game by writing to the state itself (deleting branches, setting
 * `now` to NaN) is out of scope: a pack's code is trusted not to attack the state.
 */

export { originOf, tagOrigin } from './combat/fight-origin.ts';
import { originOf, tagOrigin } from './combat/fight-origin.ts';

const disabled = new WeakMap<GameState, Set<object>>();

/** Whether a system has been switched off for this state. The set lives with the state object, so a load tries the system again. */
export const isDisabled = (state: GameState, system: System): boolean =>
  disabled.get(state)?.has(system) === true;

const text = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';

/** Switches a system off for this state and tells the UI which pack and which system. */
export function disableSystem(
  state: GameState,
  system: System,
  pack: string,
  error: unknown,
): void {
  let set = disabled.get(state);
  if (!set) disabled.set(state, (set = new Set()));
  if (set.has(system)) return;
  set.add(system);
  emit(state, {
    type: 'ruleDisabled',
    pack,
    rule: system.id ?? 'system',
    reason: text(error),
  });
}

/** A wait that `advance` can use: nothing pending, or a whole number of ms that is not negative. */
export const validWait = (x: unknown): x is number | null =>
  x === null || (typeof x === 'number' && Number.isInteger(x) && x >= 0);

/**
 * Runs a callback of a system. A system of the core pack runs plain; one from another pack that
 * throws, returns what `valid` refuses or moves `state.now` (which `advance` alone owns) is switched
 * off, `now` is put back and `fallback` is used.
 */
export function callSystem<T>(
  state: GameState,
  system: System,
  fn: () => T,
  fallback: T,
  valid?: (x: unknown) => boolean,
): T {
  const pack = originOf(system);
  if (pack === undefined) return fn();
  const now = state.now;
  try {
    const out = fn();
    if (state.now !== now) throw new Error('changed the game time');
    if (valid && !valid(out)) throw new Error(`invalid value ${String(out)}`);
    return out;
  } catch (error) {
    state.now = now;
    disableSystem(state, system, pack, error);
    return fallback;
  }
}

const budgets = new WeakMap<GameState, Map<System, { hour: number; count: number }>>();
const MS_PER_HOUR = 3_600_000;

/**
 * Counts one event of a system of a pack; when it has had more than `limit` in the hour of game
 * time it is in, the system is switched off (reason `budget`). Returns whether it was.
 */
export function chargeEvent(
  state: GameState,
  system: System,
  pack: string,
  limit: number,
): boolean {
  let map = budgets.get(state);
  if (!map) budgets.set(state, (map = new Map()));
  const hour = Math.floor(state.now / MS_PER_HOUR);
  const entry = map.get(system);
  if (!entry || entry.hour !== hour) {
    map.set(system, { hour, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count <= limit) return false;
  disableSystem(state, system, pack, new Error(`budget: over ${limit} events in an hour`));
  return true;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const str = (x: unknown): x is string => typeof x === 'string';

/** Whether a value is a requirement tree: every node of a known kind with the right fields. */
export function validReq(x: unknown, depth = 0): x is Req {
  if (depth > 16 || typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  switch (r.t) {
    case 'skill':
      return str(r.skill) && finite(r.level);
    case 'technique':
    case 'quest':
    case 'flag':
      return str(r.id);
    case 'rank':
      return str(r.rank);
    case 'nature':
      return str(r.nature);
    case 'item':
    case 'building':
      return str(r.id) && finite(r.n ?? r.level);
    case 'all':
    case 'any':
      return Array.isArray(r.of) && r.of.length <= 64 && r.of.every((c) => validReq(c, depth + 1));
    default:
      return false;
  }
}

const NEVER: Req = { t: 'any', of: [] };
const RESULTS: ReadonlySet<unknown> = new Set(['continue', 'stop', 'abort', 'step', undefined]);

/** An action kind of a pack, guarded: a failing or garbled method stops the action of the slot and names the pack. */
export function guardKind(kind: ActionKind, pack: string): ActionKind {
  const failed = new WeakSet<object>();
  const fail = (state: GameState | null, where: string, error: unknown): void => {
    if (!state || failed.has(state)) return;
    failed.add(state);
    emit(state, { type: 'ruleDisabled', pack, rule: `actionKind.${where}`, reason: text(error) });
  };
  const textOrNull = (x: unknown): string | null => {
    if (x === null || x === undefined) return null;
    if (!str(x)) throw new Error(`invalid value ${String(x)}`);
    return x;
  };
  const guarded: ActionKind = {
    has(id, content) {
      try {
        return kind.has(id, content) === true;
      } catch {
        return false;
      }
    },
    requirements(state, id, content, rules) {
      if (failed.has(state)) return NEVER;
      try {
        const req = kind.requirements(state, id, content, rules);
        if (req !== null && !validReq(req))
          throw new Error('requirements is not a requirement tree');
        return req;
      } catch (error) {
        fail(state, 'requirements', error);
        return NEVER;
      }
    },
    intervalMs(state, id, content, rules, slot) {
      // A failed kind is stopped at once: its next cycle is due now, and it ends in `abort`.
      if (failed.has(state)) return 1;
      try {
        const ms = kind.intervalMs(state, id, content, rules, slot);
        if (!Number.isInteger(ms) || ms < 1) throw new Error(`invalid interval ${String(ms)}`);
        return Math.max(content.balance.K.engine.minActionMs, ms);
      } catch (error) {
        fail(state, 'intervalMs', error);
        return 1;
      }
    },
    complete(state, id, content, rules, slot) {
      if (failed.has(state)) return 'abort';
      try {
        const result = kind.complete(state, id, content, rules, slot);
        if (!RESULTS.has(result)) throw new Error(`invalid result ${String(result)}`);
        return result;
      } catch (error) {
        fail(state, 'complete', error);
        return 'abort';
      }
    },
    abortCause(state, id, content, rules) {
      if (failed.has(state)) return 'error.packRuleFailed';
      try {
        return textOrNull(kind.abortCause?.(state, id, content, rules));
      } catch {
        return null;
      }
    },
  };
  if (kind.blocked) {
    const blocked = kind.blocked.bind(kind);
    guarded.blocked = (state, id, content, rules, slot) => {
      try {
        return textOrNull(blocked(state, id, content, rules, slot));
      } catch (error) {
        fail(state, 'blocked', error);
        return 'error.packRuleFailed';
      }
    };
  }
  if (kind.missing) {
    const missing = kind.missing.bind(kind);
    guarded.missing = (state, id, content, rules) => {
      try {
        return textOrNull(missing(state, id, content, rules));
      } catch {
        return null;
      }
    };
  }
  if (kind.flow) {
    const flow = kind.flow.bind(kind);
    guarded.flow = (id, content) => {
      try {
        const out = flow(id, content);
        return out && Array.isArray(out.makes) && Array.isArray(out.uses) && str(out.speed)
          ? {
              makes: out.makes.filter(str),
              uses: out.uses.filter(str),
              speed: out.speed,
            }
          : null;
      } catch {
        return null;
      }
    };
  }
  if (kind.skill) {
    const skill = kind.skill.bind(kind);
    guarded.skill = (id, content) => {
      try {
        return textOrNull(skill(id, content));
      } catch {
        return null;
      }
    };
  }
  if (kind.combatEnded) {
    const ended = kind.combatEnded.bind(kind);
    guarded.combatEnded = (state, slot, result, content, rules) => {
      try {
        ended(state, slot, result, content, rules);
      } catch (error) {
        fail(state, 'combatEnded', error);
      }
    };
  }
  if (kind.start) {
    const start = kind.start.bind(kind);
    guarded.start = (state, slot, id, content, rules) => {
      try {
        start(state, slot, id, content, rules);
      } catch (error) {
        fail(state, 'start', error);
      }
    };
  }
  if (kind.stop) {
    const stop = kind.stop.bind(kind);
    guarded.stop = (state, slot, id, content, rules, reason) => {
      try {
        stop(state, slot, id, content, rules, reason);
      } catch (error) {
        fail(state, 'stop', error);
      }
    };
  }
  return tagOrigin(guarded, pack);
}

const GROUPS: ReadonlySet<unknown> = new Set(['character', 'village', 'items']);

const validModifier = (m: unknown): m is Modifier =>
  typeof m === 'object' &&
  m !== null &&
  str((m as Modifier).key) &&
  ((m as Modifier).op === 'add' || (m as Modifier).op === 'mul') &&
  finite((m as Modifier).value) &&
  ((m as Modifier).op === 'add' || (m as Modifier).value > 0) &&
  GROUPS.has((m as Modifier).group);

/** A modifier provider of a pack, guarded: a failing one contributes nothing, and so does a bad modifier. */
export function guardProvider(provider: ModifierProvider, pack: string): ModifierProvider {
  const guarded: ModifierProvider = (state: GameState, content: ContentDb, rules: ModRules) => {
    try {
      const out = provider(state, content, rules);
      return Array.isArray(out) ? out.filter(validModifier) : [];
    } catch {
      return [];
    }
  };
  return tagOrigin(guarded, pack);
}

/**
 * A handler of a pack for the hex the player enters, guarded: when it throws, it is switched off
 * for this state (as the other rules of a pack are), the pack is told once and the walk goes on.
 */
export function guardHexHook(hook: HexEnteredHook, pack: string): HexEnteredHook {
  const guarded: HexEnteredHook = (state, ctx, content, rules) => {
    if (disabled.get(state)?.has(guarded)) return;
    const now = state.now;
    try {
      hook(state, ctx, content, rules);
    } catch (error) {
      state.now = now;
      let set = disabled.get(state);
      if (!set) disabled.set(state, (set = new Set()));
      set.add(guarded);
      emit(state, { type: 'ruleDisabled', pack, rule: 'hexEntered', reason: text(error) });
    }
  };
  return tagOrigin(guarded, pack);
}

const notices: { pack: string; rule: string; reason: string }[] = [];

/** The notices of rules that failed where no state was at hand (the player AI), for `advance` to hand to the UI. */
export function takeNotices(): { pack: string; rule: string; reason: string }[] {
  return notices.splice(0, notices.length);
}

const validDecision = (d: unknown): boolean => {
  if (typeof d !== 'object' || d === null) return false;
  const t = (d as { type?: unknown }).type;
  if (t === 'wait' || t === 'basic') return true;
  return (t === 'technique' || t === 'item') && str((d as { id?: unknown }).id);
};

/**
 * The player AI of a pack, guarded: one that throws or answers with something that is no decision
 * is replaced by the AI it was meant to replace, for that call, and the failure is noticed once.
 */
export function guardAi(ai: CombatAi, pack: string, fallback: CombatAi): CombatAi {
  let told = false;
  const guarded: CombatAi = (view) => {
    try {
      const decision = ai(view);
      if (!validDecision(decision)) throw new Error('the decision is not a decision');
      return decision;
    } catch (error) {
      if (!told) {
        told = true;
        notices.push({ pack, rule: 'combatAi', reason: text(error) });
      }
      return fallback(view);
    }
  };
  return guarded;
}
