import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addCurrency,
  addItem,
  evalReq,
  hasCurrency,
  hasItem,
  removeCurrency,
  removeItem,
  type Req,
  type ReqResult,
} from '../src/index.ts';
import { genin, setLevel } from './helpers.ts';

function shape(r: ReqResult) {
  return { met: r.met, current: r.current, target: r.target, ref: r.ref };
}

describe('A8: evalReq', () => {
  const state = genin();
  setLevel(state, 'tai', 12);
  state.known['core:clone'] = true;
  state.player.natures = ['katon'];
  state.bank['core:mint'] = 3;
  state.flags['gate'] = true;
  state.flags['count'] = 4;
  state.flags['quest.core:q1'] = 2;
  state.flags['building.core:academy'] = 3;
  const check = (req: Req) => evalReq(state, req, content);

  it('skill', () => {
    expect(shape(check({ t: 'skill', skill: 'tai', level: 10 }))).toEqual({
      met: true,
      current: 12,
      target: 10,
      ref: { kind: 'skill', id: 'tai' },
    });
    expect(check({ t: 'skill', skill: 'tai', level: 13 }).met).toBe(false);
  });

  it('technique', () => {
    expect(shape(check({ t: 'technique', id: 'core:clone' }))).toEqual({
      met: true,
      current: 1,
      target: 1,
      ref: { kind: 'technique', id: 'core:clone' },
    });
    expect(shape(check({ t: 'technique', id: 'core:front_lotus' }))).toMatchObject({
      met: false,
      current: 0,
    });
  });

  it('rank compares order', () => {
    expect(shape(check({ t: 'rank', rank: 'genin' }))).toEqual({
      met: true,
      current: 1,
      target: 1,
      ref: null,
    });
    expect(shape(check({ t: 'rank', rank: 'chunin' }))).toEqual({
      met: false,
      current: 1,
      target: 2,
      ref: null,
    });
    expect(check({ t: 'rank', rank: 'student' }).met).toBe(true);
  });

  it('nature', () => {
    expect(shape(check({ t: 'nature', nature: 'katon' }))).toEqual({
      met: true,
      current: 1,
      target: 1,
      ref: { kind: 'skill', id: 'katon' },
    });
    expect(check({ t: 'nature', nature: 'suiton' }).met).toBe(false);
  });

  it('item', () => {
    expect(shape(check({ t: 'item', id: 'core:mint', n: 5 }))).toEqual({
      met: false,
      current: 3,
      target: 5,
      ref: { kind: 'item', id: 'core:mint' },
    });
    expect(check({ t: 'item', id: 'core:mint', n: 3 }).met).toBe(true);
  });

  it('quest', () => {
    expect(shape(check({ t: 'quest', id: 'core:q1', step: 2 }))).toEqual({
      met: true,
      current: 2,
      target: 2,
      ref: { kind: 'quest', id: 'core:q1' },
    });
    expect(check({ t: 'quest', id: 'core:q1', step: 3 }).met).toBe(false);
    expect(shape(check({ t: 'quest', id: 'core:q2' }))).toMatchObject({ met: false, target: 1 });
  });

  it('building', () => {
    expect(shape(check({ t: 'building', id: 'core:academy', level: 3 }))).toEqual({
      met: true,
      current: 3,
      target: 3,
      ref: { kind: 'building', id: 'core:academy' },
    });
    expect(check({ t: 'building', id: 'core:academy', level: 4 }).met).toBe(false);
  });

  it('flag', () => {
    expect(shape(check({ t: 'flag', id: 'gate' }))).toEqual({
      met: true,
      current: 1,
      target: 1,
      ref: null,
    });
    expect(shape(check({ t: 'flag', id: 'count', n: 5 }))).toMatchObject({
      met: false,
      current: 4,
      target: 5,
    });
    expect(shape(check({ t: 'flag', id: 'missing' }))).toMatchObject({ met: false, current: 0 });
  });

  it('all and any nest and keep their children', () => {
    const tree: Req = {
      t: 'all',
      of: [
        { t: 'skill', skill: 'tai', level: 10 },
        {
          t: 'any',
          of: [
            { t: 'nature', nature: 'suiton' },
            {
              t: 'all',
              of: [
                { t: 'flag', id: 'gate' },
                { t: 'item', id: 'core:mint', n: 9 },
              ],
            },
            { t: 'technique', id: 'core:clone' },
          ],
        },
      ],
    };
    const r = check(tree);
    expect(shape(r)).toEqual({ met: true, current: 2, target: 2, ref: null });
    const any = r.children[1]!;
    expect(shape(any)).toEqual({ met: true, current: 1, target: 1, ref: null });
    expect(any.children.map((c) => c.met)).toEqual([false, false, true]);
    const inner = any.children[1]!;
    expect(shape(inner)).toEqual({ met: false, current: 1, target: 2, ref: null });
    expect(inner.children.map((c) => c.current)).toEqual([1, 3]);
    expect(r.children[0]!.children).toEqual([]);

    expect(check({ t: 'all', of: [] }).met).toBe(true);
    expect(check({ t: 'any', of: [] }).met).toBe(false);
    expect(check({ t: 'all', of: [{ t: 'flag', id: 'missing' }] }).met).toBe(false);
  });
});

describe('bank and currencies', () => {
  it('adds, checks and removes items with an insufficiency check', () => {
    const s = genin();
    expect(addItem(s, 'core:mint', 4)).toBe(true);
    expect(hasItem(s, 'core:mint', 4)).toBe(true);
    expect(hasItem(s, 'core:mint', 5)).toBe(false);
    expect(removeItem(s, 'core:mint', 5)).toBe(false);
    expect(s.bank['core:mint']).toBe(4);
    expect(removeItem(s, 'core:mint', 4)).toBe(true);
    expect(s.bank).toEqual({});
    expect(hasItem(s, 'core:mint')).toBe(false);
  });

  it('rejects fractional or negative counts', () => {
    const s = genin();
    expect(addItem(s, 'core:mint', -1)).toBe(false);
    expect(addItem(s, 'core:mint', 1.5)).toBe(false);
    expect(addItem(s, 'core:mint', 0)).toBe(true);
    expect(s.bank).toEqual({});
    expect(removeItem(s, 'core:mint', -1)).toBe(false);
  });

  it('spends currency only when the balance covers it', () => {
    const s = genin();
    expect(addCurrency(s, 'ryo', 100)).toBe(true);
    expect(hasCurrency(s, 'ryo', 100)).toBe(true);
    expect(removeCurrency(s, 'ryo', 101)).toBe(false);
    expect(removeCurrency(s, 'ryo', 40)).toBe(true);
    expect(s.currencies.ryo).toBe(60);
    expect(addCurrency(s, 'rep', -3)).toBe(false);
    expect(s.currencies.rep).toBe(0);
  });
});
