import type { ContentDb, Quest, QuestObjective } from '@shinobi/content';
import {
  counterValue,
  evalReq,
  examFor,
  exploredKey,
  missionDoneKey,
  NATURES_GAINED,
  surveyedKey,
  type GameState,
  type ReqResult,
} from '@shinobi/core';
import { itemPlace } from './crafts.ts';
import { hrefFor } from './route.ts';

export type StepStatus = 'done' | 'current' | 'pending';

/** The enemy a `kills.<enemy>` counter counts, or null for any other counter. */
export function counterEnemy(counter: string): string | null {
  return counter.startsWith('kills.') ? counter.slice('kills.'.length) : null;
}

/** The region an `explored.<region>` (cells explored) or `surveyed.<region>` (hexes surveyed to level 1) counter counts, with which of the two it is; null for any other counter. */
export function counterRegion(counter: string): { region: string; surveyed: boolean } | null {
  const surveyed = surveyedKey('');
  const explored = exploredKey('');
  if (counter.startsWith(surveyed))
    return { region: counter.slice(surveyed.length), surveyed: true };
  if (counter.startsWith(explored))
    return { region: counter.slice(explored.length), surveyed: false };
  return null;
}

/** The mission a `missions.done.<mission>` counter counts, or null for any other counter. */
export function counterMission(counter: string): string | null {
  const prefix = missionDoneKey('');
  return counter.startsWith(prefix) ? counter.slice(prefix.length) : null;
}

/** A label for the counters that name no entity: missions of a rank, village missions with an element stage, natures taken. Null for the rest. */
export function counterLabel(
  counter: string,
): { key: string; params: Record<string, string> } | null {
  const rank = counter.match(/^missions.rank.(.+)$/);
  if (rank) return { key: 'quests.missionsRank', params: { rank: rank[1] ?? '' } };
  if (counter.startsWith('missions.elemental.'))
    return { key: 'quests.missionsElemental', params: {} };
  if (counter === NATURES_GAINED) return { key: 'quests.natureGained', params: {} };
  return null;
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
  const total = [objective.counter, ...(objective.also ?? [])].reduce(
    (sum, key) => sum + counterValue(state, key),
    0,
  );
  const raw =
    status === 'done'
      ? objective.n
      : status === 'pending' || !progress
        ? 0
        : total - (objective.total ? 0 : progress.base);
  return { n: Math.max(0, Math.min(objective.n, raw)), of: objective.n };
}

