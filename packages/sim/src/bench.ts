import {
  advance,
  createState,
  dispatch,
  performerMaxHp,
  VITALITY_SKILL,
  xpAt,
  type Command,
  type GameState,
} from '@shinobi/core';
import { buildEnvironment, type Environment } from './env.ts';

const HOUR_MS = 3_600_000;
const GAME_HOURS = 12;

export interface BenchResult {
  label: string;
  gameHours: number;
  ms: number;
  hoursPerSecond: number;
  /** Finished action cycles and the times the action had to be started again (it ended early). */
  cycles: number;
  restarts: number;
}

/** Wall time to advance 12 game hours with `command` kept running (restarted if it ends). */
function measure(
  label: string,
  command: Command,
  { content, rules }: Environment,
  prepare?: (state: GameState) => void,
): BenchResult {
  const state = createState(1, content);
  prepare?.(state);
  let elapsed = 0;
  let restarts = 0;
  for (let hour = 0; hour < GAME_HOURS; hour++) {
    if (!state.slots[0]?.action) {
      if (hour > 0) restarts++;
      dispatch(state, command, content, rules);
    }
    const t0 = performance.now();
    advance(state, HOUR_MS, content, rules);
    elapsed += performance.now() - t0;
  }
  return {
    label,
    gameHours: GAME_HOURS,
    ms: elapsed,
    hoursPerSecond: GAME_HOURS / (elapsed / 1000),
    cycles: state.stats.completed,
    restarts,
  };
}

/** Measures `advance` over 12 game hours of practice and of a running fight. */
export function runBench(env: Environment = buildEnvironment()): BenchResult[] {
  return [
    measure(
      'практика',
      { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' },
      env,
    ),
    measure(
      'бій',
      { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' },
      env,
      // Health does not come back between fights, so the one that fights for twelve hours is a character the dummy cannot hurt much: strong, at full health.
      (state) => {
        const vit = state.skills[VITALITY_SKILL];
        if (vit) vit.xp = xpAt(40);
        state.player.hp = performerMaxHp(state, env.content);
      },
    ),
  ];
}
