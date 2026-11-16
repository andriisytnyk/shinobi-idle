import type { ContentDb } from '@shinobi/content';
import {
  COURSE_ID,
  COURSE_KIND,
  isSkillUnlocked,
  missionGoalReq,
  skillLevel,
  type GameState,
  type Req,
  type Rules,
} from '@shinobi/core';
import { reqItemIds } from './crafts.ts';
import { nextStep } from './next-step.ts';
import { graduateRank, isAcademyRank } from './vocab.ts';

/** The entity kinds a tile can pin as the goal: the kinds the core accepts that a tile stands for. */
const PINNABLE_TILE_KINDS: ReadonlySet<string> = new Set([
  'technique',
  'exercise',
  'practice',
  'obstacle',
  'recipe',
  'item',
]);

/** Whether a tile of this entity kind has a pin. */
export const canPin = (kind: string): boolean => PINNABLE_TILE_KINDS.has(kind);

/** The requirement tree of the goal "learn this technique": the technique, its level and its rank. */
export function techniqueGoal(id: string, content: ContentDb): Req | null {
  const tech = content.techniques.find((t) => t.id === id);
  if (!tech) return null;
  const of: Req[] = [
    { t: 'technique', id },
    { t: 'skill', skill: tech.skill, level: tech.level },
  ];
  if (tech.src === 'N' && tech.mentor === 'other') {
    of.push({ t: 'rank', rank: graduateRank(content) ?? '' });
  }
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
    if (t.mentor !== 'academy' && isAcademyRank(content, state.player.rank)) continue;
    if (!isSkillUnlocked(state, t.skill, content)) continue;
    const gap = t.level - skillLevel(state, t.skill, content);
    if (gap <= 0) continue;
    if (best === null || gap < best.gap || (gap === best.gap && t.level < best.level)) {
      best = { id: t.id, gap, level: t.level };
    }
  }
  return best?.id ?? null;
}

/** The requirement tree behind a pinned goal; null for a goal that is only a link, with no tree. */
export function goalReq(ref: { kind: string; id: string }, content: ContentDb): Req | null {
  if (ref.kind === 'technique') return techniqueGoal(ref.id, content);
  if (ref.kind === 'item') return { t: 'item', id: ref.id, n: 1 };
  return null;
}

/** The action kind that does a goal of this entity kind: its requirements are the goal's tree. */
const GOAL_ACTION: Readonly<Record<string, string>> = {
  recipe: 'craft',
  exercise: 'drill',
  practice: 'meditate',
};

/** The action kind that gathers a herb, which is an item. */
const GATHER = 'gather';

/**
 * The requirement tree of a pinned goal, for the goal panel: what the entity asks for. A technique
 * and an item have their own trees; a recipe, an exercise and a practice ask what their action
 * asks; an obstacle asks the Athletics level of its slot and its own requirement; a herb asks what
 * gathering it asks, then having one. Null for a goal that is only a link.
 */
export function goalTree(
  state: GameState,
  ref: { kind: string; id: string },
  content: ContentDb,
  rules: Rules,
): Req | null {
  // A mission's tree is core's: what opens it and the first stage that has no way yet.
  if (ref.kind === 'mission') {
    const mission = content.missions.find((m) => m.id === ref.id);
    return mission ? missionGoalReq(state, mission, content, rules) : null;
  }
  const own = goalReq(ref, content);
  const actionKind = GOAL_ACTION[ref.kind] ?? (ref.kind === 'item' ? GATHER : undefined);
  const kind = actionKind ? rules.actionKinds[actionKind] : undefined;
  if (kind) {
    const asked = kind.has(ref.id, content)
      ? kind.requirements(state, ref.id, content, rules)
      : null;
    if (!asked) return own;
    return own ? { t: 'all', of: [asked, own] } : asked;
  }
  if (ref.kind === 'obstacle') {
    const obstacle = content.obstacles.find((o) => o.id === ref.id);
    const skill = rules.actionKinds[COURSE_KIND]?.skill?.(COURSE_ID, content);
    if (!obstacle || !skill) return null;
    const of: Req[] = [{ t: 'skill', skill, level: obstacle.level }];
    if (obstacle.req) of.push(obstacle.req);
    return { t: 'all', of };
  }
  return own;
}

/**
 * The requirement tree the goal panel shows now: the pinned goal's tree; with nothing pinned, the
 * objective of the quest step under way; with no quest, the suggested technique. Null when none.
 */
export function shownGoalReq(state: GameState, content: ContentDb, rules: Rules): Req | null {
  if (state.goal) return goalTree(state, state.goal, content, rules);
  const step = nextStep(state, content);
  if (step) return step.objective.t === 'req' ? step.objective.req : null;
  const suggestion = suggestGoal(state, content);
  return suggestion ? techniqueGoal(suggestion, content) : null;
}

/** Ids of the items the shown goal's requirement tree asks for. */
export function goalItemIds(state: GameState, content: ContentDb, rules: Rules): string[] {
  return reqItemIds(shownGoalReq(state, content, rules));
}

/** The technique a goal pinned by an older version of the app pointed at: its first technique row. */
export function legacyGoalTechnique(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const node = raw as { t?: unknown; id?: unknown; of?: unknown };
  if (node.t === 'technique' && typeof node.id === 'string') return node.id;
  if (Array.isArray(node.of)) {
    for (const child of node.of) {
      const found = legacyGoalTechnique(child);
      if (found) return found;
    }
  }
  return null;
}
