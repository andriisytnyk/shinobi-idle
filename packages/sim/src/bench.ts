import { content } from '@shinobi/content';
import { advance, createState, dispatch, type Command } from '@shinobi/core';

const HOUR_MS = 3_600_000;
const GAME_HOURS = 12;

export interface BenchResult {
  label: string;
  gameHours: number;
  ms: number;
  hoursPerSecond: number;
}

/** Wall time to advance 12 game hours with `command` kept running (restarted if it ends). */
function measure(label: string, command: Command): BenchResult {
  const state = createState(1, content);
  let elapsed = 0;
  for (let hour = 0; hour < GAME_HOURS; hour++) {
    if (!state.slots[0]?.action) dispatch(state, command, content);
    const t0 = performance.now();
    advance(state, HOUR_MS, content);
    elapsed += performance.now() - t0;
  }
  return {
    label,
    gameHours: GAME_HOURS,
    ms: elapsed,
    hoursPerSecond: GAME_HOURS / (elapsed / 1000),
  };
}

/** Measures `advance` over 12 game hours of practice and of a running fight. */
export function runBench(): BenchResult[] {
  return [
    measure('практика', {
      type: 'action.start',
      slot: 0,
      kind: 'practice',
      id: 'core:leaf_whirlwind',
    }),
    measure('бій', { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' }),
  ];
}
