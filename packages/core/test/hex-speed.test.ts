/** Offline catch-up on the map: 12 game hours of auto-survey and of walking cost about what practice costs. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  AUTOSURVEY_ID,
  AUTOSURVEY_KIND,
  autoPlan,
  deserialize,
  dispatch,
  hexKey,
  hexKeyIds,
  serialize,
  travelPlan,
  type GameState,
} from '../src/index.ts';
import { genin, setLevel } from './helpers.ts';
import { bestOf, speedBudget, speedIt } from './speed.ts';

const HOUR = 3_600_000;
const MIN = 60_000;

function autoSurveying(scout: number): GameState {
  const state = genin(1);
  setLevel(state, 'scout', scout);
  const r = dispatch(
    state,
    { type: 'action.start', slot: 0, kind: AUTOSURVEY_KIND, id: AUTOSURVEY_ID },
    content,
  );
  expect(r).toEqual({ ok: true });
  return state;
}

describe('A11: the map is quick offline', () => {
  speedIt(
    '12 hours of auto-survey finish within the speed budget (500 ms on the reference machine, never above 2 s)',
    () => {
      // The same kind of budget as 12 hours of practice: scaled to the machine, the best of several runs.
      const limit = speedBudget(500, 2000);
      const best = bestOf(5, limit, () => {
        const state = autoSurveying(1);
        advance(state, 12 * HOUR, content);
        expect(state.now).toBe(12 * HOUR);
        // It really surveyed (and kept going), not stopped at once.
        expect(Object.keys(state.world.surveyed).length).toBeGreaterThan(60);
      });
      expect(best).toBeLessThan(limit);
    },
  );

  speedIt(
    '12 hours of walking from one end of the surveyed land to the other and back finish within the budget',
    () => {
      const limit = speedBudget(500, 2000);
      const best = bestOf(5, limit, () => {
        const state = genin(1);
        // All the land is surveyed: the walk is a plain search over the whole grid.
        for (const h of content.hexes) if (h.terrain) state.world.surveyed[hexKey(h.q, h.r)] = true;
        // The far end is the last cell that needs no key (a keyed one is not reachable on foot without it).
        const far = content.cells.findLast(
          (c) => hexKeyIds(content, hexKey(c.hex[0], c.hex[1])).length === 0,
        );
        const ends = ['core:okolytsi_sela', far?.id ?? ''];
        let walked = 0;
        for (let leg = 0; walked < 12 * HOUR; leg++) {
          const to = ends[(leg + 1) % 2] ?? '';
          const plan = travelPlan(state, to, content);
          expect(plan.blocked, to).toBeNull();
          expect(dispatch(state, { type: 'world.travel', cell: to }, content)).toEqual({
            ok: true,
          });
          advance(state, plan.ms + MIN, content);
          walked += plan.ms + MIN;
          expect(state.world.location).toBe(to);
        }
      });
      expect(best).toBeLessThan(limit);
    },
  );

  it('the plan that is kept between cycles is the plan a fresh search would make', () => {
    const state = autoSurveying(1);
    for (let i = 0; i < 150; i++) {
      advance(state, 7 * MIN + 13, content);
      // A copy through a save has no memory of its own: its plan is made from nothing.
      const fresh = deserialize(serialize(state), content);
      expect(autoPlan(state, content), `after ${i + 1} steps`).toEqual(autoPlan(fresh, content));
    }
  });
});
