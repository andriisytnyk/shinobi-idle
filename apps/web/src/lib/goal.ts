import type { ContentDb } from '@shinobi/content';
import { isSkillUnlocked, skillLevel, type GameState, type Req } from '@shinobi/core';

/** The requirement tree of the goal "learn this technique": the technique, its level and its rank. */
export function techniqueGoal(id: string, content: ContentDb): Req | null {
  const tech = content.techniques.find((t) => t.id === id);
  if (!tech) return null;
  const of: Req[] = [
    { t: 'technique', id },
    { t: 'skill', skill: tech.skill, level: tech.level },
  ];
  if (tech.src === 'N' && tech.mentor === 'other') of.push({ t: 'rank', rank: 'genin' });
  return { t: 'all', of };
}

/**
 * The technique to suggest when nothing is pinned: of the unlocked skills' trainer techniques that
 * the player does not know yet and can learn from the mentor at their rank, the one that is
 * nearest in levels. These are gated by level only.
 */
export function suggestGoal(state: GameState, content: ContentDb): string | null {
  let best: { id: string; gap: number; level: number } | null = null;
  for (const t of content.techniques) {
    if (t.src !== 'N' || state.known[t.id]) continue;
    if (t.mentor !== 'academy' && state.player.rank === 'student') continue;
    if (!isSkillUnlocked(state, t.skill, content)) continue;
    const gap = t.level - skillLevel(state, t.skill, content);
    if (gap <= 0) continue;
    if (best === null || gap < best.gap || (gap === best.gap && t.level < best.level)) {
      best = { id: t.id, gap, level: t.level };
    }
  }
  return best?.id ?? null;
}
