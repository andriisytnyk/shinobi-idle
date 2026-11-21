/** The `surveyed.<region>` counter: hexes of a region brought to their first survey level, cells and plain hexes alike. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  counterValue,
  createState,
  deserialize,
  dispatch,
  EXPLORE_KIND,
  hexDistance,
  hexKey,
  regionOfHex,
  serialize,
  subjectOf,
  surveyedKey,
  updateQuests,
  type GameState,
} from '../src/index.ts';
import { genin, openWorld, teleport } from './helpers.ts';

const K = content.balance.K;
const FOREST = 'core:forest';

/** Every hex the player can survey, with its region and whether it is a cell. */
const subjects = content.hexes.flatMap((h) => {
  const subject = h.terrain ? subjectOf(content, hexKey(h.q, h.r)) : null;
  return subject ? [{ subject, region: regionOfHex(content, subject) }] : [];
});

/** Surveys a hex once it is one survey short of its first level, then lets the survey finish. */
function surveyToLevelOne(state: GameState, address: string, from?: string): void {
  const subject = subjectOf(content, address);
  if (!subject) throw new Error(`no hex ${address}`);
  const first = subject.cell ? K.cellExplores[0] : K.map.plainSurvey[0];
  state.world.explores[subject.address] = (first ?? 1) - 1;
  for (const h of content.hexes) if (h.terrain) state.world.surveyed[hexKey(h.q, h.r)] = true;
  teleport(state, from ?? (subject.cell ? subject.cell.id : ''));
  const result = dispatch(
    state,
    { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id: subject.address },
    content,
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  advance(state, 3_600_000, content);
}

const fresh = (): GameState => {
  const state = genin();
  openWorld(state);
  return state;
};

describe('the surveyed counter', () => {
  it('counts the hexes of a region that the survey of the start already brought to level 1', () => {
    const state = createState(1, content);
    const expected = subjects.filter(
      ({ subject, region }) =>
        region !== null &&
        !subject.cell &&
        (state.world.explores[subject.address] ?? 0) >= (K.map.plainSurvey[0] ?? 1),
    );
    expect(expected.length).toBeGreaterThan(0);
    let total = 0;
    for (const region of content.regions) total += counterValue(state, surveyedKey(region.id));
    expect(total).toBe(expected.length);
  });

  it('counts a named cell reaching level 1 once, for its own region', () => {
    const state = fresh();
    const cell = content.cells.find((c) => c.region === FOREST && !state.world.explores[c.id]);
    if (!cell) throw new Error('no unexplored forest cell');
    const before = counterValue(state, surveyedKey(FOREST));
    surveyToLevelOne(state, cell.id);
    expect(counterValue(state, surveyedKey(FOREST))).toBe(before + 1);
    // Surveying it further does not count it again.
    const count = counterValue(state, surveyedKey(FOREST));
    state.world.explores[cell.id] = (K.cellExplores[0] ?? 1) + 1;
    advance(state, 60_000, content);
    expect(counterValue(state, surveyedKey(FOREST))).toBe(count);
  });

  it('counts a plain hex for the region of its nearest cell, and a hex of another region not at all', () => {
    const state = fresh();
    // A plain hex that touches a cell: surveyed from that cell.
    const next = (cell: { hex: number[] }) =>
      subjects.find(
        ({ subject, region }) =>
          !subject.cell &&
          region !== null &&
          hexDistance(subject.hex, { q: cell.hex[0] ?? 0, r: cell.hex[1] ?? 0 }) === 1 &&
          (state.world.explores[subject.address] ?? 0) < (K.map.plainSurvey[0] ?? 1),
      );
    const cell = content.cells.find((c) => next(c));
    const plain = cell ? next(cell) : undefined;
    if (!cell || !plain?.region) throw new Error('no plain hex to survey');
    const other = content.regions.find((r) => r.id !== plain.region);
    const own = counterValue(state, surveyedKey(plain.region));
    const foreign = counterValue(state, surveyedKey(other?.id ?? ''));
    surveyToLevelOne(state, plain.subject.address, cell.id);
    expect(counterValue(state, surveyedKey(plain.region))).toBe(own + 1);
    expect(counterValue(state, surveyedKey(other?.id ?? ''))).toBe(foreign);
  });

  it('is counted from the surveys when a save made before the counter is migrated', () => {
    const state = fresh();
    const cell = content.cells.find((c) => c.region === FOREST && !state.world.explores[c.id]);
    if (!cell) throw new Error('no unexplored forest cell');
    surveyToLevelOne(state, cell.id);
    const now = subjects.filter(
      ({ subject, region }) =>
        region === FOREST &&
        (state.world.explores[subject.address] ?? 0) >=
          ((subject.cell ? K.cellExplores[0] : K.map.plainSurvey[0]) ?? 1),
    ).length;
    expect(now).toBeGreaterThan(0);
    const parsed = JSON.parse(serialize(state, 5)) as {
      v: number;
      state: Record<string, unknown> & { counters: Record<string, number> };
    };
    // A save of version 21: one pinned goal, no surveyed counters.
    parsed.v = 21;
    parsed.state.goal = null;
    delete parsed.state.goals;
    for (const key of Object.keys(parsed.state.counters)) {
      if (key.startsWith(surveyedKey(''))) delete parsed.state.counters[key];
    }
    const loaded = deserialize(JSON.stringify(parsed), content);
    expect(counterValue(loaded, surveyedKey(FOREST))).toBe(now);
  });

  it('is what the exploration step of the mission board reads, counting what was surveyed before the step', () => {
    const quest = content.quests.find((q) => q.id === 'core:mission_board');
    const step = quest?.steps.find(
      (s) => s.objective.t === 'counter' && s.objective.counter === surveyedKey(FOREST),
    );
    expect(step?.objective).toMatchObject({ t: 'counter', total: true });
    const at = quest?.steps.indexOf(step as never) ?? -1;
    const state = fresh();
    // Cells of the forest surveyed before the chain gets to the step.
    const cells = content.cells.filter((c) => c.region === FOREST).slice(0, 2);
    for (const cell of cells) surveyToLevelOne(state, cell.id);
    const had = counterValue(state, surveyedKey(FOREST));
    state.quests['core:mission_board'] = { step: at, base: 0, done: false };
    updateQuests(state, content);
    const objective = step?.objective;
    if (objective?.t !== 'counter') throw new Error('not a counter');
    // The step needs n in all, not n more than at its start.
    const finished = state.quests['core:mission_board']?.step !== at;
    expect(finished).toBe(had >= objective.n);
  });
});
