import type { ContentDb } from '@shinobi/content';
import type { Command, CommandResult, GameState } from '@shinobi/core';
import { legacyGoalTechnique } from './goal.ts';
import { SETTINGS_KEY, type TextStorage } from './settings.svelte.ts';

interface GoalHost {
  state: GameState;
  content: ContentDb;
  dispatch(command: Command): CommandResult;
}

/**
 * Moves the goal that older versions kept in the local settings into `state.goal`, once. A goal
 * already in the game wins; the local value is removed either way. Returns whether the game got
 * a goal from it.
 */
export function migrateLocalGoal(storage: TextStorage | null, game: GoalHost): boolean {
  if (!storage) return false;
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    raw = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  if (!('goal' in raw)) return false;

  let moved = false;
  const id = game.state.goal === null ? legacyGoalTechnique(raw.goal) : null;
  if (id !== null && game.content.techniques.some((t) => t.id === id)) {
    moved = game.dispatch({ type: 'goal.set', ref: { kind: 'technique', id } }).ok;
  }
  delete raw.goal;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(raw));
  } catch {
    // The value stays and is tried again next start; the game already has the goal.
  }
  return moved;
}
