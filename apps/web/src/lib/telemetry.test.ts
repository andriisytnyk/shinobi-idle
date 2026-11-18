import { content } from '@shinobi/content';
import { advance, createState, dispatch, type GameState } from '@shinobi/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Clock, KeyValue } from './persistence.ts';
import {
  createTelemetry,
  TELEMETRY_FORMAT,
  TELEMETRY_KEY,
  telemetryFileName,
} from './telemetry.ts';

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

const clock = (): Clock & { set(ms: number): void } => {
  let now = 1_800_000_000_000;
  return { now: () => now, set: (ms) => (now = ms) };
};

/** Plays the dummy fight for `seconds` of game time, one second at a time, as the game loop does. */
function play(tel: ReturnType<typeof createTelemetry>, state: GameState, seconds: number): void {
  dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' }, content);
  for (let i = 0; i < seconds; i++) {
    advance(state, 1000, content);
    const events = state.events;
    state.events = [];
    tel.fold(events);
    tel.observe(state);
  }
}

describe('local telemetry of the web layer', () => {
  it('survives a reload: what is saved is read back', async () => {
    const kv = memoryStore();
    const c = clock();
    const state = createState(1, content);
    state.player.rank = 'genin';
    const tel = createTelemetry({ clock: c, kv, content, enabled: () => true });
    await tel.load();
    tel.start(state);
    play(tel, state, 120);
    await tel.save();
    expect(kv.data.has(TELEMETRY_KEY)).toBe(true);

    const again = createTelemetry({ clock: c, kv, content, enabled: () => true });
    await again.load();
    expect(again.record).toEqual(tel.record);
    // The first second runs on the snapshot from before the command that started the fight.
    expect(again.record.timeByKind.fight).toBe(119_000);
    // A second session adds to the record instead of replacing it.
    again.start(state);
    expect(again.record.sessions.count).toBe(2);
  });

  it('is cleared with a new game', async () => {
    const kv = memoryStore();
    const state = createState(1, content);
    const tel = createTelemetry({ clock: clock(), kv, content, enabled: () => true });
    tel.start(state);
    play(tel, state, 30);
    await tel.save();
    await tel.clear(createState(2, content));
    expect(tel.record.timeByKind).toEqual({});
    expect(tel.record.sessions.count).toBe(1);
    expect(tel.record.milestones).toEqual([]);
  });

  it('records nothing while it is off', async () => {
    const kv = memoryStore();
    const state = createState(1, content);
    let on = false;
    const tel = createTelemetry({ clock: clock(), kv, content, enabled: () => on });
    tel.start(state);
    play(tel, state, 30);
    expect(tel.record.sessions.count).toBe(0);
    expect(tel.record.timeByKind).toEqual({});
    await tel.save();
    expect(kv.data.has(TELEMETRY_KEY)).toBe(false);
    on = true;
    const before = state.now;
    advance(state, 1000, content);
    tel.observe(state);
    expect(tel.record.timeByKind.fight).toBe(state.now - before);
  });

  it('makes an export file that says what it is, named with the date', () => {
    const state = createState(1, content);
    const tel = createTelemetry({ clock: clock(), kv: null, content, enabled: () => true });
    const file = tel.file(state);
    expect(file.format).toBe(TELEMETRY_FORMAT);
    expect(file.game.packs.length).toBeGreaterThan(0);
    expect(telemetryFileName(Date.UTC(2026, 10, 18, 12))).toBe('shinobi-telemetry-2026-11-18.json');
  });

  it('stays small after a while of play', () => {
    const state = createState(3, content);
    state.player.rank = 'genin';
    const tel = createTelemetry({ clock: clock(), kv: null, content, enabled: () => true });
    tel.start(state);
    play(tel, state, 600);
    expect(JSON.stringify(tel.file(state)).length).toBeLessThan(20_000);
  });
});

describe('no network', () => {
  it('has no network API in the telemetry sources', () => {
    const sources = [
      'src/lib/telemetry.ts',
      'src/lib/download.ts',
      '../../packages/core/src/telemetry.ts',
    ];
    const network = /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts)\b/;
    for (const path of sources) {
      const code = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        '',
      );
      expect(code, path).not.toMatch(network);
    }
  });
});
