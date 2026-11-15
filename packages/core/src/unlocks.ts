import type { ContentDb } from '@shinobi/content';
import { emit } from './events.ts';
import { skillLevel } from './requirements.ts';
import type { GameState } from './state.ts';

/**
 * Marks mentor techniques as known once their skill level is reached. The home Academy teaches at
 * any rank; any other mentor only from genin. Scrolls, carriers and quests never auto-unlock.
 * Returns the ids learned now; emits `techniqueLearned` for each unless `silent`.
 */
export function refreshUnlocks(state: GameState, content: ContentDb, silent = false): string[] {
  const learned: string[] = [];
  for (const t of content.techniques) {
    if (state.known[t.id] || t.src !== 'N') continue;
    if (t.mentor !== 'academy' && state.player.rank === 'student') continue;
    if (skillLevel(state, t.skill, content) < t.level) continue;
    state.known[t.id] = true;
    learned.push(t.id);
    if (!silent) emit(state, { type: 'techniqueLearned', id: t.id });
  }
  return learned;
}
