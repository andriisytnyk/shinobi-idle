import type { ContentDb } from '@shinobi/content';
import { emit } from './events.ts';
import { masteryLevel, poolCapacity, poolGain } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { NO_MOD_RULES, totalsOf } from './modifiers.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';
import { isAcademyRank, poolEntry, skillEntry } from './vocab.ts';
import { levelAt, xpAt } from './xp.ts';

/**
 * The XP a grant of `amount` really adds to `skill` now: the modifiers `xp.all` and
 * `xp.skill.<id>` applied, a student's slowdown from the Academy cap on (a grant that crosses the
 * cap is split there, full below and slowed above), and none beyond the level cap. `gainXp` adds
 * exactly this, and forecasts read it so that they cannot disagree with the grant.
 */
export function xpGain(
  state: GameState,
  skill: string,
  amount: number,
  content: ContentDb,
  rules: Rules,
): number {
  if (!(amount > 0)) return 0;
  const K = content.balance.K;
  const entry = skillEntry(state, skill);
  if (!entry) return 0;
  const mods = rules;
  const [all = 1, own = 1] = totalsOf(mods, state, ['xp.all', `xp.skill.${skill}`], content);
  const raw = amount * all * own;
  let gained = raw;
  if (isAcademyRank(content, state.player.rank)) {
    const room = Math.max(0, xpAt(K.academyCap) - entry.xp);
    gained = raw <= room ? raw : room + (raw - room) * K.academySlow;
  }
  return Math.max(0, Math.min(entry.xp + gained, xpAt(K.cap)) - entry.xp);
}

/**
 * Adds skill XP (see `xpGain`). XP stops at the level cap. Emits `levelUp` and refreshes unlocks.
 */
export function gainXp(
  state: GameState,
  skill: string,
  amount: number,
  content: ContentDb,
  rules: Rules,
): void {
  if (!(amount > 0)) return;
  const cap = content.balance.K.cap;
  const entry = skillEntry(state, skill);
  if (!entry) return;
  const before = levelAt(entry.xp, cap);
  entry.xp = Math.min(entry.xp + xpGain(state, skill, amount, content, rules), xpAt(cap));
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
  skill: string,
  amount: number,
  content: ContentDb,
): void {
  const capacity = poolCapacity(skill, content);
  if (!(amount > 0) || capacity <= 0) return;
  const pool = poolEntry(state, skill);
  if (!pool) return;
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
  skill: string,
  amount: number,
  content: ContentDb,
  rules?: Rules,
): void {
  const mods = rules ?? NO_MOD_RULES;
  const [all = 1, own = 1] = totalsOf(
    mods,
    state,
    ['mastery.xp.all', `mastery.xp.skill.${skill}`],
    content,
  );
  const earned = amount * all * own;
  gainMasteryXp(state, key, earned, content);
  gainPoolXp(state, skill, poolGain(amount, content), content);
}
