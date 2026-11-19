import type { ContentDb } from '@shinobi/content';
import type { EntityRef } from './entity.ts';
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

/**
 * The totals of several keys, as `computeMod(...).total` gives them, without building the parts:
 * the providers are asked once and each modifier is folded into the groups of its key as it comes.
 */
export function totalsOf(
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
  return computeMod(rules, state, key, content).total - 1;
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
