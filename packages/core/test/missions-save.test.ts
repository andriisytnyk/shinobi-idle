/** A9: determinism and split-invariance of missions; A11: saves in the middle of a mission and the migration. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  deserialize,
  dispatch,
  serialize,
  STATE_VERSION,
  type GameState,
} from '../src/index.ts';
import { ableFor, mission, startMission } from './missions-helpers.ts';

const MIN = 60_000;

/** Runs `total` ms in steps of `chunk` (0: in one call). */
function run(state: GameState, total: number, chunk: number): GameState {
  if (chunk === 0) advance(state, total, content);
  else for (let t = 0; t < total; t += chunk) advance(state, Math.min(chunk, total - t), content);
  return state;
}

/** A player running `id`, alone in slot 0 or sharing the speed with a practice in slot 1 (shares 500 and 500). */
function scene(id: string, shared: boolean, seed = 7): GameState {
  const state = ableFor(mission(id), undefined, seed);
  if (shared) {
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
    dispatch(
      state,
      { type: 'action.start', slot: 1, kind: 'practice', id: 'core:leaf_whirlwind' },
      content,
    );
  }
  expect(startMission(state, id)).toEqual({ ok: true });
  return state;
}

describe('A9: determinism and split-invariance', () => {
  it('gives the same state for the same seed and commands', () => {
    const a = run(scene('core:well', false), 40 * MIN, 1000);
    const b = run(scene('core:well', false), 40 * MIN, 1000);
    expect(serialize(a)).toBe(serialize(b));
    expect(a.counters['missions.done.core:well']).toBeGreaterThan(0);
  });

  for (const [id, minutes] of [
    ['core:well', 60],
    ['core:dig', 90],
  ] as const) {
    for (const shared of [false, true]) {
      it(`${id} (skill, technique, items, combat) with ${shared ? 'shares 500' : 'share 1000'}: chunks of 7, 999, 3600 ms equal one call`, () => {
        const whole = serialize(run(scene(id, shared), minutes * MIN, 0));
        for (const chunk of [7, 999, 3600]) {
          expect(serialize(run(scene(id, shared), minutes * MIN, chunk)), `chunk ${chunk}`).toBe(
            whole,
          );
        }
      });
    }
  }

  for (const shared of [false, true]) {
    it(`the thief, through the fight, in chunks of 1 ms, with ${shared ? 'shares 500' : 'share 1000'}`, () => {
      // At half speed the same mission takes twice the time.
      const horizon = (shared ? 8 : 4) * MIN;
      const whole = run(scene('core:thief', shared), horizon, 0);
      // The fight has begun by then, and the chunks cannot tell.
      expect(whole.slots[0]?.data).toMatchObject({ s: 1 });
      const text = serialize(whole);
      expect(serialize(run(scene('core:thief', shared), horizon, 1))).toBe(text);
    });
  }

  it('the fire (skill and technique stages) in chunks of 1 ms', () => {
    const whole = run(scene('core:fire', false), 5 * MIN, 0);
    expect(serialize(run(scene('core:fire', false), 5 * MIN, 1))).toBe(serialize(whole));
  });
});

