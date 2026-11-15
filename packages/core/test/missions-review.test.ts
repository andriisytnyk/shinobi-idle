/** Review round two: the Intel stage, hostile saves, stop reasons, duration breakdown, the ration limit and data over literals. */
import { readdirSync, readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  deserialize,
  dispatch,
  missionForecast,
  planStage,
  serialize,
  type Rules,
} from '../src/index.ts';
import { ableFor, mission, player, startMission } from './missions-helpers.ts';

const MIN = 60_000;
const K = content.balance.K;
const caravan = mission('core:caravan');

describe('a stage bought with Intel', () => {
  const fit = { scout: 10, tai: 25, vit: 36, eva: 36, katon: 36 };

  for (const seed of [4, 17, 20, 1, 2, 3]) {
    it(`seed ${seed}: five Intel buy five finished missions, with no second charge and no stop in between`, () => {
      const state = player({ seed, natures: ['katon'], levels: fit });
      state.currencies.intel = 5;
      expect(startMission(state, caravan.id).ok).toBe(true);
      for (
        let i = 0;
        i < 12 * 3600 && (state.counters['missions.done.core:caravan'] ?? 0) < 5;
        i++
      ) {
        advance(state, 1000, content);
        // The mission never stops before the fifth is finished.
        if ((state.counters['missions.done.core:caravan'] ?? 0) < 5)
          expect(state.slots[0]?.action).not.toBeNull();
      }
      expect(state.counters['missions.done.core:caravan']).toBe(5);
      expect(state.currencies.intel).toBe(0);
      expect(
        state.events.filter((e) => e.type === 'actionStopped' && e.cause === undefined),
      ).toEqual([]);
    });
  }

  it('some seed fails the bought ambush and still finishes without paying again', () => {
    let proved = false;
    for (let seed = 1; seed <= 60 && !proved; seed++) {
      const state = player({ seed, natures: ['katon'], levels: fit });
      state.currencies.intel = 1;
      startMission(state, caravan.id);
      let failed = false;
      for (let i = 0; i < 3600 && (state.counters['missions.done.core:caravan'] ?? 0) < 1; i++) {
        advance(state, 1000, content);
        if (state.events.some((e) => e.type === 'missionStage' && e.stage === 0 && !e.ok))
          failed = true;
      }
      if (!failed) continue;
      proved = true;
      expect(state.counters['missions.done.core:caravan']).toBe(1);
      expect(state.currencies.intel).toBe(0);
    }
    expect(proved).toBe(true);
  });

  it('stops for lack of a way when the next run cannot be paid, and names the cause, never "finished"', () => {
    const state = player({ seed: 5, natures: ['katon'], levels: fit });
    state.currencies.intel = 1;
    startMission(state, caravan.id);
    advance(state, 3 * 60 * MIN, content);
    expect(state.counters['missions.done.core:caravan']).toBe(1);
    expect(state.slots[0]?.action).toBeNull();
    const stopped = state.events.filter((e) => e.type === 'actionStopped').at(-1);
    expect(stopped).toMatchObject({ reason: 'requirements', cause: 'error.requirementsNotMet' });
  });

  it('stops for missing items and names the item', () => {
    const state = player({
      natures: ['katon'],
      levels: { scout: 15, tai: 36, vit: 36, eva: 36, katon: 36 },
      bank: { 'core:antidote': 5 },
    });
    startMission(state, 'core:well');
    advance(state, 3 * 60 * MIN, content);
    const stopped = state.events.filter((e) => e.type === 'actionStopped').at(-1);
    expect(stopped).toMatchObject({ reason: 'requirements', missing: 'core:antidote' });
  });
});

describe('a hostile save', () => {
  const NAMES = ['bogus', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'prototype'];

  /** A save of `core:mail` running, with `edit` applied to the slot's run. */
  function tampered(edit: (data: Record<string, unknown>) => void): string {
    const state = ableFor(mission('core:mail'));
    startMission(state, 'core:mail');
    advance(state, 60_000, content);
    const raw = JSON.parse(serialize(state)) as {
      state: { slots: { data: Record<string, unknown> }[] };
    };
    const data = raw.state.slots[0]?.data;
    if (!data) throw new Error('no run');
    edit(data);
    return JSON.stringify(raw);
  }

  /** Loads it, runs it for an hour, and says the mission was rebuilt and finished, with the globals untouched. */
  function survives(text: string): void {
    const loaded = deserialize(text, content);
    expect(loaded.slots[0]?.action?.kind).toBe('mission');
    expect(loaded.slots[0]?.data).toMatchObject({ s: 0 });
    advance(loaded, 60 * MIN, content);
    expect(loaded.counters['missions.done.core:mail']).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(loaded.skills.ath.xp)).toBe(true);
    expect(Reflect.has(Object, 'xp')).toBe(false);
    expect(Reflect.has(Object.prototype, 'xp')).toBe(false);
  }

  for (const name of NAMES) {
    it(`drops a plan whose skill is "${name}"`, () => {
      survives(tampered((d) => void ((d.p as Record<string, unknown>).skill = name)));
    });
    it(`drops a plan whose technique is "${name}"`, () => {
      survives(tampered((d) => void ((d.p as Record<string, unknown>).tech = name)));
    });
    it(`drops a plan whose performer is "${name}"`, () => {
      survives(tampered((d) => void ((d.p as Record<string, unknown>).who = name)));
    });
    it(`drops a run whose last style or performed skill is "${name}"`, () => {
      survives(tampered((d) => void (d.tk = [name])));
      survives(tampered((d) => void (d.st = name)));
    });
  }

  it('drops a plan with an absurd length, level, mastery or Intel', () => {
    for (const [key, value] of [
      ['ms', 1e300],
      ['ms', 2 ** 53],
      ['ms', 0],
      ['ms', -5],
      ['ms', 1.5],
      ['level', 1e9],
      ['mastery', 0],
      ['mastery', 1e9],
      ['intel', 7],
      ['chance', 2],
    ] as const) {
      survives(tampered((d) => void ((d.p as Record<string, unknown>)[key] = value)));
    }
  });

  it('cleans waiting units whose key is a name Object has', () => {
    const state = ableFor(mission('core:v_spar'));
    state.village = null;
    state.player.rank = 'student';
    const raw = JSON.parse(serialize(state)) as { state: { missions: { pending: unknown } } };
    raw.state.missions.pending = JSON.parse(
      '{"__proto__": 3, "constructor": 2, "toString": 1, "hasOwnProperty": 4, "zroshennia": 5}',
    );
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(Object.keys(loaded.missions.pending)).toEqual(['zroshennia']);
    expect(Object.getPrototypeOf(loaded.missions.pending)).toBe(Object.prototype);
  });

  it('keeps a plan that is sound', () => {
    const text = tampered(() => undefined);
    const loaded = deserialize(text, content);
    expect(JSON.parse(serialize(loaded)).state.slots[0].data).toEqual(
      JSON.parse(text).state.slots[0].data,
    );
  });
});

