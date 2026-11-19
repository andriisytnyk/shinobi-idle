import type { ContentDb } from '@shinobi/content';
import { originOf } from './combat/fight-origin.ts';
import type { EntityRef } from './entity.ts';
import { actingPerformer } from './performer.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

export type ModifierGroup = 'character' | 'village' | 'items';

/** One bonus. Keys look like `xp.skill.tai`, `xp.all`, `interval.skill.herb`, `cost.chakra`. */
export interface Modifier {
  key: string;
  op: 'add' | 'mul';
  value: number;
  group: ModifierGroup;
  source: EntityRef | string;
}

/** A provider of modifiers; `rules` is the rule set the game runs by, for providers that read its action kinds. */
export type ModifierProvider = (
  state: GameState,
  content: ContentDb,
  rules: ModRules,
) => Modifier[];

/** The part of the rules the modifier functions need: the providers, and what providers read. */
export type ModRules = Pick<Rules, 'modifierProviders' | 'actionKinds'>;

/** No providers: what a caller without rules at hand reads from. */
export const NO_MOD_RULES: ModRules = { modifierProviders: [], actionKinds: {} };

export interface ModResult {
  /** Multiplier to apply to the base value; 1 when nothing contributes. */
  total: number;
  /** Every modifier that contributed, for the UI breakdown. */
  parts: Modifier[];
}

/**
 * Collects the modifiers for `key` from the given providers. Inside a group, `add` values are
 * summed (factor 1 + sum) and `mul` values multiplied in; the groups are then multiplied together.
 * Public callers use `getMod`, which supplies the default providers.
 */
export function computeMod(
  rules: ModRules,
  state: GameState,
  key: string,
  content: ContentDb,
): ModResult {
  const parts: Modifier[] = [];
  for (const provider of rules.modifierProviders) {
    for (const m of provider(state, content, rules)) if (m.key === key) parts.push(m);
  }
  return combine(parts, content);
}

/** The totals of several keys, asking each provider once: what a fight start needs for its cost modifiers. */
export function computeMods(
  rules: ModRules,
  state: GameState,
  keys: readonly string[],
  content: ContentDb,
): ModResult[] {
  const all: Modifier[] = [];
  for (const provider of rules.modifierProviders)
    for (const m of provider(state, content, rules)) all.push(m);
  return keys.map((key) =>
    combine(
      all.filter((m) => m.key === key),
      content,
    ),
  );
}

const GROUPS: readonly ModifierGroup[] = ['character', 'village', 'items'];

// ---------- the totals kept while `advance` runs ----------

/**
 * While `advance` runs, the totals the core providers give are kept for as long as nothing they read
 * has changed. A game hour of fighting asks for the same totals hundreds of thousands of times (every
 * event of every performer), and what the providers read (buffs, gear, levels, places, village, fatigue,
 * the performers on the map) changes at a handful of places, each of which calls `touchMods`. The answer
 * is kept only for the providers of the core (`markCacheable`): a provider of a pack may read anything.
 * Outside `advance` nothing is kept, so a caller that changes the state by hand reads fresh totals.
 */
interface Held {
  totals: number[];
}

interface KeptTotals {
  state: GameState;
  content: ContentDb;
  /** The rules the totals are kept for: a call with others is answered afresh. */
  providers: readonly ModifierProvider[];
  kinds: ModRules['actionKinds'];
  /** Counts `touchMods`; the totals below are of this count. */
  stamp: number;
  /** By performer, then by the keys asked for. */
  byKey: Map<string, Held>[];
  /** What a caller worked out from the totals and the state (`keptValue`), by the name it gave. */
  values: Map<string, number>;
}

let kept: KeptTotals | null = null;
const stamps = new WeakMap<GameState, number>();
const cacheable = new WeakSet<ModifierProvider>();
const keepableRules = new WeakMap<object, boolean>();
let verify = false;

/** Says what the providers read has changed: the kept totals of the state are dropped. */
export function touchMods(state: GameState): void {
  stamps.set(state, (stamps.get(state) ?? 0) + 1);
}

/**
 * Registers providers that read only what `touchMods` is called for: their totals may be kept.
 * (The one registry filled at import time: `rules.ts` registers the providers of `defaultRules`.)
 */
export function markCacheable(providers: readonly ModifierProvider[]): void {
  for (const p of providers) cacheable.add(p);
}

