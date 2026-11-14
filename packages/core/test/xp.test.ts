import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { levelAt, levelCap, xpAt } from '../src/index.ts';

describe('xp table', () => {
  it('matches the Melvor reference values', () => {
    expect(xpAt(1)).toBe(0);
    expect(xpAt(2)).toBe(83);
    expect(xpAt(10)).toBe(1154);
    expect(xpAt(25)).toBe(7842);
    expect(xpAt(50)).toBe(101333);
  });

  it('is strictly increasing', () => {
    for (let l = 2; l <= 99; l++) expect(xpAt(l)).toBeGreaterThan(xpAt(l - 1));
  });

  it('rejects invalid levels', () => {
    expect(() => xpAt(0)).toThrow(RangeError);
    expect(() => xpAt(2.5)).toThrow(RangeError);
  });

  it('levelAt is the inverse of xpAt', () => {
    for (let l = 1; l <= 50; l++) {
      expect(levelAt(xpAt(l), 50)).toBe(l);
      if (l > 1) expect(levelAt(xpAt(l) - 1, 50)).toBe(l - 1);
    }
  });

  it('levelAt never exceeds the cap', () => {
    expect(levelAt(1e12, 50)).toBe(50);
    expect(levelAt(xpAt(60), 50)).toBe(50);
    expect(levelAt(0, 50)).toBe(1);
  });

  it('takes the cap from content', () => {
    expect(levelCap(content)).toBe(50);
  });
});
