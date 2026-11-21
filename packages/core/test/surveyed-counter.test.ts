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
  evalReq,
  exploreReq,
  hexDistance,
  hexKey,
  regionOfHex,
  serialize,
  subjectOf,
  surveyedKey,
  updateQuests,
  type GameState,
} from '../src/index.ts';
import { genin, openWorld, setLevel, teleport } from './helpers.ts';

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
  it('does not count the hexes the start of a game surveyed: a new game has every counter at 0', () => {
    const state = createState(1, content);
    const seeded = subjects.filter(
      ({ subject }) =>
        !subject.cell &&
        (state.world.explores[subject.address] ?? 0) >= (K.map.plainSurvey[0] ?? 1),
    );
    expect(seeded.length).toBeGreaterThan(0);
    for (const region of content.regions) {
      expect(counterValue(state, surveyedKey(region.id)), region.id).toBe(0);
    }
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

  it('is counted from the surveys when a save made before the counter is migrated, without the start seed', () => {
    const state = fresh();
    const cell = content.cells.find((c) => c.region === FOREST && !state.world.explores[c.id]);
    if (!cell) throw new Error('no unexplored forest cell');
    surveyToLevelOne(state, cell.id);
    const seed = createState(1, content).world.explores;
    const now = subjects.filter(
      ({ subject, region }) =>
        region === FOREST &&
        seed[subject.address] !== state.world.explores[subject.address] &&
        (state.world.explores[subject.address] ?? 0) >=
          ((subject.cell ? K.cellExplores[0] : K.map.plainSurvey[0]) ?? 1),
    ).length;
    expect(now).toBeGreaterThan(0);
    const parsed = JSON.parse(serialize(state, 5)) as {
      v: number;
      state: Record<string, unknown> & { counters: Record<string, number> };
    };
    // A save of version 22: one pinned goal, no surveyed counters.
    parsed.v = 22;
    parsed.state.goal = null;
    delete parsed.state.goals;
    for (const key of Object.keys(parsed.state.counters)) {
      if (key.startsWith(surveyedKey(''))) delete parsed.state.counters[key];
    }
    const loaded = deserialize(JSON.stringify(parsed), content);
    expect(counterValue(loaded, surveyedKey(FOREST))).toBe(now);
    // An existing list of goals is kept by the migration.
    parsed.state.goals = [{ kind: 'technique', id: 'core:great_fireball' }];
    parsed.state.goal = { kind: 'technique', id: 'core:clone' };
    expect(deserialize(JSON.stringify(parsed), content).goals).toEqual([
      { kind: 'technique', id: 'core:great_fireball' },
    ]);
  });

  describe('the exploration step of the mission board', () => {
    const quest = content.quests.find((q) => q.id === 'core:mission_board');
    const step = quest?.steps.find(
      (s) => s.objective.t === 'counter' && s.objective.counter === surveyedKey(FOREST),
    );
    const objective = step?.objective;
    const at = quest && step ? quest.steps.indexOf(step) : -1;
    const n = objective?.t === 'counter' ? objective.n : 0;
    const progressOf = (state: GameState) => state.quests['core:mission_board'];

    it('reads the counter and counts what was surveyed before the step', () => {
      expect(objective).toMatchObject({ t: 'counter', total: true });
      expect(n).toBeGreaterThan(0);
    });

    it('is not done when a fresh game reaches it: the start area does not count', () => {
      const state = fresh();
      progressOf(state);
      state.quests['core:mission_board'] = { step: at, base: 0, done: false };
      updateQuests(state, content);
      expect(progressOf(state)?.step).toBe(at);
      expect(counterValue(state, surveyedKey(FOREST))).toBe(0);
    });

    it('is done once n hexes of the region were surveyed, those surveyed before the step included', () => {
      const state = fresh();
      for (const skill of content.skills) setLevel(state, skill.id, 60);
      // Cells of the forest that the player can survey now.
      const mine = subjects.filter(({ subject, region }) => {
        if (region !== FOREST || !subject.cell) return false;
        const need = exploreReq(state, subject.cell, content);
        return need !== null && evalReq(state, need, content).met;
      });
      expect(mine.length).toBeGreaterThanOrEqual(n);
      for (const { subject } of mine.slice(0, n - 1)) surveyToLevelOne(state, subject.address);
      state.quests['core:mission_board'] = { step: at, base: 0, done: false };
      updateQuests(state, content);
      expect(counterValue(state, surveyedKey(FOREST))).toBe(n - 1);
      expect(progressOf(state)?.step).toBe(at);
      const last = mine[n - 1];
      if (!last) throw new Error('not enough cells');
      surveyToLevelOne(state, last.subject.address);
      expect(progressOf(state)?.step).not.toBe(at);
    });
  });
});