/** For tests: every kept total that is used is worked out again and compared; a difference throws. */
export function verifyModCache(on: boolean): void {
  verify = on;
}

/**
 * Whether totals may be kept for a rule set: every provider is declared safe and no rule at all comes
 * from a pack. A pack's system, action kind, hex hook or fight hook may write what a core provider reads
 * without any `touchMods`, so one such rule switches the keeping off for the whole game (a modded game
 * is slower, never wrong).
 */
function keepable(rules: Rules): boolean {
  let ok = keepableRules.get(rules);
  if (ok === undefined) {
    const fromPack = (list: readonly object[] | undefined): boolean =>
      (list ?? []).some((e) => originOf(e) !== undefined);
    ok =
      rules.modifierProviders.every((p) => cacheable.has(p)) &&
      !fromPack(rules.systems) &&
      !fromPack(Object.values(rules.actionKinds)) &&
      !fromPack(rules.hexEntered) &&
      !fromPack(rules.fightHooks);
    keepableRules.set(rules, ok);
  }
  return ok;
}

/** Runs `fn` with the totals of `state` kept for `rules` (see above); calls nest. */
export function withKeptTotals<T>(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  fn: () => T,
): T {
  const before = kept;
  kept = keepable(rules)
    ? {
        state,
        content,
        providers: rules.modifierProviders,
        kinds: rules.actionKinds,
        stamp: stamps.get(state) ?? 0,
        byKey: [],
        values: new Map(),
      }
    : null;
  try {
    return fn();
  } finally {
    kept = before;
  }
}

/** The kept totals when they are kept for exactly these rules, state and content (dropped first if something was touched). */
function keptFor(rules: ModRules, state: GameState, content: ContentDb | null): KeptTotals | null {
  const cache = kept;
  if (
    !cache ||
    cache.state !== state ||
    (content !== null && cache.content !== content) ||
    cache.providers !== rules.modifierProviders ||
    cache.kinds !== rules.actionKinds
  )
    return null;
  const stamp = stamps.get(state) ?? 0;
  if (cache.stamp !== stamp) {
    cache.stamp = stamp;
    cache.byKey.length = 0;
    cache.values.clear();
  }
  return cache;
}

/**
 * The totals of several keys, as `computeMod(...).total` gives them, without building the parts:
 * the providers are asked once and each modifier is folded into the groups of its key as it comes.
 * Kept while `advance` runs (see above); the array is frozen.
 */
export function totalsOf(
  rules: ModRules,
  state: GameState,
  keys: readonly string[],
  content: ContentDb,
): number[] {
  const cache = keptFor(rules, state, content);
  if (!cache) return sweep(rules, state, keys, content);
  const who = actingPerformer();
  const mine = (cache.byKey[who] ??= new Map());
  const id =
    keys.length === 1
      ? (keys[0] as string)
      : keys.length === 2
        ? `${keys[0]}|${keys[1]}`
        : keys.join('|');
  const at = mine.get(id);
  if (at) {
    if (verify) {
      const fresh = sweep(rules, state, keys, content);
      if (fresh.some((v, i) => v !== at.totals[i])) {
        throw new Error(
          `kept modifier totals are stale for ${who}|${id}: ${at.totals} against ${fresh}`,
        );
      }
    }
    return at.totals;
  }
  const out = sweep(rules, state, keys, content);
  // Frozen: a caller that wrote to a kept array would corrupt every later answer.
  Object.freeze(out);
  mine.set(id, { totals: out });
  return out;
}

/**
 * A number worked out from the state and the modifiers, kept like the totals: until something they read
 * changes (`touchMods`), and only while `advance` runs with the providers of the core. `id` names what is
 * worked out and what it is of (the performer included when it differs by performer).
 */
export function keptValue(
  rules: ModRules,
  state: GameState,
  id: string,
  compute: () => number,
): number {
  const cache = keptFor(rules, state, null);
  if (!cache) return compute();
  const name = `${actingPerformer()}|${id}`;
  const at = cache.values.get(name);
  if (at !== undefined) {
    if (verify) {
      const fresh = compute();
      if (fresh !== at) throw new Error(`kept value is stale for ${name}: ${at} against ${fresh}`);
    }
    return at;
  }
  const out = compute();
  cache.values.set(name, out);
  return out;
}

