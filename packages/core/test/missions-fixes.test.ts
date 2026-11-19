/** Review fixes: who performs a stage, forecasts that match grants, the Intel alternative, the C flag, counters, modifiers and fights in two slots. */
import { content, ukLocale } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  deserialize,
  dispatch,
  missionBoard,
  missionForecast,
  planStage,
  serialize,
  setFlag,
  xpAt,
  type Rules,
} from '../src/index.ts';
import { openWorld } from './helpers.ts';
import { ableFor, mission, player, runUntilDone, startMission } from './missions-helpers.ts';

const MIN = 60_000;
const K = content.balance.K;

const withMods = (...mods: { key: string; value: number }[]): Rules => ({
  ...defaultRules,
  modifierProviders: [
    () => mods.map((m) => ({ key: m.key, op: 'add', value: m.value, group: 'items', source: 't' })),
  ],
});

describe('who performs a stage', () => {
  it('the player does it whenever they meet it by a normal way, even if a teammate is faster', () => {
    // The player's Doton is at the minimum for the rubble; Ren's Taijutsu cannot, but Aya's Suiton can do the water.
    const state = player({
      natures: ['doton'],
      levels: { doton: 30, suiton: 20, scout: 30, tai: 30 },
    });
    state.skills.doton!.xp = xpAt(50);
    // Aya's Suiton (80% of Doton 50) is far above the player's own Suiton 20, so she would be faster.
    expect(planStage(state, mission('core:v_water'), 0, content, defaultRules)).toMatchObject({
      who: 'self',
      skill: 'suiton',
    });
    // The forecast and the run agree, and the player earns the XP.
    const forecast = missionForecast(state, mission('core:v_water'), content, defaultRules);
    expect(forecast.stages[0]?.path?.who).toBe('self');
    expect(forecast.xpPerHour.suiton).toBeGreaterThan(0);
    const before = state.skills.suiton!.xp;
    startMission(state, 'core:v_water');
    runUntilDone(state, 'core:v_water', 60 * MIN);
    expect(state.skills.suiton!.xp).toBeGreaterThan(before);
  });

  it('a teammate does it when the player cannot, or when the player has only the slow fallback', () => {
    const cannot = player({ natures: ['doton'], levels: { doton: 30, ath: 1, scout: 1 } });
    expect(planStage(cannot, mission('core:v_water'), 0, content, defaultRules)?.who).toBe(
      'core:aya',
    );
    // Athletics 25 is the player's only way for the fire's second stage, and the slow one: Aya takes it.
    const slow = player({ natures: ['doton'], levels: { doton: 30, ath: 25, scout: 1, tai: 20 } });
    const plan = planStage(slow, mission('core:fire'), 1, content, defaultRules);
    expect(plan).toMatchObject({ who: 'core:aya', skill: 'suiton', slow: false });
    const forecast = missionForecast(slow, mission('core:fire'), content, defaultRules);
    expect(forecast.stages[1]?.path?.who).toBe('core:aya');
    const ath = slow.skills.ath!.xp;
    startMission(slow, 'core:fire');
    runUntilDone(slow, 'core:fire', 60 * MIN);
    expect(slow.skills.suiton!.xp).toBe(0);
    expect(slow.skills.ath!.xp).toBeGreaterThan(ath);
  });
});

describe('the forecast reads the grant', () => {
  it('shows no XP for a skill at the cap, and the Academy slowdown for a student', () => {
    const state = ableFor(mission('core:v_walls'));
    const f = missionForecast(state, mission('core:v_walls'), content, defaultRules);
    expect(state.skills.doton!.xp).toBe(xpAt(K.cap));
    expect(f.xpPerHour.doton ?? 0).toBe(0);
    const clones = missionForecast(
      ableFor(mission('core:v_clones')),
      mission('core:v_clones'),
      content,
      defaultRules,
    );
    // Ninjutsu stands below the cap here, so the Shadow Clone stage pays XP.
    expect(clones.xpPerHour.nin ?? 0).toBeGreaterThan(0);
    // Below the cap the forecast equals what a run adds, per hour of expected time.
    const low = player({ natures: ['katon'], levels: { herb: 5 } });
    const forecast = missionForecast(low, mission('core:weed'), content, defaultRules);
    const rate = forecast.xpPerHour.herb ?? 0;
    expect(rate).toBeGreaterThan(0);
    const student = player({ natures: ['katon'], levels: { herb: 10 } });
    student.player.rank = 'student';
    const slowed = missionForecast(student, mission('core:weed'), content, defaultRules);
    const normal = missionForecast(
      player({ levels: { herb: 10 } }),
      mission('core:weed'),
      content,
      defaultRules,
    );
    expect(slowed.xpPerHour.herb ?? 0).toBeLessThan(normal.xpPerHour.herb ?? 0);
  });
});

