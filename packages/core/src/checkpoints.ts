import type { ContentDb, PoolCheckpoint, SkillId } from '@shinobi/content';
import { poolCapacity } from './formulas.ts';
import { indexOf } from './lookup.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import type { GameState } from './state.ts';

/** Whether the pool of the checkpoint's skill holds at least its share of the capacity. */
export function checkpointReached(
  state: GameState,
  checkpoint: PoolCheckpoint,
  content: ContentDb,
): boolean {
  // An empty pool reaches nothing; most checkpoints stop here.
  if (!(state.pools[checkpoint.skill].xp > 0)) return false;
  const capacity = poolCapacity(checkpoint.skill, content);
  if (capacity <= 0) return false;
  // The same threshold `gainPoolXp` crosses when it announces the checkpoint.
  return state.pools[checkpoint.skill].xp >= (capacity * checkpoint.pct) / 100;
}

/**
 * Pool checkpoints: each one reached gives its modifiers, with the skill of the pool as source.
 * A checkpoint switches on the moment the pool holds its share and never off again.
 */
export const checkpointProvider: ModifierProvider = (state, content) => {
  const out: Modifier[] = [];
  const byLevel = indexOf(content).poolCheckpoints;
  for (const [skill, checkpoints] of byLevel) {
    // An empty pool reaches nothing; most skills stop here.
    if (!((state.pools[skill as SkillId]?.xp ?? 0) > 0)) continue;
    for (const checkpoint of checkpoints) {
      if (checkpoint.mods.length === 0 || !checkpointReached(state, checkpoint, content)) continue;
      for (const m of checkpoint.mods) {
        out.push({
          key: m.key,
          op: m.op,
          value: m.value,
          group: 'character',
          source: { kind: 'skill', id: checkpoint.skill },
        });
      }
    }
  }
  return out;
};
