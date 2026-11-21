import type { ContentDb } from '@shinobi/content';
import {
  canBeGoal,
  COURSE_ID,
  COURSE_KIND,
  isSkillUnlocked,
  missionGoalReq,
  skillLevel,
  writtenPassed,
  type GameState,
  type Req,
  type Rules,
} from '@shinobi/core';
import { reqItemIds } from './crafts.ts';
import { activeSteps } from './next-step.ts';
import { graduateRank, isAcademyRank } from './vocab.ts';

/** Whether an entity of this kind can be pinned: the kinds the core accepts as a goal. */
export const canPin = (kind: string, content: ContentDb): boolean => canBeGoal(kind, content);

/** The requirement tree of the goal "learn this technique": the technique, its level and its rank. */
export function techniqueGoal(id: string, content: ContentDb): Req | null {
  const tech = content.techniques.find((t) => t.id === id);
  if (!tech) return null;
  const of: Req[] = [
    { t: 'technique', id },
    { t: 'skill', skill: tech.skill, level: tech.level },
  ];
  const rank = techniqueRankReq(id, content);
  if (rank) of.push(rank);
  return { t: 'all', of };
}

/** The rank a technique taught by a mentor outside the Academy asks for; null when it asks for none. */
export function techniqueRankReq(id: string, content: ContentDb): Req | null {
  const tech = content.techniques.find((t) => t.id === id);
  if (tech && tech.src === 'N' && tech.mentor === 'other') {
    return { t: 'rank', rank: graduateRank(content) ?? '' };
  }
  return null;
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
  // A quest asks the objective of its active step, when that is a requirement tree.
  if (ref.kind === 'quest') {
    const quest = content.quests.find((q) => q.id === ref.id);
    const progress = quest ? state.quests[quest.id] : undefined;
    const objective =
      quest && progress && !progress.done ? quest.steps[progress.step]?.objective : undefined;
    return objective?.t === 'req' ? objective.req : null;
  }
  // An exam asks its checklist; once the written test is passed, the rest of it.
  if (ref.kind === 'exam') {
    const exam = content.exams.find((e) => e.id === ref.id);
    if (!exam) return null;
    return exam.then && writtenPassed(state, exam) ? exam.then : exam.checklist;
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
 * The requirement trees the goal panel shows now: the active step of the main story, then each
 * pinned goal's tree; with nothing pinned, the suggested technique. Empty when none.
 */
export function shownGoalReqs(state: GameState, content: ContentDb, rules: Rules): Req[] {
  const trees: Req[] = [];
  for (const step of activeSteps(state, content)) {
    if (step.quest.main === true && step.objective.t === 'req') trees.push(step.objective.req);
  }
  for (const goal of state.goals) {
    const tree = goalTree(state, goal, content, rules);
    if (tree) trees.push(tree);
  }
  if (state.goals.length === 0) {
    const suggestion = suggestGoal(state, content);
    const tree = suggestion ? techniqueGoal(suggestion, content) : null;
    if (tree) trees.push(tree);
  }
  return trees;
}

/** Ids of the items the shown goals' requirement trees ask for. */
export function goalItemIds(state: GameState, content: ContentDb, rules: Rules): string[] {
  return [...new Set(shownGoalReqs(state, content, rules).flatMap((req) => reqItemIds(req)))];
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