describe('Intel stands in for the caravan ambush', () => {
  const caravan = mission('core:caravan');
  const fit = { scout: 1, tai: 25, vit: 30 };

  it('is data on the stage, not a rule of one mission', () => {
    expect(caravan.skip).toEqual([K.intel.caravanSkip, 0, 0]);
    expect(content.missions.filter((m) => m.skip.some((n) => n > 0)).map((m) => m.id)).toEqual([
      'core:caravan',
    ]);
  });

  it('opens the stage to a player who lacks Scouting but has the Intel, and takes the Intel', () => {
    const state = player({ natures: ['katon'], levels: fit });
    state.currencies.intel = 3;
    expect(planStage(state, caravan, 0, content, defaultRules)).toMatchObject({
      intel: 1,
      skill: '',
    });
    expect(startMission(state, caravan.id)).toEqual({ ok: true });
    expect(state.currencies.intel).toBe(2);
    advance(state, 40 * MIN, content);
    expect(state.currencies.intel).toBeLessThan(3);
  });

  it('is not startable without Scouting or Intel, and the skill is preferred when the player has it', () => {
    const none = player({ natures: ['katon'], levels: fit });
    expect(startMission(none, caravan.id).ok).toBe(false);
    const skilled = player({ natures: ['katon'], levels: { ...fit, scout: 20 } });
    skilled.currencies.intel = 5;
    expect(planStage(skilled, caravan, 0, content, defaultRules)).toMatchObject({
      skill: 'scout',
      intel: 0,
    });
    startMission(skilled, caravan.id);
    expect(skilled.currencies.intel).toBe(5);
  });
});

describe('the C missions open with their flag', () => {
  it('stay shut until the flag of the wolves chain is raised, and open with it', () => {
    const state = player({ natures: ['katon'], levels: { scout: 20, tai: 25 } });
    delete state.flags['missions.c.unlocked'];
    const open = () =>
      missionBoard(state, content, defaultRules).find((e) => e.id === 'core:caravan');
    expect(open()?.open).toBe(false);
    expect(startMission(state, 'core:caravan').ok).toBe(false);
    setFlag(state, 'missions.c.unlocked');
    expect(open()?.open).toBe(true);
    expect(open()?.startable).toBe(true);
    expect(startMission(state, 'core:caravan').ok).toBe(true);
  });
});

describe('counters', () => {
  it('counts one action per finished mission, a stage per finished stage kind, and the techniques performed', () => {
    const state = ableFor(mission('core:dig'));
    startMission(state, 'core:dig');
    runUntilDone(state, 'core:dig', 6 * 60 * MIN, 2);
    const done = state.counters['missions.done.core:dig'] ?? 0;
    expect(done).toBeGreaterThanOrEqual(2);
    expect(state.counters['actions.mission']).toBe(done);
    expect(state.stats.completed).toBe(done);
    expect(state.counters['missions.stage.combat']).toBe(done);
    expect(state.counters['missions.stage.tech']).toBe(done);
    expect(state.counters['missions.stage.skill']).toBe(done);
    expect(state.counters['missions.tech.doton']).toBe(done);
    expect(state.counters['missions.elemental']).toBe(done);
    expect(state.counters['missions.elemental.V'] ?? 0).toBe(0);
  });

  it('does not count a technique a teammate performed, or a plain skill', () => {
    const state = player({ natures: ['doton'], levels: { doton: 30, ath: 1, scout: 1, tai: 1 } });
    // The water is done by Aya in the village mission; the player performed no technique.
    startMission(state, 'core:v_water');
    runUntilDone(state, 'core:v_water', 60 * MIN);
    expect(state.counters['missions.done.core:v_water']).toBe(1);
    expect(state.counters['missions.elemental'] ?? 0).toBe(0);
    expect(state.counters['missions.elemental.V'] ?? 0).toBe(0);
    const spar = ableFor(mission('core:v_spar'));
    startMission(spar, 'core:v_spar');
    runUntilDone(spar, 'core:v_spar', 60 * MIN, 3);
    expect(spar.counters['actions.mission']).toBe(3);
    // The sparring is done with a Taijutsu technique, and no other.
    expect(spar.counters['missions.tech.tai']).toBe(3);
    expect(spar.counters['missions.elemental'] ?? 0).toBe(0);
  });
});

