/** T4: tampered `packs`, `dormant`, rank order and prototype-named ids in a save are cleaned without a throw and without touching any global object. */
import { describe, expect, it } from 'vitest';
import { advance, deserialize, dispatch, serialize, type GameState } from '../src/index.ts';
import { TOKEN } from '../src/testmod/index.ts';
import {
  HOUR,
  modContent,
  modGenin,
  modRules,
  plainContent,
  plainRules,
  setSkill,
} from './packs-helpers.ts';

type Raw = Record<string, unknown>;

/** A save made with the pack and with the core game running, as a parsed object to tamper with. */
function base(): { v: number; savedAt: number; state: Raw } {
  const state: GameState = modGenin(3);
  setSkill(state, 'tai', 12);
  dispatch(
    state,
    { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' },
    modContent,
    modRules,
  );
  setSkill(state, 'testmod:forge', 3);
  state.currencies[TOKEN] = 4;
  state.bank['testmod:pellet'] = 9;
  state.player.rank = 'testmod:adept';
  advance(state, 60_000, modContent, modRules);
  return JSON.parse(serialize(state)) as { v: number; savedAt: number; state: Raw };
}

/** Puts an own property that is called `__proto__`, as JSON text with that key does. */
const own = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

const deep = (n: number): unknown => (n === 0 ? 1 : { a: deep(n - 1) });
const many = (n: number, f: (i: number) => unknown): Raw =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`ghost:k${i}`, f(i)]));

const cases: [string, (s: Raw) => void][] = [
  ['packs is a string', (s) => (s.packs = 'x')],
  ['packs is a number', (s) => (s.packs = 5)],
  ['packs is null', (s) => (s.packs = null)],
  ['packs holds junk', (s) => (s.packs = [1, 2, 'x', null, [], { id: 3 }])],
  [
    'a pack called __proto__',
    (s) =>
      (s.packs = [
        Object.defineProperty({ version: '1' }, 'id', { value: '__proto__', enumerable: true }),
      ]),
  ],
  ['a pack called constructor', (s) => (s.packs = [{ id: 'constructor', version: '1' }])],
  ['a pack with a text for an id', (s) => (s.packs = [{ id: 'A B', version: '1' }])],
  [
    'duplicate packs',
    (s) =>
      (s.packs = [
        { id: 'core', version: '1' },
        { id: 'core', version: '2' },
      ]),
  ],
  ['a version that is an object', (s) => (s.packs = [{ id: 'testmod', version: { x: 1 } }])],
  [
    'a hundred thousand packs',
    (s) => (s.packs = Array.from({ length: 100_000 }, (_, i) => ({ id: `p${i}`, version: '1' }))),
  ],
  ['dormant is an array', (s) => (s.dormant = [])],
  ['dormant is a string', (s) => (s.dormant = 'x')],
  ['dormant is null', (s) => (s.dormant = null)],
  [
    'a bucket called __proto__',
    (s) => {
      const dormant: Raw = {};
      own(dormant, '__proto__', {
        data: { skills: { polluted: { xp: 1 } } },
        rank: 'testmod:adept',
        natures: [],
        version: '1',
      });
      s.dormant = dormant;
    },
  ],
  [
    'a bucket called constructor',
    (s) => (s.dormant = { constructor: { data: { bank: { 'x:y': 1 } }, version: '1' } }),
  ],
  ['a bucket called prototype', (s) => (s.dormant = { prototype: { data: {}, version: '1' } })],
  ['a bucket called toString', (s) => (s.dormant = { toString: { data: {}, version: '1' } })],
  [
    'a bucket for core',
    (s) => (s.dormant = { core: { data: { bank: { 'core:bun': 5 } }, version: '1' } }),
  ],
  ['a bucket that is a number', (s) => (s.dormant = { ghost: 5 })],
  ['a bucket whose data is a string', (s) => (s.dormant = { ghost: { data: 'x', version: '1' } })],
  ['a bucket whose branch is a list', (s) => (s.dormant = { ghost: { data: { skills: [1, 2] } } })],
  [
    'an entry called __proto__ in a bucket',
    (s) => {
      const skills: Raw = {};
      own(skills, '__proto__', { xp: 9 });
      s.dormant = { ghost: { data: { skills }, version: '1' } };
    },
  ],
  [
    'an entry of 1e308',
    (s) =>
      (s.dormant = {
        ghost: { data: { skills: { 'ghost:s': { xp: 1e308 } }, currencies: { 'ghost:c': 1e308 } } },
      }),
  ],
  [
    'a negative and a text balance',
    (s) =>
      (s.dormant = {
        ghost: { data: { currencies: { 'ghost:a': -5, 'ghost:b': 'many', 'ghost:c': NaN } } },
      }),
  ],
  [
    'a rank that is an object',
    (s) => (s.dormant = { ghost: { rank: { x: 1 }, natures: [1, {}, null, 'ghost:n'], data: {} } }),
  ],
  [
    'a value nested fifty levels deep',
    (s) => (s.dormant = { ghost: { data: { flags: { 'ghost:f': deep(50) } } } }),
  ],
  [
    'five thousand buckets',
    (s) =>
      (s.dormant = Object.fromEntries(
        Array.from({ length: 5000 }, (_, i) => [`g${i}`, { data: {}, version: '1' }]),
      )),
  ],
  [
    'ten thousand entries in a branch',
    (s) => (s.dormant = { ghost: { data: { counters: many(10_000, () => 1) } } }),
  ],
  [
    'a very long key',
    (s) => (s.dormant = { ghost: { data: { bank: { ['ghost:' + 'x'.repeat(10_000)]: 1 } } } }),
  ],
  ['rankOrder is a string', (s) => (s.rankOrder = 'student')],
  ['rankOrder holds junk', (s) => (s.rankOrder = [1, null, {}, 'student', 'testmod:adept'])],
  ['rankOrder is huge', (s) => (s.rankOrder = Array.from({ length: 100_000 }, (_, i) => `r${i}`))],
  ['the rank is constructor', (s) => ((s.player as Raw).rank = 'constructor')],
  ['the rank is __proto__', (s) => ((s.player as Raw).rank = '__proto__')],
  ['the rank is a number', (s) => ((s.player as Raw).rank = 7)],
  [
    'the natures are prototype names',
    (s) => ((s.player as Raw).natures = ['__proto__', 'constructor', 'toString', 'testmod:aether']),
  ],
  [
    'a hundred thousand natures',
    (s) => ((s.player as Raw).natures = Array.from({ length: 100_000 }, () => 'katon')),
  ],
  [
    'flags and counters named after Object',
    (s) => {
      const flags: Raw = { constructor: true, toString: 1, hasOwnProperty: true };
      own(flags, '__proto__', true);
      s.flags = flags;
      const counters: Raw = { constructor: 1, valueOf: 2 };
      own(counters, '__proto__', 3);
      s.counters = counters;
    },
  ],
  [
    'skills, bank and currencies named after Object',
    (s) => {
      const skills: Raw = { constructor: { xp: 1 }, tai: { xp: 100 } };
      own(skills, '__proto__', { xp: 1 });
      s.skills = skills;
      s.bank = { constructor: 3, __proto__: 4, toString: 5 };
      const currencies: Raw = { ryo: 1e308, rep: -1, intel: 'x', constructor: 7 };
      own(currencies, '__proto__', 8);
      s.currencies = currencies;
    },
  ],
  [
    'an action kind called constructor',
    (s) =>
      ((s.slots as Raw[])[0] = {
        action: { kind: 'constructor', id: 'x' },
        progress: 5,
        share: 1000,
        data: null,
      }),
  ],
  [
    'an action kind called __proto__',
    (s) =>
      ((s.slots as Raw[])[0] = {
        action: { kind: '__proto__', id: 'x' },
        progress: 5,
        share: 1000,
        data: null,
      }),
  ],
  [
    'an action kind called hasOwnProperty',
    (s) =>
      ((s.slots as Raw[])[0] = {
        action: { kind: 'hasOwnProperty', id: 'x' },
        progress: 5,
        share: 1000,
        data: null,
      }),
  ],
  [
    'an action of a pack that is missing',
    (s) =>
      ((s.slots as Raw[])[0] = {
        action: { kind: 'craft', id: 'testmod:elixir_brew' },
        progress: 5,
        share: 1000,
        data: null,
      }),
  ],
];

