/** The preview of the auto-survey: the hexes it takes next, in the order of its rule. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { autoOrder, autoPlan, hexKey, surveyRange } from '../src/index.ts';
import { genin } from './helpers.ts';

describe('autoOrder', () => {
  it('starts with the hex autoPlan chooses and lists distinct hexes', () => {
    const state = genin();
    const plan = autoPlan(state, content);
    const order = autoOrder(state, content, 0, 6);
    expect(plan).not.toBeNull();
    expect(order[0]).toBe(hexKey(plan!.subject.hex.q, plan!.subject.hex.r));
    expect(order.length).toBeGreaterThan(1);
    expect(order.length).toBeLessThanOrEqual(6);
    expect(new Set(order).size).toBe(order.length);
  });

  it('is deterministic and read-only', () => {
    const state = genin();
    const before = JSON.stringify(state);
    expect(autoOrder(state, content, 0, 8)).toEqual(autoOrder(state, content, 0, 8));
    expect(JSON.stringify(state)).toBe(before);
    expect(surveyRange(state, content)).toBeGreaterThanOrEqual(1);
  });

  it('respects the limit', () => {
    expect(autoOrder(genin(), content, 0, 2).length).toBeLessThanOrEqual(2);
  });
});
