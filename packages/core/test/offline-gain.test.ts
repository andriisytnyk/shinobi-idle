import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advanceOffline, dispatch, serialize } from '../src/index.ts';
import { genin, HOUR, start } from './helpers.ts';

describe('advanceOffline: what reached the Bank', () => {
  it('reports the net gain of items and currency, and writes nothing to the save', () => {
    const state = genin(4);
    state.skills.herb = { xp: 1e9 } as never;
    state.bank['core:mint'] = 3;
    dispatch(state, start('gather', 'core:mint'), content);
    const before = serialize(state, 0);
    const summary = advanceOffline(state, 2 * HOUR, content);
    const mint = state.bank['core:mint'] ?? 0;
    expect(mint).toBeGreaterThan(3);
    // Only the part that arrived while away, not the stock that was there.
    expect(summary.itemsGained?.['core:mint']).toBe(mint - 3);
    // Nothing that did not grow is listed.
    for (const n of Object.values(summary.itemsGained ?? {})) expect(n).toBeGreaterThan(0);
    for (const n of Object.values(summary.currencyGained ?? {})) expect(n).toBeGreaterThan(0);
    expect(serialize(state, 0)).not.toBe(before);
    expect(JSON.stringify(JSON.parse(serialize(state, 0)).state)).not.toContain('itemsGained');
  });

  it('is empty when nothing was gained', () => {
    const state = genin(4);
    const summary = advanceOffline(state, HOUR, content);
    expect(summary.itemsGained).toEqual({});
    expect(summary.currencyGained).toEqual({});
  });
});
