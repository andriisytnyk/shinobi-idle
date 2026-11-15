import { content } from '@shinobi/content';
import { advance, createState, dispatch, serialize, type GameState } from '@shinobi/core';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEY,
  LoadError,
  backupSave,
  decodeStored,
  encodeStored,
  readBackup,
  SAVE_KEY,
  buildReport,
  exportSave,
  importSave,
  loadGame,
  saveGame,
  type Clock,
  type KeyValue,
} from './persistence.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

function memoryStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
    del: async (key) => void data.delete(key),
    update: async (key, fn) => {
      const next = fn(data.get(key));
      if (next !== undefined) data.set(key, next);
    },
  };
}

function fakeClock(start: number): Clock & { set(ms: number): void } {
  let now = start;
  return { now: () => now, set: (ms) => (now = ms) };
}

/** A genin practising the first Taijutsu technique for a little while. */
function practising(): GameState {
  const state = createState(7, content);
  state.player.rank = 'genin';
  const first = content.techniques.find((t) => t.skill === 'tai' && state.known[t.id]);
  if (!first) throw new Error('no known tai technique');
  expect(
    dispatch(state, { type: 'action.start', slot: 0, kind: 'practice', id: first.id }, content).ok,
  ).toBe(true);
  advance(state, 10 * MIN, content);
  return state;
}

const T0 = 1_800_000_000_000;

describe('loading a save', () => {
  it('starts a new game when there is no save', async () => {
    const result = await loadGame(memoryStore(), fakeClock(T0), content);
    expect(result.summary).toBeNull();
    expect(result.report).toBeNull();
    expect(result.state.now).toBe(0);
  });

  it('A3: applies 2 hours of progress to a save that is 2 hours old and reports it', async () => {
    const kv = memoryStore();
    const clock = fakeClock(T0);
    const saved = practising();
    await saveGame(kv, clock, saved, 0);

    const xpBefore = saved.skills.tai!.xp;
    clock.set(T0 + 2 * HOUR);
    const result = await loadGame(kv, clock, content);
    expect(result.summary?.simulatedMs).toBe(2 * HOUR);
    expect(result.summary?.capped).toBe(false);
    expect(result.state.now).toBe(saved.now + 2 * HOUR);
    expect(result.state.skills.tai!.xp).toBeGreaterThan(saved.skills.tai!.xp);

    // The same two hours run directly give the identical state: loading adds nothing of its own.
    advance(saved, 2 * HOUR, content);
    expect(serialize(result.state)).toBe(serialize(saved));

    const report = result.report;
    expect(report).not.toBeNull();
    expect(report?.simulatedMs).toBe(2 * HOUR);
    const tai = report?.skills.find((s) => s.skill === 'tai');
    expect(tai?.xp).toBeCloseTo(result.state.skills.tai!.xp - xpBefore, 6);
    expect(report?.mastery.length).toBeGreaterThan(0);
  });

  it('A3: clamps an absence of more than 12 hours to 12 hours', async () => {
    const kv = memoryStore();
    const clock = fakeClock(T0);
    const saved = practising();
    await saveGame(kv, clock, saved, 0);
    clock.set(T0 + 30 * HOUR);
    const result = await loadGame(kv, clock, content);
    expect(result.summary?.requestedMs).toBe(30 * HOUR);
    expect(result.summary?.simulatedMs).toBe(12 * HOUR);
    expect(result.summary?.capped).toBe(true);
    expect(result.state.now).toBe(saved.now + 12 * HOUR);
    expect(result.report?.capped).toBe(true);
    expect(result.report?.simulatedMs).toBe(12 * HOUR);
  });

  it('does not run the clock backwards when the wall clock is behind the save', async () => {
    const kv = memoryStore();
    const clock = fakeClock(T0);
    const saved = practising();
    await saveGame(kv, clock, saved, 0);
    clock.set(T0 - HOUR);
    const result = await loadGame(kv, clock, content);
    expect(result.summary?.simulatedMs).toBe(0);
    expect(result.state.now).toBe(saved.now);
  });

  it('gives no report for a short absence', async () => {
    const kv = memoryStore();
    const clock = fakeClock(T0);
    await saveGame(kv, clock, practising(), 0);
    clock.set(T0 + 20_000);
    const result = await loadGame(kv, clock, content);
    expect(result.summary?.simulatedMs).toBe(20_000);
    expect(result.report).toBeNull();
  });

  it('throws a LoadError and leaves a corrupted save untouched', async () => {
    const kv = memoryStore();
    kv.data.set(SAVE_KEY, 'not json');
    const error = await loadGame(kv, fakeClock(T0), content).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as LoadError).raw).toBe('not json');
    expect(kv.data.get(SAVE_KEY)).toBe('not json');
  });

  it('throws a LoadError for a well-formed envelope with an empty state', async () => {
    const kv = memoryStore();
    kv.data.set(SAVE_KEY, encodeStored(3, JSON.stringify({ v: 4, savedAt: 1, state: {} })));
    await expect(loadGame(kv, fakeClock(T0), content)).rejects.toBeInstanceOf(LoadError);
  });

  it('throws a LoadError when reading the store fails, without a raw text', async () => {
    const kv = memoryStore();
    kv.get = async () => {
      throw new Error('IndexedDB is blocked');
    };
    const error = await loadGame(kv, fakeClock(T0), content).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoadError);
    expect((error as LoadError).raw).toBeNull();
    expect((error as LoadError).message).toContain('blocked');
  });

  it('reads a bare save text from before revisions as revision 0', async () => {
    const kv = memoryStore();
    kv.data.set(SAVE_KEY, serialize(practising(), T0));
    const result = await loadGame(kv, fakeClock(T0), content);
    expect(result.rev).toBe(0);
  });

  it('keeps an older-format save as the backup when it is upgraded on load', async () => {
    const kv = memoryStore();
    const old = JSON.stringify({ ...JSON.parse(serialize(practising(), T0)), v: 3 });
    kv.data.set(SAVE_KEY, old);
    await loadGame(kv, fakeClock(T0), content);
    expect(kv.data.get(BACKUP_KEY)).toBe(old);
  });
});

