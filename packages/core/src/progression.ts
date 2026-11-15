import type { ContentDb, SkillId } from '@shinobi/content';
import { emit } from './events.ts';
import { masteryLevel, poolCapacity, poolGain } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { computeMod } from './modifiers.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';
import { levelAt, xpAt } from './xp.ts';

/**
 * Adds skill XP. Modifiers `xp.all` and `xp.skill.<id>` apply. A student's XP is slowed from the
 * Academy cap on: a grant that crosses the cap is split there, full below and slowed above.
 * XP stops at the level cap. Emits `levelUp` and refreshes unlocks.
 */
export function gainXp(
  state: GameState,
  skill: SkillId,
  amount: number,
  content: ContentDb,
  rules: Rules,
): void {
  if (!(amount > 0)) return;
  const K = content.balance.K;
  const cap = K.cap;
  const entry = state.skills[skill];
  const before = levelAt(entry.xp, cap);
  const mods = rules.modifierProviders;
  const raw =
    amount *
    computeMod(mods, state, 'xp.all', content).total *
    computeMod(mods, state, `xp.skill.${skill}`, content).total;
  let gained = raw;
  if (state.player.rank === 'student') {
    const room = Math.max(0, xpAt(K.academyCap) - entry.xp);
    gained = raw <= room ? raw : room + (raw - room) * K.academySlow;
  }
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
  entry.xp = Math.min(entry.xp + amount, xpAt(content.balance.K.masteryCap));
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

/**
 * The one way mastery is earned: `amount`, with the mastery XP modifiers `mastery.xp.all` and
 * `mastery.xp.skill.<skill>` applied, goes to the mastery key, and the pool share of the unmodified
 * amount to the skill's pool. Practice, combat and item use all call this.
 */
export function grantMastery(
  state: GameState,
  key: string,
  skill: SkillId,
  amount: number,
  content: ContentDb,
  rules?: Rules,
): void {
  const mods = rules?.modifierProviders ?? [];
  const earned =
    amount *
    computeMod(mods, state, 'mastery.xp.all', content).total *
    computeMod(mods, state, `mastery.xp.skill.${skill}`, content).total;
  gainMasteryXp(state, key, earned, content);
  gainPoolXp(state, skill, poolGain(amount, content), content);
}
