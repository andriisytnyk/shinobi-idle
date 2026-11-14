import { describe, expect, it } from 'vitest';
import { createStreams, nextFloat, nextInt, nextUint32, type RngState } from '../src/index.ts';

const draw = (seed: number, stream: string, n: number) => {
  const streams = createStreams(seed);
  return Array.from({ length: n }, () => nextFloat(streams, stream));
};

describe('rng', () => {
  it('is deterministic for the same seed and stream', () => {
    expect(draw(42, 'combat', 50)).toEqual(draw(42, 'combat', 50));
  });

  it('differs between seeds and between streams', () => {
    expect(draw(1, 'combat', 10)).not.toEqual(draw(2, 'combat', 10));
    expect(draw(1, 'combat', 10)).not.toEqual(draw(1, 'loot', 10));
  });

  it('keeps streams independent: drawing from one does not move another', () => {
    const a = createStreams(7);
    const b = createStreams(7);
    for (let i = 0; i < 100; i++) nextFloat(a, 'loot');
    expect(a['combat']).toEqual(b['combat']);
    expect(nextFloat(a, 'combat')).toBe(nextFloat(b, 'combat'));
  });

  it('keeps stream state as a plain array that survives JSON', () => {
    const streams = createStreams(9);
    nextFloat(streams, 'action');
    const copy = JSON.parse(JSON.stringify(streams)) as typeof streams;
    expect(copy).toEqual(streams);
    expect(nextFloat(copy, 'action')).toBe(nextFloat(streams, 'action'));
  });

  it('returns floats in [0, 1) and ints in range', () => {
    const streams = createStreams(3);
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(streams, 'world');
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = nextInt(streams, 'world', 6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });

  it('matches the reference sfc32 sequence', () => {
    const state: RngState = [1, 2, 3, 4];
    // Computed with the canonical sfc32 implementation (Bryc) for seed words 1, 2, 3, 4.
    expect([nextUint32(state), nextUint32(state), nextUint32(state)]).toEqual([
      reference([1, 2, 3, 4], 1),
      reference([1, 2, 3, 4], 2),
      reference([1, 2, 3, 4], 3),
    ]);
  });

  it('throws for an unknown stream', () => {
    expect(() => nextFloat(createStreams(1), 'nope')).toThrow();
  });
});

/** Canonical sfc32 written with signed 32-bit arithmetic, returning the nth output. */
function reference(seed: [number, number, number, number], n: number): number {
  let [a, b, c, d] = seed;
  let out = 0;
  for (let i = 0; i < n; i++) {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    out = t >>> 0;
  }
  return out;
}
