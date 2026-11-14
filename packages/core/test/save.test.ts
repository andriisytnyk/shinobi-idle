import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  advanceOffline,
  createState,
  deserialize,
  dispatch,
  MIGRATIONS,
  readSavedAt,
  serialize,
  STATE_VERSION,
  xpAt,
} from '../src/index.ts';
import { genin, HOUR, start } from './helpers.ts';

function played() {
  const state = genin(9);
  dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
  advance(state, 1_234_567, content);
  state.bank['core:mint'] = 2;
  state.currencies.ryo = 55;
  state.flags['gate'] = true;
  state.player.name = 'Test';
  state.player.natures = ['suiton', 'katon'];
  return state;
}

describe('A10: save', () => {
  it('round-trips a played state without events', () => {
    const state = played();
    expect(state.events.length).toBeGreaterThan(0);
    const text = serialize(state, 1700);
    const back = deserialize(text, content);
    expect(back).toEqual({ ...state, events: [] });
    expect(serialize(back, 1700)).toBe(text);
    expect(readSavedAt(text)).toBe(1700);
    expect(JSON.parse(text).state.events).toBeUndefined();
  });

  it('keeps the same bytes whatever order keys were created in', () => {
    const a = createState(1, content);
    const b = createState(1, content);
    a.known['core:zzz'] = true;
    a.known['core:aaa'] = true;
    b.known['core:aaa'] = true;
    b.known['core:zzz'] = true;
    expect(serialize(a)).toBe(serialize(b));
  });

  it('has one migration per version step', () => {
    expect(MIGRATIONS.length).toBe(STATE_VERSION - 1);
  });

  it('migrates a version 2 save: fractional slot numbers become whole units', () => {
    const old = JSON.parse(serialize(played(), 5));
    old.v = 2;
    old.state.v = 2;
    old.state.slots = [
      { action: { kind: 'practice', id: 'core:leaf_whirlwind' }, progress: 0.5, share: 0.5 },
    ];
    const state = deserialize(JSON.stringify(old), content);
    expect(state.v).toBe(STATE_VERSION);
    expect(state.slots[0]).toEqual({
      action: { kind: 'practice', id: 'core:leaf_whirlwind' },
      progress: 500,
      share: 1000,
      data: null,
    });
  });

  it('migrates a version 1 save to the current version', () => {
    const old = JSON.parse(serialize(played(), 5));
    old.v = 1;
    old.state.v = 1;
    delete old.state.stats;
    const state = deserialize(JSON.stringify(old), content);
    expect(state.v).toBe(STATE_VERSION);
    expect(state.stats).toEqual({ completed: 0 });
    expect(state.skills.tai.xp).toBe(played().skills.tai.xp);
    expect(state.slots[0]?.action).toEqual({ kind: 'practice', id: 'core:leaf_whirlwind' });
  });

  it('drops unknown ids and bad values instead of throwing', () => {
    const raw = JSON.parse(serialize(played()));
    const s = raw.state;
    s.skills.ghost = { xp: 5 };
    s.skills.tai.xp = 1e15;
    s.pools.ghost = { xp: 1 };
    s.pools.tai.xp = 1e15;
    s.mastery['core:ghost'] = { xp: 100 };
    s.mastery['core:clone'] = { xp: -5 };
    s.known['core:ghost'] = true;
    s.bank['core:ghost'] = 3;
    s.bank['core:mint'] = 2.5;
    s.flags['bad'] = 'text';
    s.player.rank = 'hokage';
    s.player.natures = ['katon', 'ghost', 'katon'];
    s.rng.combat = [1, 2];
    s.slots = [{ action: { kind: 'practice', id: 'core:ghost' }, progress: 5, share: -1 }, 7];
    const state = deserialize(JSON.stringify(raw), content);
    expect(Object.keys(state.skills)).toHaveLength(16);
    expect(state.skills.tai.xp).toBe(xpAt(content.balance.K.cap));
    expect(state.pools.tai.xp).toBeLessThan(1e15);
    expect(Object.keys(state.pools)).toHaveLength(16);
    expect(state.mastery['core:clone']).toEqual({ xp: 0 });
    expect(state.mastery['core:ghost']).toBeUndefined();
    expect(state.known['core:ghost']).toBeUndefined();
    expect(state.bank).toEqual({});
    expect(state.flags).toEqual({ gate: true });
    expect(state.player.rank).toBe('student');
    expect(state.player.natures).toEqual(['katon']);
    expect(state.rng.combat).toEqual(createState(0, content).rng.combat);
    expect(state.slots).toEqual([
      { action: null, progress: 0, share: 1000, data: null },
      { action: null, progress: 0, share: 0, data: null },
    ]);
  });

  it('rejects text that is not a save', () => {
    expect(() => deserialize('nope', content)).toThrow();
    expect(() => deserialize('[]', content)).toThrow(/not a game save/);
    expect(() => deserialize('{"v":"x","state":{}}', content)).toThrow(/version/);
    expect(() => deserialize(`{"v":${STATE_VERSION + 1},"state":{}}`, content)).toThrow(/newer/);
  });

  it('fills a minimal state with defaults', () => {
    const state = deserialize(`{"v":${STATE_VERSION},"state":{}}`, content);
    expect(state).toEqual(createState(0, content));
  });
});

describe('advanceOffline', () => {
  it('clamps to the cap from content and summarises what happened', () => {
    const state = genin();
    dispatch(state, start('practice', 'core:leaf_whirlwind'), content);
    const queued = state.events.length;
    const summary = advanceOffline(state, 100 * HOUR, content);
    expect(content.balance.K.offlineCapHours).toBe(12);
    expect(summary.requestedMs).toBe(100 * HOUR);
    expect(summary.simulatedMs).toBe(12 * HOUR);
    expect(summary.capped).toBe(true);
    expect(state.now).toBe(12 * HOUR);
    expect(summary.skillXp.tai).toBe(state.skills.tai.xp);
    expect(summary.levelsGained.tai).toBeGreaterThan(10);
    expect(summary.masteryLevelsGained['core:leaf_whirlwind']).toBeGreaterThan(20);
    expect(Object.keys(summary.skillXp)).toEqual(['tai']);
    expect(summary.techniquesLearned).toContain('core:dynamic_entry');
    expect(summary.actionsStopped).toEqual([]);
    expect(state.events.length).toBe(queued);
  });

  it('simulates short absences in full and ignores negative time', () => {
    const state = genin();
    expect(advanceOffline(state, 5000.9, content)).toMatchObject({
      simulatedMs: 5000,
      capped: false,
      skillXp: {},
    });
    expect(advanceOffline(state, -10, content).simulatedMs).toBe(0);
  });
});