/** A requirement result with every row met in full: a finished step shows what it asked, whatever the player holds now. */
export function asMet(node: ReqResult): ReqResult {
  return { ...node, met: true, current: node.target, children: node.children.map(asMet) };
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

/** The world page focused on what a map flag is about: a point of interest, a deposit or a region; null for other flags. */
export function flagPage(id: string, content: ContentDb): string | null {
  if (id.startsWith('poi.')) {
    const poi = id.slice('poi.'.length);
    const cell = content.cells.find((c) => c.pois.some((p) => p.id === poi));
    return cell ? hrefFor({ kind: 'cell', id: cell.id }) : '#/world';
  }
  const region = /^region.([^.]+).unlocked$/.exec(id);
  if (region) {
    const found = content.regions.find((r) => r.id.slice(r.id.lastIndexOf(':') + 1) === region[1]);
    return found ? hrefFor({ kind: 'region', id: found.id }) : '#/world';
  }
  if (id.startsWith('deposit.') || id.startsWith('point.')) return '#/world';
  // An operation that is a mission of the board or of a place is read on the mission's page; the exam's own parts on the rank page.
  const op = content.operations.find((o) => o.clearFlag === id);
  if (op) {
    return content.missions.some((m) => m.id === op.id)
      ? hrefFor({ kind: 'mission', id: op.id })
      : '#/rank';
  }
  if (id.startsWith('exam.')) return '#/rank';
  return null;
}

/** The page where an unmet requirement row is worked on. */
function pageFor(state: GameState, node: ReqResult, content: ContentDb): string {
  const req = node.req;
  switch (req.t) {
    case 'skill':
      return hrefFor({ kind: 'skill', id: req.skill });
    case 'technique': {
      const tech = content.techniques.find((t) => t.id === req.id);
      return tech ? hrefFor({ kind: 'skill', id: tech.skill }) : '#/skills';
    }
    case 'rank': {
      // A rank is earned by its exam: go where the exam's first missing requirement is done, or
      // to the Academy page once the whole checklist holds.
      const exam = examFor(content, req.rank);
      const open = exam ? firstUnmet(evalReq(state, exam.checklist, content)) : null;
      return open ? pageFor(state, open, content) : '#/rank';
    }
    case 'nature':
      return '#/nature';
    case 'building':
      return `#/village/${req.id}`;
    case 'item':
      return itemPlace(req.id, content) ?? '#/bank';
    case 'currency':
      // Reputation and Intel come from missions and from exploring.
      return req.role === 'study' ? '#/world' : '#/missions';
    case 'flag':
      return flagPage(req.id, content) ?? (req.id === 'firstFight' ? '#/combat' : '#/quests');
    default:
      return '#/quests';
  }
}

/**
 * The page where an enemy is fought: the fights page when its zone is open; the region page of the
 * zone while the zone is shut (the region is what opens it); the fights page for an enemy no zone holds.
 */
export function enemyPlace(state: GameState, enemy: string, content: ContentDb): string {
  const zone = content.zones.find((z) => z.enemy === enemy);
  if (!zone || !zone.unlock || evalReq(state, zone.unlock, content).met) return '#/combat';
  const region = content.regions.find(
    (r) => r.id === zone.region || r.id.slice(r.id.lastIndexOf(':') + 1) === zone.region,
  );
  return region ? hrefFor({ kind: 'region', id: region.id }) : '#/world';
}

/** The page where a quest step's objective is done. */
export function objectiveTarget(
  state: GameState,
  objective: QuestObjective,
  content: ContentDb,
): string {
  // A payment is made on the journal page, from the step's own button.
  if (objective.t === 'pay') return '#/quests';
  if (objective.t === 'counter') {
    const enemy = counterEnemy(objective.counter);
    if (enemy !== null) return enemyPlace(state, enemy, content);
    const mission = counterMission(objective.counter);
    if (mission !== null) return hrefFor({ kind: 'mission', id: mission });
    if (objective.counter === NATURES_GAINED) return '#/nature';
    // The other mission counters (by rank, in total) are worked on the board.
    if (objective.counter.startsWith('missions.')) return '#/missions';
    // Cells of a region explored: the world page on that region.
    const where = counterRegion(objective.counter);
    if (where) return hrefFor({ kind: 'region', id: where.region });
    return '#/quests';
  }
  const open = firstUnmet(evalReq(state, objective.req, content));
  return open ? pageFor(state, open, content) : '#/quests';
}

export interface NextStep {
  quest: Quest;
  /** Index of the active step. */
  index: number;
  objective: QuestObjective;
  /** Hash of the page where the step is done. */
  target: string;
}

/** The active step of one quest chain, or null when it has not started or is done. */
export function stepOf(state: GameState, quest: Quest, content: ContentDb): NextStep | null {
  const progress = state.quests[quest.id];
  if (!progress || progress.done) return null;
  const step = quest.steps[progress.step];
  if (!step) return null;
  return {
    quest,
    index: progress.step,
    objective: step.objective,
    target: objectiveTarget(state, step.objective, content),
  };
}

/** The active step of every chain that is under way, in content order (the main chain first). */
export function activeSteps(state: GameState, content: ContentDb): NextStep[] {
  const steps: NextStep[] = [];
  for (const quest of content.quests) {
    const step = stepOf(state, quest, content);
    if (step) steps.push(step);
  }
  return steps;
}

/** The active step of the first quest chain that is under way, or null when every chain is done. */
export function nextStep(state: GameState, content: ContentDb): NextStep | null {
  return activeSteps(state, content)[0] ?? null;
}

/** Which place in the navigation a hash belongs to; a skill page also names the skill. */
export function navTarget(hash: string): { nav: string; skill: string | null } {
  const [, first = '', id = ''] = hash.split('/');
  if (first === 'skill') return { nav: 'skills', skill: decodeURIComponent(id) };
  if (first === 'cell' || first === 'region' || first === 'poi')
    return { nav: 'world', skill: null };
  return { nav: first, skill: null };
}

/**
 * A requirement result without the unmet rank rows that sit beside the real objectives: the rank
 * is the outcome of the exam, so listing it as a task of its own only confuses.
 */
export function withoutRankRows(node: ReqResult): ReqResult {
  if (node.children.length === 0) return node;
  const rest = node.children.filter((c) => !(c.req.t === 'rank' && !c.met));
  return { ...node, children: (rest.length > 0 ? rest : node.children).map(withoutRankRows) };
}