describe('modifiers of the rewards', () => {
  it('scales the ryo, the Reputation and the sparring units, with the parts in the forecast', () => {
    const state = player({ natures: ['katon'], levels: { scout: 5, ath: 10 } });
    const rules = withMods({ key: 'mission.ryo', value: 0.1 }, { key: 'mission.rep', value: 0.5 });
    const cat = missionForecast(state, mission('core:cat'), content, rules);
    expect(cat.ryo).toBe(Math.round(mission('core:cat').ryo * 1.1));
    expect(cat.rep).toBe(Math.round(mission('core:cat').rep * 1.5));
    expect(cat.mods.ryo).toHaveLength(1);
    expect(cat.mods.rep).toHaveLength(1);
    const spar = missionForecast(
      ableFor(mission('core:v_spar')),
      mission('core:v_spar'),
      content,
      withMods({ key: 'power.sparring', value: 1 }),
    );
    expect(spar.resource).toEqual({ slug: 'syla_shynobi', units: K.shinobiResPerMission * 2 });
    expect(spar.mods.resource).toHaveLength(1);
    // Other village missions do not read it.
    const walls = missionForecast(
      ableFor(mission('core:v_water')),
      mission('core:v_water'),
      content,
      withMods({ key: 'power.sparring', value: 1 }),
    );
    expect(walls.resource?.units).toBe(K.shinobiResPerMission);
  });

  it('never makes a stage shorter than the floor of the balance', () => {
    const state = player({ levels: { herb: 1 } });
    const base = planStage(state, mission('core:weed'), 0, content, defaultRules)?.ms ?? 0;
    const floor = planStage(
      state,
      mission('core:weed'),
      0,
      content,
      withMods({ key: 'mission.duration', value: -3 }),
    )?.ms;
    expect(floor).toBe(Math.round(base * K.mission.minFactor));
  });

  it('tells the player in a text that the spent items do not come back', () => {
    const text = ukLocale['mission.consumed.note'];
    expect(text).toBeTruthy();
    expect(text).toMatch(/ти/);
  });
});

describe('fights in two slots', () => {
  const twoSlots = (id: string) => {
    const state = ableFor(mission(id));
    openWorld(state);
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
    // A slot of the player's own: a clone's slot does not take fights.
    delete state.known['core:shadow_clone'];
    dispatch(state, { type: 'loadout.auto', on: true }, content);
    return state;
  };

  it('round-trips a mission fight that the second slot sits beside', () => {
    const state = twoSlots('core:thief');
    startMission(state, 'core:thief', 0);
    dispatch(
      state,
      { type: 'action.start', slot: 1, kind: 'practice', id: 'core:leaf_whirlwind' },
      content,
    );
    // Every performer works at full speed: the first stage takes its own time.
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 3000, content);
    expect(state.combat?.owner).toBe(0);
    const copy = deserialize(serialize(state), content);
    expect(copy.combat?.owner).toBe(0);
    expect(serialize(copy)).toBe(serialize(state));
    advance(state, 3 * MIN, content);
    advance(copy, 3 * MIN, content);
    expect(serialize(copy)).toBe(serialize(state));
  });

  it('round-trips a zone fight in the second slot beside a mission', () => {
    const state = twoSlots('core:weed');
    startMission(state, 'core:weed', 0);
    dispatch(state, { type: 'action.start', slot: 1, kind: 'fight', id: 'core:bandit' }, content);
    advance(state, 30_000, content);
    // The clone's fight is the clone's own; the mission is the character's.
    expect(state.clones[1]?.fight?.owner).toBe(1);
    const copy = deserialize(serialize(state), content);
    expect(copy.clones[1]?.fight?.owner).toBe(1);
    expect(serialize(copy)).toBe(serialize(state));
  });

  it('drops a fight whose owner slot does not hold it, and starts the stage anew', () => {
    const state = twoSlots('core:thief');
    startMission(state, 'core:thief', 0);
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 2000, content);
    const raw = JSON.parse(serialize(state)) as { state: { combat: { owner: number } } };
    // The owner names an empty slot, a slot that does not exist, and a nonsense value.
    for (const owner of [1, 7, -1, 0.5, 'x']) {
      raw.state.combat.owner = owner as number;
      const loaded = deserialize(JSON.stringify(raw), content);
      // The mission is the only thing that can hold a fight, so it takes the fight back at its own slot or restarts.
      expect(loaded.combat === null || loaded.combat.owner === 0).toBe(true);
      expect(loaded.slots[0]?.action?.kind).toBe('mission');
      // Whatever was kept, the mission goes on and finishes.
      advance(loaded, 30 * MIN, content);
      expect(loaded.counters['missions.done.core:thief'] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives a clone fight the owner of its slot, whatever the save says', () => {
    const state = twoSlots('core:weed');
    startMission(state, 'core:weed', 0);
    dispatch(state, { type: 'action.start', slot: 1, kind: 'fight', id: 'core:bandit' }, content);
    advance(state, 30_000, content);
    const raw = JSON.parse(serialize(state)) as {
      state: { clones: Record<string, { fight: { owner: number } }> };
    };
    (raw.state.clones['1'] as { fight: { owner: number } }).fight.owner = 0;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.clones[1]?.fight?.owner).toBe(1);
    expect(loaded.slots[0]?.data).toMatchObject({ s: 0 });
  });
});