describe('the duration breakdown of the forecast', () => {
  const withProviders = (...mods: { key: string; value: number; source: string }[]): Rules => ({
    ...defaultRules,
    modifierProviders: [
      () =>
        mods.map((m) => ({
          key: m.key,
          op: 'add',
          value: m.value,
          group: 'items',
          source: m.source,
        })),
    ],
  });

  it('lists the parts of mission.duration with their sources, and the floor', () => {
    const state = ableFor(mission('core:weed'));
    const rules = withProviders(
      { key: 'mission.duration', value: -0.05, source: 'meditation' },
      { key: 'mission.duration', value: -0.02, source: 'obstacle' },
    );
    const f = missionForecast(state, mission('core:weed'), content, rules);
    expect(f.mods.duration.map((m) => m.source)).toEqual(['meditation', 'obstacle']);
    expect(f.mods.duration.map((m) => m.value)).toEqual([-0.05, -0.02]);
    expect(f.durationFloor).toBe(K.mission.minFactor);
  });

  it('lists the Ninjutsu parts only when a technique performs a stage', () => {
    const rules = withProviders({ key: 'mission.duration.nin', value: -0.2, source: 'pool' });
    const state = player({ natures: ['katon'], levels: { nin: 5, ath: 1 }, team: false });
    expect(state.known['core:body_flicker']).toBe(true);
    const withTech = missionForecast(state, mission('core:courier'), content, rules);
    expect(withTech.mods.durationBySkill.nin?.map((m) => m.source)).toEqual(['pool']);
    const base = planStage(state, mission('core:courier'), 0, content, defaultRules)?.ms ?? 0;
    expect(withTech.stages[0]?.ms).toBe(Math.round(base * 0.8));
    // The same skill with no technique of the level known performs nothing: the bonus is not for it.
    delete state.known['core:body_flicker'];
    const bare = missionForecast(state, mission('core:courier'), content, rules);
    expect(bare.stages[0]?.path).toMatchObject({ skill: 'nin', tech: '' });
    expect(bare.stages[0]?.ms).toBe(base);
    expect(bare.mods.durationBySkill).toEqual({});
  });
});

describe('the ration limit', () => {
  it('never holds more charges than one ration gives, and round-trips', () => {
    const state = ableFor(mission('core:weed'));
    const ration = 'core:sushenyi_paiok';
    state.bank[ration] = 5;
    expect(dispatch(state, { type: 'item.use', id: ration }, content).ok).toBe(true);
    expect(dispatch(state, { type: 'item.use', id: ration }, content)).toEqual({
      ok: false,
      reason: 'error.rationArmed',
    });
    const charges = state.buffs[ration]?.charges ?? 0;
    expect(charges).toBeLessThanOrEqual(1);
    expect(deserialize(serialize(state), content).buffs[ration]?.charges).toBe(charges);
    expect(state.bank[ration]).toBe(4);
  });
});

describe('data over literals', () => {
  const dir = new URL('../src/missions/', import.meta.url);
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  /** The code of a file without comments and template text, where a closed list or an id could hide. */
  const code = (file: string): string =>
    readFileSync(new URL(file, dir), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('has no mission rank and no skill id written in the missions code', () => {
    const skills = content.skills.map((s) => s.id).filter((id) => id.length >= 3);
    for (const file of sources) {
      const text = code(file);
      expect(text, `${file}: a rank comparison`).not.toMatch(/\brank\s*[!=]==/);
      expect(text, `${file}: a rank as a literal`).not.toMatch(/'(?:D|C|V|OP)'/);
      for (const id of skills) {
        expect(text, `${file}: the skill id '${id}'`).not.toMatch(new RegExp(`'${id}'`));
      }
    }
  });
});
