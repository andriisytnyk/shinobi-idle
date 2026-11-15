/** A10: how long a dedicated explorer needs to reach Scouting 20 and 50 on the best available cells. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  cellLevel,
  cellMaxLevel,
  defaultRules,
  dispatch,
  EXPLORE_KIND,
  exploreIntervalMs,
  exploreReq,
  paceLevel,
  skillLevel,
  type GameState,
} from '../src/index.ts';
import { evalReq } from '../src/requirements.ts';
import { genin } from './helpers.ts';

const MINUTE = 60_000;

/** The cell with the best pace level that can be explored by a player without any key. */
function bestCell(state: GameState): string | null {
  let best: string | null = null;
  let bestPace = -1;
  for (const cell of content.cells) {
    if (cell.key !== null || cellLevel(state, cell, content) >= cellMaxLevel(cell, content))
      continue;
    const req = exploreReq(state, cell, content);
    if (!req || !evalReq(state, req, content).met) continue;
    const region = content.regions.find((r) => r.id === cell.region);
    if (!region) continue;
    const pace = paceLevel(region, cellLevel(state, cell, content) + 1, content);
    if (pace > bestPace) {
      bestPace = pace;
      best = cell.id;
    }
  }
  return best;
}

/** Game minutes until Scouting reaches each of `targets`, exploring the best keyless cell all the time. */
function explorerMinutes(targets: number[]): number[] {
  const state = genin(1);
  const result: number[] = [];
  const step = exploreIntervalMs(state, content, defaultRules);
  for (const target of targets) {
    for (let guard = 0; skillLevel(state, 'scout', content) < target; guard++) {
      if (guard > 200_000) throw new Error('the explorer is stuck');
      const cellId = bestCell(state);
      if (!cellId)
        throw new Error(`no cell to explore at Scouting ${skillLevel(state, 'scout', content)}`);
      const cell = content.cells.find((c) => c.id === cellId);
      const here = content.cells.find((c) => c.id === state.world.location);
      if (cell && here?.region !== cell.region) {
        const outpost = content.cells.find(
          (c) => c.region === cell.region && c.pois.some((p) => p.kind === 'outpost'),
        );
        if (outpost)
          dispatch(state, { type: 'world.travel', cell: outpost.id, mode: 'instant' }, content);
      }
      const running = state.slots[0]?.action;
      if (running?.id !== cellId) {
        const r = dispatch(
          state,
          { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id: cellId },
          content,
        );
        if (!r.ok) throw new Error(`cannot explore ${cellId}: ${r.reason}`);
      }
      advance(state, step, content);
    }
    result.push(state.now / MINUTE);
  }
  return result;
}

describe('A10: exploration pace', () => {
  it('takes a dedicated explorer 25-45 minutes to Scouting 20 and 90-150 to Scouting 50', () => {
    const [to20, to50] = explorerMinutes([20, 50]);
    console.log(
      `A10 pace: Scouting 20 after ${to20?.toFixed(1)} min, Scouting 50 after ${to50?.toFixed(1)} min`,
    );
    expect(to20).toBeGreaterThanOrEqual(25);
    expect(to20).toBeLessThanOrEqual(45);
    expect(to50).toBeGreaterThanOrEqual(90);
    expect(to50).toBeLessThanOrEqual(150);
  });
});
