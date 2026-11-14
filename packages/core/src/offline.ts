import type { ContentDb, SkillId } from '@shinobi/content';
import { advance } from './engine.ts';
import { MS_PER_HOUR, masteryLevel } from './formulas.ts';
import type { GameState } from './state.ts';
import { levelAt } from './xp.ts';

export interface OfflineSummary {
  /** Time the caller reported, and the time actually simulated after the cap. */
  requestedMs: number;
  simulatedMs: number;
  capped: boolean;
  /** XP gained per skill, as it landed after modifiers, slowdown and the level cap. */
  skillXp: Partial<Record<SkillId, number>>;
  levelsGained: Partial<Record<SkillId, number>>;
  /** Mastery levels gained per mastery key. */
  masteryLevelsGained: Record<string, number>;
}

/**
 * Catches the game up after the app was closed. Simulates at most `offlineCapHours` of the
 * elapsed time, then reports what changed. The events of the catch-up are not queued.
 */
export function advanceOffline(
  state: GameState,
  elapsedMs: number,
  content: ContentDb,
): OfflineSummary {
  const K = content.balance.K;
  const requestedMs = Math.max(0, Math.floor(elapsedMs));
  const simulatedMs = Math.min(requestedMs, K.offlineCapHours * MS_PER_HOUR);

  const skills = Object.keys(state.skills) as SkillId[];
  const xpBefore = new Map(skills.map((s) => [s, state.skills[s].xp]));
  const levelBefore = new Map(skills.map((s) => [s, levelAt(state.skills[s].xp, K.cap)]));
  const masteryBefore = new Map(
    Object.keys(state.mastery).map((key) => [key, masteryLevel(state, key, content)]),
  );

  const queued = state.events;
  state.events = [];
  advance(state, simulatedMs, content);
  state.events = queued;

  const summary: OfflineSummary = {
    requestedMs,
    simulatedMs,
    capped: simulatedMs < requestedMs,
    skillXp: {},
    levelsGained: {},
    masteryLevelsGained: {},
  };
  for (const skill of skills) {
    const xp = state.skills[skill].xp - (xpBefore.get(skill) ?? 0);
    if (xp > 0) summary.skillXp[skill] = xp;
    const levels = levelAt(state.skills[skill].xp, K.cap) - (levelBefore.get(skill) ?? 1);
    if (levels > 0) summary.levelsGained[skill] = levels;
  }
  for (const key of Object.keys(state.mastery)) {
    const levels = masteryLevel(state, key, content) - (masteryBefore.get(key) ?? 1);
    if (levels > 0) summary.masteryLevelsGained[key] = levels;
  }
  return summary;
}