describe('revision guard', () => {
  it('writes ascending revisions', async () => {
    const kv = memoryStore();
    const clock = fakeClock(T0);
    const state = practising();
    const first = await saveGame(kv, clock, state, 0);
    expect(first).toEqual({ ok: true, rev: 1 });
    const second = await saveGame(kv, clock, state, 1);
    expect(second).toEqual({ ok: true, rev: 2 });
    expect(decodeStored(kv.data.get(SAVE_KEY) ?? '').rev).toBe(2);
  });

  it('refuses to write over a newer stored revision and leaves it alone', async () => {
    const kv = memoryStore();
    const clock = fakeClock(T0);
    const newer = practising();
    advance(newer, HOUR, content);
    // Another tab saved revisions 1..5.
    kv.data.set(SAVE_KEY, encodeStored(5, serialize(newer, T0)));
    const before = kv.data.get(SAVE_KEY);
    const stale = practising();
    const result = await saveGame(kv, clock, stale, 2);
    expect(result).toEqual({ ok: false, reason: 'stale' });
    expect(kv.data.get(SAVE_KEY)).toBe(before);
  });

  it('force writes above the stored revision (import, reset, restore)', async () => {
    const kv = memoryStore();
    kv.data.set(SAVE_KEY, encodeStored(5, serialize(practising(), T0)));
    const result = await saveGame(kv, fakeClock(T0), practising(), 2, true);
    expect(result).toEqual({ ok: true, rev: 6 });
  });
});

describe('backup', () => {
  it('copies the stored save and reads it back as a state', async () => {
    const kv = memoryStore();
    const state = practising();
    await saveGame(kv, fakeClock(T0), state, 0);
    await backupSave(kv);
    const restored = await readBackup(kv, content);
    expect(restored && serialize(restored, T0)).toBe(serialize(state, T0));
  });

  it('is absent when there is nothing to back up', async () => {
    const kv = memoryStore();
    await backupSave(kv);
    expect(await readBackup(kv, content)).toBeNull();
  });
});

describe('report', () => {
  it('is empty when nothing changed', () => {
    expect(
      buildReport({
        requestedMs: HOUR,
        simulatedMs: HOUR,
        capped: false,
        skillXp: {},
        levelsGained: {},
        masteryLevelsGained: {},
        techniquesLearned: [],
        actionsStopped: [],
        reports: {},
      }),
    ).toBeNull();
  });
});

describe('export and import', () => {
  it('A4: export, reset, import restores a byte-identical serialized state', async () => {
    const clock = fakeClock(T0);
    const state = practising();
    state.player.name = 'Наруто Узумакі';
    const before = serialize(state, T0);

    const text = exportSave(state, clock);
    expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/);

    // Reset: a fresh game replaces the state.
    const reset = createState(99, content);
    expect(serialize(reset, T0)).not.toBe(before);

    const restored = importSave(text, content);
    expect(serialize(restored, T0)).toBe(before);
  });

  it('rejects an envelope with an empty or alien state', () => {
    const empty = btoa(JSON.stringify({ v: 4, savedAt: 1, state: {} }));
    expect(() => importSave(empty, content)).toThrow();
    const partial = JSON.parse(serialize(practising(), T0));
    delete partial.state.skills.tai;
    expect(() => importSave(btoa(JSON.stringify(partial)), content)).toThrow();
  });

  it('rejects text that is not a save', () => {
    expect(() => importSave('bm90IGEgc2F2ZQ==', content)).toThrow();
    expect(() => importSave('%%%', content)).toThrow();
  });
});
