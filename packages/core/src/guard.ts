import type { ContentDb } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { emit } from './events.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import type { Req } from './requirements.ts';
import type { GameState } from './state.ts';
import type { System } from './system.ts';

/*
 * Containment of the rules that a pack other than `core` adds: whatever such a rule does, it must
 * not be able to stop or corrupt `advance`. A rule that fails is switched off for the session and
 * the UI is told (`ruleDisabled`); the rules of the `core` pack are never guarded, so a bug in them
 * stays loud in tests. The guard is applied by `composeRules`, which also records which pack each
 * rule came from.
 */

const origins = new WeakMap<object, string>();

/** The pack a rule entry (a system, an action kind, a modifier provider) was added by; undefined for the core pack's. */
export const originOf = (entry: object): string | undefined => origins.get(entry);

/** Records the pack an entry came from. */
export function tagOrigin<T extends object>(entry: T, pack: string): T {
  origins.set(entry, pack);
  return entry;
}

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
 * throws, or returns what `valid` refuses, is switched off and `fallback` is used.
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
  try {
    const out = fn();
    if (valid && !valid(out)) throw new Error(`invalid value ${String(out)}`);
    return out;
  } catch (error) {
    disableSystem(state, system, pack, error);
    return fallback;
  }
}

const NEVER: Req = { t: 'any', of: [] };
/** What an action kind that failed waits for: an hour, with a requirement that never holds, so the action stops at once. */
const FAILED_MS = 3_600_000;

/** An action kind of a pack, guarded: a failing method stops the action of the slot and names the pack. */
export function guardKind(kind: ActionKind, pack: string): ActionKind {
  const failed = new WeakSet<object>();
  const fail = (state: GameState | null, where: string, error: unknown): void => {
    if (!state || failed.has(state)) return;
    failed.add(state);
    emit(state, { type: 'ruleDisabled', pack, rule: `actionKind.${where}`, reason: text(error) });
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
        return kind.requirements(state, id, content, rules);
      } catch (error) {
        fail(state, 'requirements', error);
        return NEVER;
      }
    },
    intervalMs(state, id, content, rules, slot) {
      try {
        const ms = kind.intervalMs(state, id, content, rules, slot);
        if (!Number.isInteger(ms) || ms < 1) throw new Error(`invalid interval ${String(ms)}`);
        return ms;
      } catch (error) {
        fail(state, 'intervalMs', error);
        return FAILED_MS;
      }
    },
    complete(state, id, content, rules, slot) {
      try {
        return kind.complete(state, id, content, rules, slot);
      } catch (error) {
        fail(state, 'complete', error);
        return 'abort';
      }
    },
  };
  if (kind.blocked) {
    const blocked = kind.blocked.bind(kind);
    guarded.blocked = (state, id, content, rules, slot) => {
      try {
        return blocked(state, id, content, rules, slot);
      } catch (error) {
        fail(state, 'blocked', error);
        return 'error.packRuleFailed';
      }
    };
  }
  if (kind.abortCause) {
    const abortCause = kind.abortCause.bind(kind);
    guarded.abortCause = (state, id, content, rules) => {
      try {
        return abortCause(state, id, content, rules);
      } catch {
        return null;
      }
    };
  }
  if (kind.missing) {
    const missing = kind.missing.bind(kind);
    guarded.missing = (state, id, content, rules) => {
      try {
        return missing(state, id, content, rules);
      } catch {
        return null;
      }
    };
  }
  if (kind.skill) {
    const skill = kind.skill.bind(kind);
    guarded.skill = (id, content) => {
      try {
        return skill(id, content);
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

const validModifier = (m: unknown): m is Modifier =>
  typeof m === 'object' &&
  m !== null &&
  typeof (m as Modifier).key === 'string' &&
  ((m as Modifier).op === 'add' || (m as Modifier).op === 'mul') &&
  Number.isFinite((m as Modifier).value);

/** A modifier provider of a pack, guarded: a failing one contributes nothing, and so does a bad modifier. */
export function guardProvider(provider: ModifierProvider, pack: string): ModifierProvider {
  const guarded: ModifierProvider = (state: GameState, content: ContentDb) => {
    try {
      const out = provider(state, content);
      return Array.isArray(out) ? out.filter(validModifier) : [];
    } catch {
      return [];
    }
  };
  return tagOrigin(guarded, pack);
}
