// @vitest-environment happy-dom
import { createState } from '@shinobi/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { techniqueFigures } from '../src/lib/technique-figures.ts';
import { game } from '../src/lib/store.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());

const content = game.content;
const product = (rows: readonly { value: number }[]): number =>
  rows.reduce((acc, row) => acc * row.value, 1);

describe('the fight numbers of a technique and the factors behind them', () => {
  const state = createState(1, content);

  it('the damage rows multiply out to the damage the core computes', () => {
    let checked = 0;
    for (const tech of content.techniques) {
      const f = techniqueFigures(state, tech, content, game.rules, 1);
      if (f.damage) {
        expect(product(f.damage), tech.id).toBeCloseTo(f.numbers.damage, 6);
        expect(f.damage[0]?.base).toBe(true);
        checked++;
      } else {
        expect(f.numbers.damage, tech.id).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the cost rows multiply out to the cost the core computes, in the pool the core names', () => {
    let checked = 0;
    for (const tech of content.techniques) {
      const f = techniqueFigures(state, tech, content, game.rules, 1);
      if (f.cost.length > 0) {
        expect(product(f.cost), tech.id).toBeCloseTo(f.numbers.cost, 6);
        checked++;
      } else {
        expect(f.numbers.cost, tech.id).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('mastery lifts the damage and lowers the cost by the balance shares', () => {
    const tech = content.techniques.find((t) => t.rank !== null && !t.noDamage);
    if (!tech) throw new Error('no technique with damage');
    const K = content.balance.K;
    const low = techniqueFigures(state, tech, content, game.rules, 1);
    const high = techniqueFigures(state, tech, content, game.rules, K.masteryCap);
    expect(high.mastery).toEqual({ level: K.masteryCap, cap: K.masteryCap });
    const factor = (rows: typeof low.damage, key: string) =>
      rows?.find((r) => r.key === key)?.value;
    expect(factor(high.damage, 'technique.factor.mastery')).toBeCloseTo(1 + K.masteryDmg, 6);
    expect(factor(high.cost.length ? high.cost : null, 'technique.factor.mastery')).toBeCloseTo(
      1 - K.masteryCost,
      6,
    );
    expect(factor(low.damage, 'technique.factor.mastery')).toBeLessThan(
      factor(high.damage, 'technique.factor.mastery') ?? 0,
    );
  });
});
