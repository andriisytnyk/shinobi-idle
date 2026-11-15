import type { ContentDb } from '@shinobi/content';
import type { EntityRef } from './entity.ts';
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

export type ModifierProvider = (state: GameState, content: ContentDb) => Modifier[];

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
  providers: readonly ModifierProvider[],
  state: GameState,
  key: string,
  content: ContentDb,
): ModResult {
  const parts: Modifier[] = [];
  for (const provider of providers) {
    for (const m of provider(state, content)) if (m.key === key) parts.push(m);
  }
  return combine(parts, content);
}

/** The totals of several keys, asking each provider once: what a fight start needs for its cost modifiers. */
export function computeMods(
  providers: readonly ModifierProvider[],
  state: GameState,
  keys: readonly string[],
  content: ContentDb,
): ModResult[] {
  const all: Modifier[] = [];
  for (const provider of providers) for (const m of provider(state, content)) all.push(m);
  return keys.map((key) =>
    combine(
      all.filter((m) => m.key === key),
      content,
    ),
  );
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
  providers: readonly ModifierProvider[],
  state: GameState,
  key: string,
  content: ContentDb,
): number {
  return computeMod(providers, state, key, content).total - 1;
}

/**
 * How much longer than its base an action cycle of `skill` takes: the interval modifiers divided
 * by the speed modifiers. `extraSpeed` names one more speed key, for example `speed.practice`.
 */
export function cycleFactor(
  providers: readonly ModifierProvider[],
  state: GameState,
  skill: string,
  content: ContentDb,
  extraSpeed?: string,
): number {
  const slower = computeMod(providers, state, `interval.skill.${skill}`, content).total;
  let faster = computeMod(providers, state, `speed.skill.${skill}`, content).total;
  if (extraSpeed) faster *= computeMod(providers, state, extraSpeed, content).total;
  return slower / Math.max(faster, Number.EPSILON);
}