function sweep(
  rules: ModRules,
  state: GameState,
  keys: readonly string[],
  content: ContentDb,
): number[] {
  // Only the few modifiers of the keys asked for are kept, with the index of their key.
  let hits: Modifier[] | null = null;
  let hitKeys: number[] | null = null;
  for (const provider of rules.modifierProviders) {
    for (const m of provider(state, content, rules)) {
      const k = keys.indexOf(m.key);
      if (k < 0) continue;
      (hits ??= []).push(m);
      (hitKeys ??= []).push(k);
    }
  }
  if (!hits || !hitKeys) return keys.map(() => 1);
  const { modMin, modMax } = content.balance.K.engine;
  const found = hits;
  const owners = hitKeys;
  return keys.map((_, k) => {
    // The groups of the key in the order the first modifier of each came: the product is taken in that order.
    const seen: number[] = [];
    const add = [0, 0, 0];
    const mul = [1, 1, 1];
    for (let i = 0; i < found.length; i++) {
      if (owners[i] !== k) continue;
      const m = found[i] as Modifier;
      const g = GROUPS.indexOf(m.group);
      if (!seen.includes(g)) seen.push(g);
      if (m.op === 'add') add[g] = (add[g] as number) + m.value;
      else mul[g] = (mul[g] as number) * m.value;
    }
    if (seen.length === 0) return 1;
    let total = 1;
    for (const g of seen) total *= (1 + (add[g] as number)) * (mul[g] as number);
    return Number.isFinite(total) ? Math.min(modMax, Math.max(modMin, total)) : 1;
  });
}

function combine(parts: Modifier[], content: ContentDb): ModResult {
  if (parts.length === 0) return { total: 1, parts };
  const groups = new Map<ModifierGroup, { add: number; mul: number }>();
  for (const m of parts) {
    const g = groups.get(m.group) ?? { add: 0, mul: 1 };
    if (m.op === 'add') g.add += m.value;
    else g.mul *= m.value;
    groups.set(m.group, g);
  }
  let total = 1;
  for (const g of groups.values()) total *= (1 + g.add) * g.mul;
  // A total that is not a number, or outside the bounds of the balance, is brought inside them.
  const { modMin, modMax } = content.balance.K.engine;
  total = Number.isFinite(total) ? Math.min(modMax, Math.max(modMin, total)) : 1;
  return { total, parts };
}

/** The total of `key` minus one: a share (0.05 for +5%) or, for a flat key, a count of units. */
export function bonusOf(
  rules: ModRules,
  state: GameState,
  key: string,
  content: ContentDb,
): number {
  return (totalsOf(rules, state, [key], content)[0] ?? 1) - 1;
}

const cycleKeysKept = new Map<string, Map<string, readonly string[]>>();

/** The keys a cycle of `skill` reads, built once: they are looked up every cycle. */
function cycleKeys(skill: string, extraSpeed?: string): readonly string[] {
  let bySpeed = cycleKeysKept.get(skill);
  if (!bySpeed) {
    bySpeed = new Map();
    cycleKeysKept.set(skill, bySpeed);
  }
  const extra = extraSpeed ?? '';
  let keys = bySpeed.get(extra);
  if (!keys) {
    keys = [`interval.skill.${skill}`, `speed.skill.${skill}`, ...(extra ? [extra] : [])];
    bySpeed.set(extra, keys);
  }
  return keys;
}

/**
 * How much longer than its base an action cycle of `skill` takes: the interval modifiers divided
 * by the speed modifiers. `extraSpeed` names one more speed key, for example `speed.practice`.
 */
export function cycleFactor(
  rules: ModRules,
  state: GameState,
  skill: string,
  content: ContentDb,
  extraSpeed?: string,
): number {
  // One sweep of the providers for all the keys; the totals are those of `computeMod` key by key.
  const [slower = 1, speed = 1, extra = 1] = totalsOf(
    rules,
    state,
    cycleKeys(skill, extraSpeed),
    content,
  );
  const faster = extraSpeed ? speed * extra : speed;
  return slower / Math.max(faster, Number.EPSILON);
}

/** What a provider returns when it has nothing to give; callers read the list and never change it. */
export const NO_MODIFIERS: Modifier[] = [];

/** Whether an object has no own property, without building a list of them. */
export function hasNone(record: object): boolean {
  for (const key in record) if (Object.hasOwn(record, key)) return false;
  return true;
}
