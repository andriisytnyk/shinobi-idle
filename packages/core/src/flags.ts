import type { GameState } from './state.ts';

/**
 * Raises an unlock flag: the way later stages (exploration, quests, the Bingo book) open zones,
 * bosses and operations, which the content gates by flag. No command does it; the stage that
 * earns the unlock calls this.
 */
export function setFlag(state: GameState, id: string, value: true | number = true): void {
  state.flags[id] = value;
}
