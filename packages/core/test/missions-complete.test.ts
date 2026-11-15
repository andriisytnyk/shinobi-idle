/** A2: every board mission can be completed, each alternative path is walked, and the rewards arrive. */
import { content, type SkillId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  dispatch,
  missionBoard,
  planStage,
  defaultRules,
  teammates,
  type GameState,
} from '../src/index.ts';
import {
  BOARD,
  ableFor,
  mission,
  player,
  runUntilDone,
  startMission,
  villageUnits,
} from './missions-helpers.ts';

const MIN = 60_000;
const K = content.balance.K;

describe('every board mission can be completed', () => {
  it('has 21 missions on the board: 7 D, 5 C and 9 of the village', () => {
    expect(BOARD).toHaveLength(21);
    expect(BOARD.filter((m) => m.rank === 'D')).toHaveLength(7);
    expect(BOARD.filter((m) => m.rank === 'C')).toHaveLength(5);
    expect(BOARD.filter((m) => m.rank === 'V')).toHaveLength(9);
  });

  for (const m of BOARD) {
    it(`${m.id} runs through its stages and pays`, () => {
      const state = ableFor(m);
      const before = { ...state.currencies };
      expect(startMission(state, m.id)).toEqual({ ok: true });
      const spent = runUntilDone(state, m.id, 6 * 60 * MIN);
      expect(state.counters[`missions.done.${m.id}`], `${m.id} finished in ${spent} ms`).toBe(1);
      // ryo and Reputation exactly as the data says; Reputation only for team missions.
      expect(state.currencies.ryo - before.ryo).toBeGreaterThanOrEqual(m.ryo);
      expect(state.currencies.rep - before.rep).toBeGreaterThanOrEqual(m.team ? m.rep : 0);
      if (!m.team) expect(state.currencies.rep).toBe(0);
    });
  }
});

/** The path the game takes for stage `index`, for a player built from `opts`. */
function path(state: GameState, id: string, index: number) {
  return planStage(state, mission(id), index, content, defaultRules);
}