describe('a tampered save', () => {
  it('has more than thirty cases', () => {
    expect(cases.length).toBeGreaterThan(30);
  });

  for (const [name, mutate] of cases) {
    for (const [label, content, rules] of [
      ['core only', plainContent, plainRules],
      ['with the pack', modContent, modRules],
    ] as const) {
      it(`${name}: loads without a throw (${label}) and plays on`, () => {
        const objectNames = Object.getOwnPropertyNames(Object.prototype).sort();
        const arrayNames = Object.getOwnPropertyNames(Array.prototype).sort();
        const functionNames = Object.getOwnPropertyNames(Function.prototype).sort();
        const save = base();
        mutate(save.state);
        const state = deserialize(JSON.stringify(save), content, rules);
        // The result is a state: it saves, and the saved text loads again.
        const text = serialize(state);
        expect(() => deserialize(text, content, rules)).not.toThrow();
        advance(state, HOUR, content, rules);
        // Only valid pack ids hold dormant data, and never the core pack.
        for (const [pack, held] of Object.entries(state.dormant)) {
          expect(pack).toMatch(/^[a-z][a-z0-9_]*$/);
          expect(['core', 'constructor', 'prototype', 'toString']).not.toContain(pack);
          expect(typeof held.version).toBe('string');
          for (const entries of Object.values(held.data)) {
            expect(Object.keys(entries).length).toBeLessThanOrEqual(4000);
            for (const value of Object.values(entries)) {
              expect(JSON.stringify(value).length).toBeLessThan(100_000);
            }
          }
        }
        // Balances are numbers a game can hold.
        for (const n of Object.values(state.currencies)) {
          expect(Number.isFinite(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(1e15 + 1e9);
        }
        // Nothing reached a global object.
        expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(objectNames);
        expect(Object.getOwnPropertyNames(Array.prototype).sort()).toEqual(arrayNames);
        expect(Object.getOwnPropertyNames(Function.prototype).sort()).toEqual(functionNames);
        expect(({} as Raw).polluted).toBeUndefined();
        expect(({} as Raw).xp).toBeUndefined();
        expect(Object.keys(Object.prototype)).toEqual([]);
        expect(Object.getPrototypeOf(state.skills)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(state.currencies)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(state.flags)).toBe(Object.prototype);
      });
    }
  }

  it('keeps a good bucket that sits beside bad ones', () => {
    const save = base();
    const good = { version: '1', rank: null, natures: [], data: { bank: { 'ghost:item': 3 } } };
    save.state.dormant = { ghost: good, constructor: good, core: good, _underscore: good };
    const state = deserialize(JSON.stringify(save), plainContent, plainRules);
    // The bucket of the pack the save was made with stays too (its own data is in the save's branches).
    expect(Object.keys(state.dormant).sort()).toEqual(['ghost', 'testmod']);
    expect(state.dormant.ghost?.data.bank).toEqual({ 'ghost:item': 3 });
  });
});
