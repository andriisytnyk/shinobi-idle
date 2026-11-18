import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addMilestone,
  advance,
  advanceOffline,
  createState,
  dispatch,
  foldEvents,
  moneyOf,
  newTelemetry,
  noteOffline,
  observeState,
  parseTelemetry,
  serializeTelemetry,
  sessionBeat,
  sessionStart,
  snapshotForTelemetry,
  TELEMETRY_MILESTONES_CAP,
  TELEMETRY_SESSIONS_CAP,
  type GameEvent,
  type GameState,
} from '../src/index.ts';
import { setLevel } from './helpers.ts';

const DUMMY = 'core:dummy';
const MONEY = moneyOf(content);

/** A scripted game: the player fights the dummy for ten game minutes, one second at a time, folding as the web layer does. */
function play(): { state: GameState; rec: ReturnType<typeof newTelemetry> } {
  const state = createState(7, content);
  setLevel(state, 'vit', 40);
  const rec = newTelemetry(1_000);
  sessionStart(rec, 1_000, state.now);
  dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: DUMMY }, content);
  for (let i = 1; i <= 600; i++) {
    const before = snapshotForTelemetry(state, content);
    advance(state, 1000, content);
    const events = state.events;
    state.events = [];
    foldEvents(rec, events, 1_000 + i * 1000);
    observeState(rec, before, state, content, 1_000 + i * 1000);
    sessionBeat(rec, 1_000 + i * 1000, state.now);
  }
  return { state, rec };
}

describe('telemetry reducer', () => {
  it('folds a scripted game into the expected record, deterministically', () => {
    const a = play();
    const b = play();
    expect(serializeTelemetry(a.rec)).toBe(serializeTelemetry(b.rec));
    const { rec, state } = a;
    expect(rec.game).toBe(600_000);
    expect(rec.timeByKind.fight).toBe(600_000);
    expect(rec.fights[DUMMY]?.won).toBe(state.counters[`kills.${DUMMY}`]);
    expect(rec.fights[DUMMY]?.won).toBeGreaterThan(5);
    expect(rec.fights[DUMMY]?.lost ?? 0).toBe(0);
    expect(Object.keys(rec.timeBySkill).length).toBeGreaterThan(0);
    expect(rec.sessions.count).toBe(1);
    expect(rec.sessions.realMs).toBe(600_000);
    expect(rec.dry.ms).toBeLessThanOrEqual(600_000);
    // Money the dummy paid is explained by the loot events, not left to "other".
    expect(rec.ryo.earned.other ?? 0).toBe(0);
  });

  it('records each milestone once, with game and real time', () => {
    const rec = newTelemetry(0);
    const events: GameEvent[] = [
      { type: 'levelUp', skill: 'core:tai', level: 10, at: 5_000 },
      { type: 'levelUp', skill: 'core:tai', level: 11, at: 6_000 },
      { type: 'levelUp', skill: 'core:tai', level: 10, at: 7_000 },
      { type: 'rankUp', rank: 'genin', at: 9_000 },
      { type: 'techniqueLearned', id: 'core:shadow_clone', at: 10_000 },
    ];
    foldEvents(rec, events, 42);
    expect(rec.milestones).toEqual([
      { key: 'skill:core:tai:10', game: 5_000, real: 42 },
      { key: 'rank:genin', game: 9_000, real: 42 },
      { key: 'technique:core:shadow_clone', game: 10_000, real: 42 },
    ]);
    expect(rec.dry).toEqual({ ms: 5_000, from: 0 });
  });

  it('sums money by source and finds what no event explains', () => {
    const state = createState(1, content);
    const rec = newTelemetry(0);
    const before = snapshotForTelemetry(state, content);
    state.currencies[MONEY] = (state.currencies[MONEY] ?? 0) + 100;
    foldEvents(
      rec,
      [
        {
          type: 'missionDone',
          mission: 'core:m',
          ryo: 60,
          rep: 0,
          currencies: [],
          items: [],
          resource: null,
          at: 0,
        },
      ],
      0,
    );
    observeState(rec, before, state, content, 0);
    expect(rec.ryo.earned).toEqual({ mission: 60, other: 40 });
    const again = snapshotForTelemetry(state, content);
    state.currencies[MONEY] = (state.currencies[MONEY] ?? 0) - 30;
    observeState(rec, again, state, content, 0);
    expect(rec.ryo.spent).toBe(30);
    expect(rec.missions['core:m']).toBe(1);
  });

  it('reads a catch-up through the state, as its events are not queued', () => {
    const state = createState(3, content);
    setLevel(state, 'vit', 40);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: DUMMY }, content);
    const rec = newTelemetry(0);
    const before = snapshotForTelemetry(state, content, true);
    const summary = advanceOffline(state, 3_600_000, content);
    noteOffline(rec, 5, summary.requestedMs, summary.simulatedMs);
    observeState(rec, before, state, content, 5, true);
    expect(rec.offline).toMatchObject({ count: 1, requestedMs: 3_600_000 });
    expect(rec.fights[DUMMY]?.won).toBe(state.counters[`kills.${DUMMY}`]);
    expect(rec.timeByKind.fight).toBe(summary.simulatedMs);
  });
});

describe('telemetry record', () => {
  it('round-trips through its text and rejects other versions', () => {
    const { rec } = play();
    expect(parseTelemetry(serializeTelemetry(rec))).toEqual(rec);
    expect(parseTelemetry('{"v":99}')).toBeNull();
    expect(parseTelemetry('nonsense')).toBeNull();
  });

  it('keeps lists within their caps', () => {
    const rec = newTelemetry(0);
    for (let i = 0; i < TELEMETRY_SESSIONS_CAP + 20; i++) sessionStart(rec, i, i);
    expect(rec.sessions.count).toBe(TELEMETRY_SESSIONS_CAP + 20);
    expect(rec.sessions.last).toHaveLength(TELEMETRY_SESSIONS_CAP);
    for (let i = 0; i < TELEMETRY_MILESTONES_CAP + 20; i++) addMilestone(rec, `k${i}`, i, i);
    expect(rec.milestones).toHaveLength(TELEMETRY_MILESTONES_CAP);
    expect(serializeTelemetry(rec).length).toBeLessThan(60_000);
  });
});
