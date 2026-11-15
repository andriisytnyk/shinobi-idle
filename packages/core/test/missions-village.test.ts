/** Village missions pay the village's shinobi resources; units earned before a village exists wait and are handed over. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  deserialize,
  dispatch,
  payMission,
  serialize,
  type GameState,
} from '../src/index.ts';
import { ableFor, mission, runUntilDone, startMission, villageUnits } from './missions-helpers.ts';

const MIN = 60_000;
const UNITS = content.balance.K.shinobiResPerMission;

/** Every village mission, with the resource it brings. */
const village = content.missions.filter((m) => m.rank === 'V' && m.resource);

describe('village missions raise the village resources', () => {
  for (const m of village) {
    it(`${m.id} adds ${m.resource}`, () => {
      const state = ableFor(m);
      expect(
        dispatch(state, { type: 'action.start', slot: 0, kind: 'mission', id: m.id }, content).ok,
      ).toBe(true);
      runUntilDone(state, m.id, 60 * MIN, 2);
      expect(state.village).not.toBeNull();
      expect(villageUnits(state, m.resource ?? '')).toBe(2 * UNITS);
      expect(state.missions.pending).toEqual({});
    });
  }

  it('stops at the store limit like any other source: the rest is lost', () => {
    const state = ableFor(mission('core:v_water'));
    startMission(state, 'core:v_water');
    runUntilDone(state, 'core:v_water', 60 * MIN, 1);
    const have = villageUnits(state, 'zroshennia');
    expect(have).toBe(UNITS);
    // Fill the store, then finish another mission: nothing is added, and nothing waits.
    for (let i = 0; i < 200; i++)
      payMission(state, mission('core:v_water'), [], content, defaultRules);
    expect(villageUnits(state, 'zroshennia')).toBeLessThan(have + 200 * UNITS);
    expect(state.missions.pending).toEqual({});
  });
});

describe('units that wait for a village', () => {
  /** A genin who has no village yet (as a save from before the village would load). */
  function withoutVillage(): GameState {
    const state = ableFor(mission('core:v_spar'));
    state.village = null;
    return state;
  }

  it('wait in the pending bucket, and are handed over when the village appears', () => {
    const state = withoutVillage();
    payMission(state, mission('core:v_spar'), [], content, defaultRules);
    payMission(state, mission('core:v_water'), [], content, defaultRules);
    expect(state.missions.pending).toEqual({ syla_shynobi: UNITS, zroshennia: UNITS });
    expect(state.village).toBeNull();
    // Time passes under a running mission: the village appears and takes what waited.
    startMission(state, 'core:v_spar');
    advance(state, 10 * MIN, content);
    expect(state.village).not.toBeNull();
    expect(state.missions.pending).toEqual({});
    expect(villageUnits(state, 'zroshennia')).toBe(UNITS);
    expect(villageUnits(state, 'syla_shynobi')).toBeGreaterThanOrEqual(UNITS);
  });

  it('are drained by the next finished mission when a village exists', () => {
    const state = ableFor(mission('core:v_spar'));
    state.missions.pending = { zroshennia: 4 };
    payMission(state, mission('core:v_spar'), [], content, defaultRules);
    expect(state.missions.pending).toEqual({});
    expect(villageUnits(state, 'zroshennia')).toBe(4);
  });
});

describe('saves with units waiting', () => {
  it('migrates a version 11 save (the village, no missions branch) to version 12', () => {
    const state = ableFor(mission('core:v_spar'));
    const raw = JSON.parse(serialize(state)) as { v: number; state: Record<string, unknown> };
    raw.v = 11;
    raw.state.v = 11;
    delete raw.state.missions;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBeGreaterThanOrEqual(12);
    expect(loaded.missions).toEqual({ pending: {} });
    expect(loaded.village).not.toBeNull();
  });

  it('hands the units that wait to the village that a loaded genin gets', () => {
    const state = ableFor(mission('core:v_spar'));
    state.village = null;
    payMission(state, mission('core:v_spar'), [], content, defaultRules);
    const text = serialize(state);
    expect(JSON.parse(text).state.missions.pending).toEqual({ syla_shynobi: UNITS });
    // The save of a genin has no village; loading gives it one, and the units go into it.
    const loaded = deserialize(text, content);
    expect(loaded.village).not.toBeNull();
    expect(loaded.missions.pending).toEqual({});
    expect(villageUnits(loaded, 'syla_shynobi')).toBe(UNITS);
  });

  it('keeps the units for a player who still has no village (a student)', () => {
    const state = ableFor(mission('core:v_spar'));
    state.player.rank = 'student';
    state.village = null;
    state.missions.pending = { zroshennia: 2 };
    const loaded = deserialize(serialize(state), content);
    expect(loaded.village).toBeNull();
    expect(loaded.missions.pending).toEqual({ zroshennia: 2 });
  });
});
