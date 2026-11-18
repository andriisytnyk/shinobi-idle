import { content } from '@shinobi/content';
import {
  advance,
  advanceOffline,
  createState,
  dispatch,
  moneyOf,
  type GameState,
} from '@shinobi/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Clock, KeyValue } from './persistence.ts';
import {
  createTelemetry,
  OFFLINE_MIN_MS,
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

describe('catch-ups and failures', () => {
  it('counts only a real absence as an offline catch-up, and not twice as open time', () => {
    const c = clock();
    const state = createState(1, content);
    state.player.rank = 'genin';
    const tel = createTelemetry({ clock: c, kv: null, content, enabled: () => true });
    tel.start(state);
    play(tel, state, 10);
    const open = tel.record.sessions.realMs;
    for (const gap of [600, OFFLINE_MIN_MS + 1000]) {
      c.set(c.now() + gap);
      tel.beforeCatchUp(state);
      const summary = advanceOffline(state, gap, content);
      tel.afterCatchUp(state, summary);
    }
    expect(tel.record.offline.count).toBe(1);
    // Neither gap is added to the session's real time; the next beat counts from after them.
    advance(state, 1000, content);
    tel.observe(state);
    expect(tel.record.sessions.realMs).toBe(open);
  });

  it('stamps nothing after being cleared or switched back on late in a game', async () => {
    const c = clock();
    const state = createState(1, content);
    state.player.rank = 'genin';
    state.known['core:shadow_clone'] = true;
    let on = true;
    const tel = createTelemetry({ clock: c, kv: null, content, enabled: () => on });
    tel.start(state);
    await tel.clear(state);
    for (const switchOff of [false, true]) {
      if (switchOff) {
        on = false;
        tel.observe(state);
        on = true;
      }
      tel.beforeCatchUp(state);
      tel.afterCatchUp(state, advanceOffline(state, 120_000, content));
      expect(tel.record.milestones.map((m) => m.key)).toEqual([]);
    }
  });

  it('re-baselines on a swap of the state', () => {
    const state = createState(1, content);
    const tel = createTelemetry({ clock: clock(), kv: null, content, enabled: () => true });
    tel.start(state);
    play(tel, state, 3);
    const rich = createState(2, content);
    rich.currencies[moneyOf(content)] = 900;
    tel.rebase(rich);
    advance(rich, 1000, content);
    tel.observe(rich);
    expect(tel.record.ryo.earned.other ?? 0).toBe(0);
    expect(tel.record.ryo.spent).toBe(0);
  });

  it('never throws into the game loop: a telemetry error switches recording off', () => {
    const c = clock();
    const state = createState(1, content);
    const tel = createTelemetry({ clock: c, kv: null, content, enabled: () => true });
    tel.start(state);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    c.now = () => {
      throw new Error('clock broke');
    };
    advance(state, 1000, content);
    expect(() => tel.observe(state)).not.toThrow();
    expect(() => tel.fold([{ type: 'rankUp', rank: 'genin', at: 1 }])).not.toThrow();
    expect(() => tel.observe(state)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(tel.record.milestones).toEqual([]);
    warn.mockRestore();
  });

  it('starts from a new record when the stored one is damaged', async () => {
    const kv = memoryStore();
    kv.data.set(TELEMETRY_KEY, '{"v":1,"ryo":null}');
    const tel = createTelemetry({ clock: clock(), kv, content, enabled: () => true });
    await tel.load();
    expect(tel.record.ryo.earned).toEqual({});
    expect(() => tel.observe(createState(1, content))).not.toThrow();
  });
});

describe('no network', () => {
  it('has no network API in the telemetry sources', () => {
    const sources = [
      'src/lib/telemetry.ts',
      'src/lib/download.ts',
      'src/lib/game.svelte.ts',
      'src/lib/settings.svelte.ts',
      'src/components/TelemetrySection.svelte',
      '../../packages/core/src/telemetry.ts',
      '../../packages/sim/src/telemetryReport.ts',
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