describe('A11: saves', () => {
  /** Saves, loads, and runs the original and the copy on: they must stay the same. */
  function roundTrip(state: GameState, more: number): void {
    const copy = deserialize(serialize(state), content);
    expect(serialize(copy)).toBe(serialize(state));
    advance(state, more, content);
    advance(copy, more, content);
    expect(serialize(copy)).toBe(serialize(state));
  }

  it('round-trips in the middle of a skill stage', () => {
    const state = scene('core:dig', false);
    advance(state, 3 * MIN, content);
    expect(state.slots[0]?.data).toMatchObject({ s: 0 });
    roundTrip(state, 30 * MIN);
  });

  it('round-trips in the middle of a technique stage', () => {
    const state = scene('core:dig', false);
    const first = (state.slots[0]?.data as { p: { ms: number } }).p.ms;
    advance(state, first + 60_000, content);
    expect(state.slots[0]?.data).toMatchObject({ s: 1 });
    roundTrip(state, 30 * MIN);
  });

  it('round-trips in the middle of a combat stage, with the fight', () => {
    const state = scene('core:thief', false);
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 3000, content);
    expect(state.combat).not.toBeNull();
    expect(state.slots[0]?.data).toMatchObject({ s: 1, f: 1 });
    roundTrip(state, 10 * MIN);
    expect(state.counters['missions.done.core:thief']).toBeGreaterThanOrEqual(0);
  });

  it('round-trips with a won fight waiting for the end of its stage', () => {
    const state = scene('core:caravan', false);
    // The combat stage is long; the fight is won well before it ends.
    const first = (state.slots[0]?.data as { p: { ms: number } }).p.ms;
    advance(state, first + 100_000, content);
    expect(state.slots[0]?.data).toMatchObject({ s: 1, f: 2 });
    expect(state.combat).toBeNull();
    roundTrip(state, 20 * MIN);
  });

  it('round-trips while the stage waits for a fight that outlasts it', () => {
    const state = scene('core:thief', false);
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 3000, content);
    // Keep the enemy alive past the end of the stage's time.
    for (let i = 0; i < 400 && (state.slots[0]?.data as { w: number }).w === 0; i++) {
      for (const e of state.combat?.fight.enemies ?? []) e.hp = e.maxHp = 1e12;
      advance(state, 5000, content);
    }
    expect(state.slots[0]?.data).toMatchObject({ s: 1, w: 1, f: 1 });
    expect(state.combat).not.toBeNull();
    roundTrip(state, 3 * MIN);
  });

  it('migrates a version 11 save: nothing waits for a village yet', () => {
    expect(STATE_VERSION).toBe(12);
    const state = createState(3, content);
    const raw = JSON.parse(serialize(state)) as { v: number; state: Record<string, unknown> };
    raw.v = 11;
    raw.state.v = 11;
    delete raw.state.missions;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(12);
    expect(loaded.missions).toEqual({ pending: {} });
  });

  it('keeps the units waiting for a village, and cleans a doctored store', () => {
    const state = createState(4, content);
    state.missions.pending = { okhorona: 6 };
    const raw = JSON.parse(serialize(state)) as { state: { missions: { pending: unknown } } };
    expect(deserialize(JSON.stringify(raw), content).missions.pending).toEqual({ okhorona: 6 });
    raw.state.missions.pending = { okhorona: -2, 'Bad key': 3, kladka: 1.5, zroshennia: 4 };
    expect(deserialize(JSON.stringify(raw), content).missions.pending).toEqual({ zroshennia: 4 });
  });

  it('starts a mission whose saved run does not fit over from the first stage', () => {
    const state = scene('core:dig', false);
    advance(state, 20 * MIN, content);
    const raw = JSON.parse(serialize(state)) as { state: { slots: { data: unknown }[] } };
    for (const bad of [
      { s: 9 },
      { s: 1 },
      'x',
      null,
      { s: 0, a: -1, r: 0, f: 0, w: 0, st: '', el: 0, p: null },
    ]) {
      raw.state.slots[0] = { ...raw.state.slots[0], data: bad } as (typeof raw.state.slots)[number];
      const loaded = deserialize(JSON.stringify(raw), content);
      expect(loaded.slots[0]?.action?.kind).toBe('mission');
      expect(loaded.slots[0]?.data).toMatchObject({ s: 0, a: 0, f: 0 });
      advance(loaded, 40 * MIN, content);
      expect(loaded.counters['missions.done.core:dig']).toBeGreaterThan(0);
    }
  });

  it('drops a fight that does not belong to the stage and starts the stage anew', () => {
    const state = scene('core:thief', false);
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 3000, content);
    const raw = JSON.parse(serialize(state)) as { state: { combat: { enemy: string } } };
    raw.state.combat.enemy = 'core:merc_pack';
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.slots[0]?.data).toMatchObject({ s: 0 });
    expect(loaded.combat).toBeNull();
  });

  it('forgets the mission of a slot when the content no longer has it', () => {
    const state = scene('core:weed', false);
    const raw = JSON.parse(serialize(state)) as { state: { slots: { action: { id: string } }[] } };
    raw.state.slots[0]!.action.id = 'core:gone';
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.slots[0]?.action).toBeNull();
  });
});
