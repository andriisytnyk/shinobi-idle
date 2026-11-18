// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { createState, moneyOf } from '@shinobi/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/lib/game.svelte.ts';
import { SAVE_KEY, type Clock, type KeyValue } from '../src/lib/persistence.ts';
import { TELEMETRY_KEY } from '../src/lib/telemetry.ts';

/*
 * Local telemetry as the game store uses it: state swaps re-baseline it, import and reset clear it,
 * a damaged stored record is replaced, and a reload is not an offline catch-up.
 */

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

const T0 = 1_800_000_000_000;
const clock = (): Clock & { set(ms: number): void } => {
  let now = T0;
  return { now: () => now, set: (ms) => (now = ms) };
};

const MONEY = moneyOf(content);
const games: ReturnType<typeof createGame>[] = [];

async function open(kv: KeyValue, c: Clock) {
  const g = createGame({ clock: c, kv, telemetryEnabled: () => true });
  games.push(g);
  await g.start();
  return g;
}

/** A genin fights the dummy; the first step runs on the snapshot from before the command. */
function fight(g: ReturnType<typeof createGame>, ms: number): void {
  g.state.player.rank = 'genin';
  g.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' });
  g.devAdvance(1000);
  g.devAdvance(ms);
}

afterEach(() => {
  for (const g of games.splice(0)) g.stop();
});

describe('telemetry in the game store', () => {
  it('re-baselines on a restore, so the swap is not counted as earned or spent money', async () => {
    const kv = memoryStore();
    const g = await open(kv, clock());
    const rich = createState(2, content);
    rich.currencies[MONEY] = 500;
    g.replaceState(rich);
    g.devAdvance(1000);
    expect(g.telemetry.file().record.ryo.earned.other ?? 0).toBe(0);
    expect(g.telemetry.file().record.ryo.spent).toBe(0);
    // A real restore from the backup: reset keeps the rich game as the backup, restore brings it back.
    await g.save();
    await g.reset();
    g.devAdvance(1000);
    expect(await g.restoreBackup()).toBe(true);
    g.devAdvance(1000);
    const rec = g.telemetry.file().record;
    expect(rec.ryo.earned.other ?? 0).toBe(0);
    expect(rec.ryo.spent).toBe(0);
  });

  it('clears the record on import and on reset', async () => {
    const kv = memoryStore();
    const g = await open(kv, clock());
    fight(g, 30_000);
    expect(Object.keys(g.telemetry.file().record.timeByKind)).not.toHaveLength(0);
    const text = g.exportText();
    await g.importText(text);
    let rec = g.telemetry.file().record;
    expect(rec.timeByKind).toEqual({});
    expect(rec.milestones).toEqual([]);
    expect(rec.sessions.count).toBe(1);
    fight(g, 30_000);
    expect(Object.keys(g.telemetry.file().record.timeByKind)).not.toHaveLength(0);
    await g.reset();
    rec = g.telemetry.file().record;
    expect(rec.timeByKind).toEqual({});
    expect(rec.sessions.count).toBe(1);
  });

  it('replaces a damaged stored record and keeps the loop going', async () => {
    for (const damaged of ['{"v":1,"ryo":null}', '{"v":1,"sessions":null}', '[1,2]', '{"v":1}']) {
      const kv = memoryStore();
      kv.data.set(TELEMETRY_KEY, damaged);
      const g = await open(kv, clock());
      expect(g.phase).toBe('playing');
      fight(g, 5_000);
      g.tick();
      expect(g.phase).toBe('playing');
      expect(g.telemetry.file().record.timeByKind.fight).toBeGreaterThan(0);
      g.stop();
    }
  });

  it('does not stamp what the game already had when it is reloaded', async () => {
    const kv = memoryStore();
    const c = clock();
    const first = await open(kv, c);
    fight(first, 30_000);
    await first.save();
    const before = first.telemetry.file().record;
    const marks = structuredClone(before.milestones);
    first.stop();
    expect(kv.data.has(SAVE_KEY)).toBe(true);

    // A plain reload is no offline catch-up and stamps nothing.
    c.set(c.now() + 800);
    const reloaded = await open(kv, c);
    let rec = reloaded.telemetry.file().record;
    expect(rec.offline.count).toBe(0);
    expect(rec.milestones).toEqual(marks);
    expect(rec.lastMilestone).toBe(before.lastMilestone);
    await reloaded.save();
    reloaded.stop();

    // A long absence is one catch-up; what the game had stays as it was recorded.
    c.set(c.now() + 2 * 3_600_000);
    const away = await open(kv, c);
    rec = away.telemetry.file().record;
    expect(rec.offline.count).toBe(1);
    expect(rec.milestones.slice(0, marks.length)).toEqual(marks);
    expect(rec.milestones.map((m) => m.key)).not.toContain('rank:student');
    away.stop();
  });
});
