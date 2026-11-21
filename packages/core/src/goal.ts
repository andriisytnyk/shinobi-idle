import type { ContentDb } from '@shinobi/content';
import type { EntityRef } from './entity.ts';
import type { GameState } from './state.ts';

/**
 * The most goals a player may keep pinned at once. The meta panel has to stay readable on a phone
 * beside the story step, so the cap is small; five is the story-free budget: a technique, a craft,
 * a mission, a quest chain and one more at the same time. The story chain itself is not counted.
 */
export const GOAL_CAP = 5;

/** Whether the reference is a chain of the main story: those are always among the goals and cannot be unpinned. */
export function isStoryGoal(ref: EntityRef, content: ContentDb): boolean {
  return ref.kind === 'quest' && content.quests.some((q) => q.id === ref.id && q.main === true);
}

/** The same goal: same kind, same id. */
export const sameGoal = (a: EntityRef, b: EntityRef): boolean => a.kind === b.kind && a.id === b.id;

/** Pins a goal at the end of the list. Nothing happens when it is already pinned or the list is full; returns whether it was added. */
export function pinGoal(state: GameState, ref: EntityRef): boolean {
  if (state.goals.some((g) => sameGoal(g, ref)) || state.goals.length >= GOAL_CAP) return false;
  state.goals.push({ kind: ref.kind, id: ref.id });
  return true;
}

/** The content lists whose entities a goal may point at: the one registry of what can be pinned. */
export const GOAL_LISTS: ReadonlySet<string> = new Set([
  'techniques',
  'skills',
  'items',
  'enemies',
  'quests',
  'missions',
  'recipes',
  'exercises',
  'practices',
  'obstacles',
]);

/** The entity kinds that can be pinned as the goal, read from the kinds of the content (packs may add some). */
export function goalKinds(content: ContentDb): string[] {
  return content.entityKinds
    .filter((k) => k.list !== null && k.list !== undefined && GOAL_LISTS.has(k.list))
    .map((k) => k.id);
}

/** Whether entities of this kind can be pinned as the goal. */
export const canBeGoal = (kind: string, content: ContentDb): boolean =>
  goalKinds(content).includes(kind);
