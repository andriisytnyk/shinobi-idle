import type { ContentDb } from '@shinobi/content';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

/**
 * A part of the game that has things happening over time: skill actions now, combat, village ticks
 * and wound healing later. `advance` asks every system when its next event is and jumps there.
 * All time maths must be in whole numbers so the result does not depend on how time is chunked.
 */
export interface System {
  /** Whole ms until this system next needs `run`, or null when it has nothing pending. */
  nextEventIn(state: GameState, content: ContentDb, rules: Rules): number | null;
  /** Lets time pass without an event: progress counters move by `dt` ms. */
  elapse?(state: GameState, dt: number, content: ContentDb, rules: Rules): void;
  /** Processes everything that is due at `state.now`. Must do nothing when nothing is due. */
  run(state: GameState, content: ContentDb, rules: Rules): void;
}
