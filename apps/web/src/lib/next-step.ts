import type { ContentDb, Quest, QuestObjective } from '@shinobi/content';
import { counterValue, evalReq, type GameState, type ReqResult } from '@shinobi/core';
import { hrefFor } from './route.ts';

export type StepStatus = 'done' | 'current' | 'pending';

/** The enemy a `kills.<enemy>` counter counts, or null for any other counter. */
export function counterEnemy(counter: string): string | null {
  return counter.startsWith('kills.') ? counter.slice('kills.'.length) : null;
}

/** Where a step stands: finished steps, the active one, and those still to come. */
export function stepStatus(state: GameState, quest: Quest, index: number): StepStatus {
  const progress = state.quests[quest.id];
  if (!progress) return 'pending';
  if (progress.done || index < progress.step) return 'done';
  return index === progress.step ? 'current' : 'pending';
}

/** Counted progress of a counter objective: `n` of `of`. A finished step shows full, a coming one empty. */
export function counterProgress(
  state: GameState,
  quest: Quest,
  index: number,
  objective: Extract<QuestObjective, { t: 'counter' }>,
): { n: number; of: number } {
  const status = stepStatus(state, quest, index);
  const progress = state.quests[quest.id];
  const raw =
    status === 'done'
      ? objective.n
      : status === 'pending' || !progress
        ? 0
        : counterValue(state, objective.counter) - progress.base;
  return { n: Math.max(0, Math.min(objective.n, raw)), of: objective.n };
}

/** The first requirement row still unmet, searching a result tree depth first. */
function firstUnmet(node: ReqResult): ReqResult | null {
  if (node.met) return null;
  if (node.children.length === 0) return node;
  for (const child of node.children) {
    const found = firstUnmet(child);
    if (found) return found;
  }
  return node;
}

/** The page where an unmet requirement row is worked on. */
function pageFor(node: ReqResult, content: ContentDb): string {
  const req = node.req;
  switch (req.t) {
    case 'skill':
      return hrefFor({ kind: 'skill', id: req.skill });
    case 'technique': {
      const tech = content.techniques.find((t) => t.id === req.id);
      return hrefFor({ kind: 'skill', id: tech?.skill ?? 'nin' });
    }
    case 'rank':
      return '#/rank';
    case 'item':
      return '#/bank';
    case 'flag':
      return req.id === 'firstFight' ? '#/combat' : '#/quests';
    default:
      return '#/quests';
  }
}

/** The page where a quest step's objective is done. */
export function objectiveTarget(
  state: GameState,
  objective: QuestObjective,
  content: ContentDb,
): string {
  if (objective.t === 'counter') {
    return counterEnemy(objective.counter) !== null ? '#/combat' : '#/quests';
  }
  const open = firstUnmet(evalReq(state, objective.req, content));
  return open ? pageFor(open, content) : '#/quests';
}

export interface NextStep {
  quest: Quest;
  /** Index of the active step. */
  index: number;
  objective: QuestObjective;
  /** Hash of the page where the step is done. */
  target: string;
}

/** The active step of the first quest chain that is under way, or null when every chain is done. */
export function nextStep(state: GameState, content: ContentDb): NextStep | null {
  for (const quest of content.quests) {
    const progress = state.quests[quest.id];
    if (!progress || progress.done) continue;
    const step = quest.steps[progress.step];
    if (!step) continue;
    return {
      quest,
      index: progress.step,
      objective: step.objective,
      target: objectiveTarget(state, step.objective, content),
    };
  }
  return null;
}

/** Which place in the navigation a hash belongs to; a skill page also names the skill. */
export function navTarget(hash: string): { nav: string; skill: string | null } {
  const [, first = '', id = ''] = hash.split('/');
  if (first === 'skill') return { nav: 'skills', skill: decodeURIComponent(id) };
  return { nav: first, skill: null };
}