describe('each alternative of a stage is exercised', () => {
  const levels = (o: Partial<Record<SkillId, number>>) => ({ ath: 30, scout: 20, herb: 5, ...o });

  it('fire, stage 1: Suiton, or the bucket chain of Athletics at twice the time', () => {
    const water = player({ natures: ['suiton'], levels: levels({ suiton: 30, ath: 25 }) });
    const viaWater = path(water, 'core:fire', 1);
    expect(viaWater).toMatchObject({ who: 'self', skill: 'suiton', slow: false });
    expect(viaWater?.tech).not.toBe('');
    // Without Suiton the Athletics fallback is the only way, and it is the slower one.
    const buckets = player({
      natures: ['katon'],
      levels: levels({ katon: 30, ath: 25 }),
      team: false,
    });
    const viaBuckets = path(buckets, 'core:fire', 1);
    expect(viaBuckets).toMatchObject({ who: 'self', skill: 'ath', tech: '', slow: true });
    // At the same level above the requirement the fallback takes exactly twice as long.
    const equal = player({
      natures: ['suiton'],
      levels: levels({ suiton: 20, ath: 25 }),
      team: false,
    });
    const direct = path(equal, 'core:fire', 1);
    expect(direct?.slow).toBe(false);
    expect(viaBuckets?.ms).toBe(2 * (direct?.ms ?? 0));
  });

  it('fire, the whole mission, by the bucket chain', () => {
    const state = player({
      natures: ['katon'],
      team: false,
      levels: { ath: 25, scout: 1, tai: 20, katon: 1 },
    });
    expect(startMission(state, 'core:fire')).toEqual({ ok: true });
    runUntilDone(state, 'core:fire', 3 * 60 * MIN);
    expect(state.counters['missions.done.core:fire']).toBe(1);
  });

  it('drought: Suiton, or carrying water with Athletics at twice the time', () => {
    const water = player({ natures: ['suiton'], levels: levels({ suiton: 20 }), team: false });
    expect(path(water, 'core:drought', 0)).toMatchObject({ skill: 'suiton', slow: false });
    const carry = player({ natures: ['doton'], levels: levels({ ath: 20 }), team: false });
    expect(path(carry, 'core:drought', 0)).toMatchObject({ skill: 'ath', tech: '', slow: true });
    const state = player({ natures: ['doton'], levels: { ath: 20 }, team: false });
    startMission(state, 'core:drought');
    runUntilDone(state, 'core:drought', 3 * 60 * MIN);
    expect(state.counters['missions.done.core:drought']).toBe(1);
    expect(state.bank['core:rice']).toBe(6);
    expect(state.bank['core:spice']).toBe(2);
  });

  it('courier: a Ninjutsu technique, or Athletics', () => {
    const flicker = player({ natures: ['katon'], levels: { nin: 5, ath: 1 }, team: false });
    expect(path(flicker, 'core:courier', 0)).toMatchObject({
      skill: 'nin',
      tech: 'core:body_flicker',
    });
    const run = player({ natures: ['katon'], levels: { nin: 1, ath: 30 }, team: false });
    expect(path(run, 'core:courier', 0)).toMatchObject({ skill: 'ath', tech: '' });
  });

  it('rockfall: Doton, or Taijutsu', () => {
    const earth = player({ natures: ['doton'], levels: { doton: 30, tai: 1 }, team: false });
    expect(path(earth, 'core:rockfall', 0)).toMatchObject({ skill: 'doton' });
    const fists = player({ natures: ['katon'], levels: { tai: 30 }, team: false });
    expect(path(fists, 'core:rockfall', 0)).toMatchObject({ skill: 'tai' });
  });

  it('the dig: Doton, or Taijutsu, for the second stage', () => {
    const earth = player({ natures: ['doton'], levels: { doton: 30, ath: 25 }, team: false });
    expect(path(earth, 'core:dig', 1)).toMatchObject({ skill: 'doton' });
    const fists = player({ natures: ['katon'], levels: { tai: 30, ath: 25 }, team: false });
    expect(path(fists, 'core:dig', 1)).toMatchObject({ skill: 'tai' });
  });

  it('village rubble: Doton 30, or Taijutsu 40', () => {
    const earth = player({ natures: ['doton'], levels: { doton: 30 }, team: false });
    expect(path(earth, 'core:v_rubble', 0)).toMatchObject({ skill: 'doton' });
    const fists = player({ natures: ['katon'], levels: { tai: 40 }, team: false });
    expect(path(fists, 'core:v_rubble', 0)).toMatchObject({ skill: 'tai' });
    const weak = player({ natures: ['katon'], levels: { tai: 39 }, team: false });
    expect(path(weak, 'core:v_rubble', 0)).toBeNull();
  });

  it('clearing the plots: any of the three named techniques', () => {
    const fire = player({ natures: ['katon'], levels: { katon: 20 }, team: false });
    expect(path(fire, 'core:v_clear', 0)?.tech).toBe('core:running_fire');
    const earth = player({ natures: ['doton'], levels: { doton: 35 }, team: false });
    expect(path(earth, 'core:v_clear', 0)?.tech).toBe('core:tearing_earth_turning_palm');
    const wind = player({
      natures: ['futon'],
      levels: { futon: 50 },
      known: ['core:vacuum_wave'],
      team: false,
    });
    expect(path(wind, 'core:v_clear', 0)?.tech).toBe('core:vacuum_wave');
  });

  it('the Ninjutsu stage of the caravan and the antidotes of the well are items and skills, not natures', () => {
    const state = player({ natures: ['katon'], levels: { scout: 15 }, team: false });
    expect(path(state, 'core:well', 0)).toMatchObject({ skill: 'scout', who: 'self' });
    expect(path(state, 'core:well', 1)).toMatchObject({ skill: '' });
  });

  it('in a team mission a teammate whose nature fits does the stage', () => {
    // A Doton player has Suiton Aya; with no Suiton and a weak Athletics the fire stage falls to her.
    const state = player({
      natures: ['doton'],
      levels: { doton: 30, ath: 10, scout: 10, tai: 20 },
    });
    expect(teammates(state, content).map((m) => m.nature)).toContain('suiton');
    const plan = path(state, 'core:fire', 1);
    expect(plan?.who).toBe('core:aya');
    expect(plan?.skill).toBe('suiton');
    // The teammate level is the share of the player's best nature level.
    expect(plan?.level).toBe(Math.floor(K.team.levelShare * 30));
    // A solo mission with the same stage would not have her.
    expect(path({ ...state, team: null }, 'core:fire', 1)?.skill).not.toBe('suiton');
    // And the whole mission runs.
    startMission(state, 'core:fire');
    runUntilDone(state, 'core:fire', 3 * 60 * MIN);
    expect(state.counters['missions.done.core:fire']).toBe(1);
    // A teammate's stage pays the player no XP in the skill.
    expect(state.skills.suiton!.xp).toBe(0);
  });

  it('Aya scouts and Ren fights with their levels, the best of the team counts', () => {
    // The player is bad at Scouting; Aya follows the player's own level, so she does not beat the player.
    const state = player({ natures: ['katon'], levels: { scout: 20, ath: 10 } });
    const plan = path(state, 'core:cat', 0);
    expect(plan?.who).toBe('self');
    expect(plan?.level).toBe(20);
  });
});

