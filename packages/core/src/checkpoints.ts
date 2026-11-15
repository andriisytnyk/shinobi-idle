import type { ContentDb, PoolCheckpoint } from '@shinobi/content';
import { poolCapacity } from './formulas.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import type { GameState } from './state.ts';
import { poolEntry } from './vocab.ts';

/** Whether the pool of the checkpoint's skill holds at least its share of the capacity. */
export function checkpointReached(
  state: GameState,
  checkpoint: PoolCheckpoint,
  content: ContentDb,
): boolean {
  const capacity = poolCapacity(checkpoint.skill, content);
  if (capacity <= 0) return false;
  // The same threshold `gainPoolXp` crosses when it announces the checkpoint.
  return (poolEntry(state, checkpoint.skill)?.xp ?? 0) >= (capacity * checkpoint.pct) / 100;
}

/** The checkpoints of one skill that carry modifiers, lowest threshold first. */
interface Group {
  skill: string;
  /** Thresholds and ready-made modifiers, parallel arrays. */
  thresholds: number[];
  modifiers: Modifier[][];
}

/** The checkpoint groups per content database. The numbers never change, so this is built once. */
const tables = new WeakMap<ContentDb, Group[]>();

function tableOf(content: ContentDb): Group[] {
  let table = tables.get(content);
  if (!table) {
    table = [];
    for (const p of [...content.pools].sort((x, y) => x.pct - y.pct)) {
      const capacity = poolCapacity(p.skill, content);
      if (p.mods.length === 0 || capacity <= 0) continue;
      let group = table.find((g) => g.skill === p.skill);
      if (!group) table.push((group = { skill: p.skill, thresholds: [], modifiers: [] }));
      group.thresholds.push((capacity * p.pct) / 100);
      group.modifiers.push(
        p.mods.map((m): Modifier => ({
          key: m.key,
          op: m.op,
          value: m.value,
          group: 'character',
          source: { kind: 'skill', id: p.skill },
        })),
      );
    }
    tables.set(content, table);
  }
  return table;
}

const NONE: Modifier[] = [];

/**
 * Pool checkpoints: each one reached gives its modifiers, with the skill of the pool as source.
 * A checkpoint switches on the moment the pool holds its share and never off again.
 */
export const checkpointProvider: ModifierProvider = (state, content) => {
  const table = tableOf(content);
  let out: Modifier[] | null = null;
  for (let i = 0; i < table.length; i++) {
    const group = table[i];
    if (!group) continue;
    const xp = poolEntry(state, group.skill)?.xp ?? 0;
    // Most pools have not reached even their first checkpoint.
    if (xp < (group.thresholds[0] ?? Infinity)) continue;
    for (let j = 0; j < group.thresholds.length; j++) {
      if (xp < (group.thresholds[j] ?? Infinity)) break;
      out ??= [];
      for (const m of group.modifiers[j] ?? NONE) out.push(m);
    }
  }
  return out ?? NONE;
};
