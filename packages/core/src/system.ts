import type { ContentDb } from '@shinobi/content';
import type { GameState } from './state.ts';

/**
 * A part of the game that has things happening over time: skill actions now, combat, village ticks
 * and wound healing later. `advance` asks every system when its next event is and jumps there.
 */
export interface System {
  /** Whole ms until this system next needs `run`, or null when it has nothing pending. */
  nextEventIn(state: GameState, content: ContentDb): number | null;
  /** Lets time pass without an event: progress counters move by `dt` ms. */
  elapse?(state: GameState, dt: number, content: ContentDb): void;
  /** Processes everything that is due at `state.now`. Must do nothing when nothing is due. */
  run(state: GameState, content: ContentDb): void;
}
