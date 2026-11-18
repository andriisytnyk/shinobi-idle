/**
 * Save version 18: the pool capacity per item went from 1500 to 2000 (action pace, #69), so the migration scales
 * every pool by 2000 / 1500 and each pool keeps its fraction of the capacity and the checkpoints it had reached.
 * `fixtures/save-v17-pools.json` holds real version 17 saves recorded by dev code (`origin/dev` at 80bc659, before
 * the change): a throwaway worktree of that commit practised Leaf Whirlwind (`genin`, `action.start`, `advance`,
 * `serialize`) and saved the Taijutsu pool at 12%, 26.8% (past the 25% checkpoint) and 52% of its capacity, with
 * what the dev state said at the moment of saving next to each save (`dev`).
 */
import { readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  checkpointReached,
  deserialize,
  poolCapacity,
  serialize,
  STATE_VERSION,
} from '../src/index.ts';

interface Dev {
  v: number;
  now: number;
  cap: number;
  pools: Record<string, number>;
  action: { kind: string; id: string } | null;
}

const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/save-v17-pools.json', import.meta.url), 'utf8'),
) as Record<string, { save: string; dev: Dev }>;

const checkpoints = (skill: string) => content.pools.filter((p) => p.skill === skill);

describe('migration v17 -> v18 of real saves recorded on dev', () => {
  for (const [name, expectedPct] of [
    ['low', 12],
    ['mid', 26.8],
    ['high', 52],
  ] as const) {
    it(`${name}: the pool keeps its fraction and its checkpoints`, () => {
      const rec = recorded[name]!;
      expect((JSON.parse(rec.save) as { v: number }).v).toBe(17);
      expect(STATE_VERSION).toBeGreaterThanOrEqual(18);
      const state = deserialize(rec.save, content);
      expect(state.v).toBe(STATE_VERSION);
      const capacity = poolCapacity('tai', content);
      expect(capacity).toBe(rec.dev.cap * (2000 / 1500));
      const before = rec.dev.pools.tai! / rec.dev.cap;
      const after = state.pools.tai!.xp / capacity;
      expect(after).toBeCloseTo(before, 12);
      expect(before * 100).toBeCloseTo(expectedPct, 0);
      // A checkpoint reached on dev is reached after loading, and one not reached is not.
      for (const p of checkpoints('tai')) {
        expect(checkpointReached(state, p, content)).toBe(before * 100 >= p.pct);
      }
      expect(state.now).toBe(rec.dev.now);
      expect(state.slots[0]?.action).toEqual(rec.dev.action);
    });
  }

  it('mid: the 25% checkpoint of dev stays on (the case the unscaled number lost)', () => {
    const rec = recorded.mid!;
    const state = deserialize(rec.save, content);
    const quarter = checkpoints('tai').find((p) => p.pct === 25)!;
    expect(checkpointReached(state, quarter, content)).toBe(true);
    // The saved number against the new capacity alone would have read as under 25% and dropped it.
    expect(rec.dev.pools.tai! / poolCapacity('tai', content)).toBeLessThan(0.25);
  });

  it('plays on the same however the time is cut, and every pool is scaled', () => {
    const total = 20 * 60_000;
    const whole = deserialize(recorded.mid!.save, content);
    advance(whole, total, content);
    const parts = deserialize(recorded.mid!.save, content);
    for (let done = 0; done < total; done += 4321)
      advance(parts, Math.min(4321, total - done), content);
    expect(serialize(parts)).toBe(serialize(whole));
    const loaded = deserialize(recorded.mid!.save, content);
    for (const [id, xp] of Object.entries(recorded.mid!.dev.pools)) {
      expect(loaded.pools[id]!.xp).toBeCloseTo((xp * 2000) / 1500, 9);
    }
  });
});