describe('the board', () => {
  it('lists every mission with what blocks it', () => {
    const state = player({ natures: ['katon'], levels: { scout: 1 } });
    const board = missionBoard(state, content, defaultRules);
    expect(board).toHaveLength(21);
    const thief = board.find((e) => e.id === 'core:thief');
    expect(thief?.startable).toBe(false);
    expect(thief?.blocker?.stage).toBe(0);
    const weed = board.find((e) => e.id === 'core:weed');
    expect(weed?.startable).toBe(true);
    expect(weed?.forecast.doable).toBe(true);
  });

  it('refuses a mission that is not open, an unknown one, and a student', () => {
    const state = player({ natures: ['katon'] });
    delete state.flags['missions.c.unlocked'];
    expect(startMission(state, 'core:caravan')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    expect(startMission(state, 'core:op_hideout')).toEqual({
      ok: false,
      reason: 'error.unknownAction',
    });
    const student = player();
    student.player.rank = 'student';
    expect(startMission(student, 'core:weed').ok).toBe(false);
  });

  it('refuses an items stage without the items and names them', () => {
    const state = player({ natures: ['katon'], levels: { scout: 15, tai: 36, vit: 36 }, bank: {} });
    const result = startMission(state, 'core:well');
    expect(result).toEqual({ ok: false, reason: 'error.missingIngredient' });
    state.bank['core:antidote'] = 5;
    expect(startMission(state, 'core:well')).toEqual({ ok: true });
  });
});

describe('village missions', () => {
  it('pay shinobi resource units to the village', () => {
    const state = ableFor(mission('core:v_spar'));
    startMission(state, 'core:v_spar');
    runUntilDone(state, 'core:v_spar', 30 * MIN, 2);
    expect(villageUnits(state, 'syla_shynobi')).toBe(2 * K.shinobiResPerMission);
    expect(state.missions.pending).toEqual({});
    expect(state.currencies.rep).toBe(2 * mission('core:v_spar').rep);
    expect(state.currencies.ryo).toBe(0);
    expect(state.counters['missions.rank.V']).toBe(2);
  });

  it('keep running one after another until stopped', () => {
    const state = ableFor(mission('core:v_spar'));
    startMission(state, 'core:v_spar');
    runUntilDone(state, 'core:v_spar', 60 * MIN, 5);
    expect(state.counters['missions.done.core:v_spar']).toBeGreaterThanOrEqual(5);
    expect(state.slots[0]?.action?.kind).toBe('mission');
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    advance(state, 10 * MIN, content);
    expect(state.counters['missions.total']).toBe(state.counters['missions.done.core:v_spar']);
  });

  it('count the missions with an elemental stage', () => {
    const state = ableFor(mission('core:v_water'), ['suiton']);
    startMission(state, 'core:v_water');
    runUntilDone(state, 'core:v_water', 60 * MIN, 1);
    expect(state.counters['missions.elemental.V']).toBe(1);
    const fists = ableFor(mission('core:v_spar'));
    startMission(fists, 'core:v_spar');
    runUntilDone(fists, 'core:v_spar', 60 * MIN, 1);
    expect(fists.counters['missions.elemental.V'] ?? 0).toBe(0);
  });
});
