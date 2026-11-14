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

const providers: ModifierProvider[] = [];

/** Registers a source of modifiers (character perks, buildings, gear). Returns an unregister function. */
export function registerModifierProvider(provider: ModifierProvider): () => void {
  providers.push(provider);
  return () => {
    const at = providers.indexOf(provider);
    if (at >= 0) providers.splice(at, 1);
  };
}

/**
 * Collects the modifiers for `key`. Inside a group, `add` values are summed (factor 1 + sum) and
 * `mul` values multiplied in; the groups are then multiplied together.
 */
export function getMod(state: GameState, key: string, content: ContentDb): ModResult {
  const parts: Modifier[] = [];
  for (const provider of providers) {
    for (const m of provider(state, content)) if (m.key === key) parts.push(m);
  }
  const groups = new Map<ModifierGroup, { add: number; mul: number }>();
  for (const m of parts) {
    const g = groups.get(m.group) ?? { add: 0, mul: 1 };
    if (m.op === 'add') g.add += m.value;
    else g.mul *= m.value;
    groups.set(m.group, g);
  }
  let total = 1;
  for (const g of groups.values()) total *= (1 + g.add) * g.mul;
  return { total, parts };
}
