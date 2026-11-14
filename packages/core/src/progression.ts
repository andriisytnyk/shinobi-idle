import type { ContentDb, SkillId } from '@shinobi/content';
import { emit } from './events.ts';
import { masteryLevel, poolCapacity } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { getMod } from './modifiers.ts';
import type { GameState } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';
import { levelAt, xpAt } from './xp.ts';

/**
 * Adds skill XP. Modifiers `xp.all` and `xp.skill.<id>` apply; a student's XP in a skill at or
 * above the Academy cap is slowed. XP stops at the level cap. Emits `levelUp` and refreshes unlocks.
 */
export function gainXp(state: GameState, skill: SkillId, amount: number, content: ContentDb): void {
  if (!(amount > 0)) return;
  const K = content.balance.K;
  const cap = K.cap;
  const entry = state.skills[skill];
  const before = levelAt(entry.xp, cap);
  let gained =
    amount *
    getMod(state, 'xp.all', content).total *
    getMod(state, `xp.skill.${skill}`, content).total;
  if (state.player.rank === 'student' && before >= K.academyCap) gained *= K.academySlow;
  entry.xp = Math.min(entry.xp + gained, xpAt(cap));
  const after = levelAt(entry.xp, cap);
  if (after === before) return;
  for (let level = before + 1; level <= after; level++) {
    emit(state, { type: 'levelUp', skill, level });
  }
  refreshUnlocks(state, content);
}

/** Adds mastery XP to a mastery key. Emits `masteryUp` for each level gained. */
export function gainMasteryXp(
  state: GameState,
  key: string,
  amount: number,
  content: ContentDb,
): void {
  if (!(amount > 0)) return;
  const before = masteryLevel(state, key, content);
  const entry = (state.mastery[key] ??= { xp: 0 });
  entry.xp += amount;
  const after = masteryLevel(state, key, content);
  for (let level = before + 1; level <= after; level++) {
    emit(state, { type: 'masteryUp', key, level });
  }
}

/** Adds pool XP, clamped to the skill's capacity. Emits `poolCheckpoint` for each threshold crossed. */
export function gainPoolXp(
  state: GameState,
  skill: SkillId,
  amount: number,
  content: ContentDb,
): void {
  const capacity = poolCapacity(skill, content);
  if (!(amount > 0) || capacity <= 0) return;
  const pool = state.pools[skill];
  const before = pool.xp;
  pool.xp = Math.min(before + amount, capacity);
  for (const checkpoint of indexOf(content).poolCheckpoints.get(skill) ?? []) {
    const threshold = (capacity * checkpoint.pct) / 100;
    if (before < threshold && pool.xp >= threshold) {
      emit(state, { type: 'poolCheckpoint', skill, id: checkpoint.id, pct: checkpoint.pct });
    }
  }
}
