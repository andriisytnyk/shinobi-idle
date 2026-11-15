/** A pack cannot stop or corrupt `advance`; a pack that fails to compose is left out and the game starts. */
import { composeContent, corePack, type ContentPack, type PackData } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addRule,
  advance,
  composeGame,
  composeRules,
  defaultRules,
  dispatch,
  getMod,
  originOf,
  serialize,
  type ActionKind,
  type GameState,
  type Rules,
  type System,
} from '../src/index.ts';
import { HOUR, modGenin, plainGenin, setSkill } from './packs-helpers.ts';
import { testmodPack } from '../src/testmod/index.ts';

const pack = (
  id: string,
  rules?: (r: Rules) => Rules,
  extra: Partial<ContentPack['manifest']> = {},
  data: Record<string, unknown> = {},
): ContentPack => ({
  manifest: { id, version: '1', dependsOn: ['core'], loadAfter: [], ...extra },
  data: data as unknown as PackData,
  balance: {},
  locales: { uk: {} },
  icons: {},
  patches: [],
  ...(rules ? { rules: rules as unknown as ContentPack['rules'] } : {}),
});

const game = (rules: (r: Rules) => Rules) => {
  const p = pack('bad', rules);
  const content = composeContent([corePack, p]);
  return { content, rules: composeRules(defaultRules, [corePack, p], content) };
};

const run = (g: ReturnType<typeof game>, state: GameState, ms = HOUR): void => {
  advance(state, ms, g.content, g.rules);
};

const systemOf = (over: Partial<System>): System => ({
  id: 'bad:sys',
  nextEventIn: () => null,
  run: () => undefined,
  ...over,
});

const disabled = (state: GameState) => state.events.filter((e) => e.type === 'ruleDisabled');

describe('a system of a pack', () => {
  const cases: [string, Partial<System>][] = [
    ['NaN', { nextEventIn: () => Number.NaN }],
    ['negative', { nextEventIn: () => -5 }],
    ['fractional', { nextEventIn: () => 0.5 }],
    ['Infinity', { nextEventIn: () => Number.POSITIVE_INFINITY }],
    ['a string', { nextEventIn: () => '5' as unknown as number }],
    ['a zero delay loop', { nextEventIn: () => 0 }],
    [
      'a throw in nextEventIn',
      {
        nextEventIn: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'a throw in elapse',
      {
        nextEventIn: () => 1000,
        elapse: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'a throw in run',
      {
        nextEventIn: () => 1000,
        run: () => {
          throw new Error('boom');
        },
      },
    ],
  ];
  for (const [name, over] of cases) {
    it(`is switched off for ${name}: advance ends, time stays whole, the pack and the system are named`, () => {
      const g = game((r) => addRule(r, 'systems', systemOf(over)));
      const state = plainGenin();
      setSkill(state, 'tai', 12);
      dispatch(
        state,
        { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' },
        g.content,
        g.rules,
      );
      run(g, state);
      expect(state.now).toBe(HOUR);
      expect(Number.isInteger(state.now)).toBe(true);
      // The game went on: the core action ran.
      expect(state.stats.completed).toBeGreaterThan(100);
      expect(disabled(state)).toEqual([
        expect.objectContaining({ type: 'ruleDisabled', pack: 'bad', rule: 'bad:sys' }),
      ]);
      // Not saved as disabled: a load tries the system again.
      expect(serialize(state)).not.toContain('ruleDisabled');
    });
  }

  it('keeps a well-behaved system running', () => {
    let runs = 0;
    const g = game((r) =>
      addRule(
        r,
        'systems',
        systemOf({
          nextEventIn: (s) => 1000 - (s.now % 1000),
          run: () => {
            runs++;
          },
        }),
      ),
    );
    run(g, plainGenin(), 5000);
    expect(runs).toBeGreaterThanOrEqual(5);
  });

  it('records the pack of every entry it adds, and none for the core ones', () => {
    const g = game((r) => addRule(r, 'systems', systemOf({})));
    expect(originOf(g.rules.systems.at(-1) as System)).toBe('bad');
    expect(originOf(g.rules.systems[0] as System)).toBeUndefined();
  });
});

describe('an action kind of a pack', () => {
  const kind = (over: Partial<ActionKind>): ActionKind => ({
    has: (id) => id === 'x',
    requirements: () => null,
    intervalMs: () => 1000,
    complete: () => undefined,
    ...over,
  });
  const cases: [string, Partial<ActionKind>][] = [
    [
      'requirements',
      {
        requirements: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'intervalMs',
      {
        intervalMs: () => {
          throw new Error('boom');
        },
      },
    ],
    ['an interval of NaN', { intervalMs: () => Number.NaN }],
    ['an interval of zero', { intervalMs: () => 0 }],
    ['a fractional interval', { intervalMs: () => 1.5 }],
    [
      'complete',
      {
        complete: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'start',
      {
        start: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'stop',
      {
        stop: () => {
          throw new Error('boom');
        },
      },
    ],
  ];
  for (const [name, over] of cases) {
    it(`does not stop the game when ${name} fails`, () => {
      const g = game((r) => addRule(r, 'actionKinds', 'bad:kind', kind(over)));
      const state = plainGenin();
      setSkill(state, 'tai', 12);
      dispatch(
        state,
        { type: 'action.start', slot: 0, kind: 'bad:kind', id: 'x' },
        g.content,
        g.rules,
      );
      run(g, state);
      expect(Number.isInteger(state.now)).toBe(true);
      expect(state.now).toBe(HOUR);
      // The slot does not keep a failing action, and the failure names the pack.
      if (over.stop === undefined) expect(state.slots[0]?.action).toBeNull();
      const failures = disabled(state);
      if (over.stop === undefined || state.slots[0]?.action === null) {
        expect(failures.every((e) => e.type === 'ruleDisabled' && e.pack === 'bad')).toBe(true);
      }
      // The core action still starts afterwards.
      expect(
        dispatch(
          state,
          { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' },
          g.content,
          g.rules,
        ).ok,
      ).toBe(true);
    });
  }
});

describe('a modifier provider of a pack', () => {
  it('contributes nothing when it throws or returns rubbish, and the rest still counts', () => {
    const g = game((r) => {
      let rules = addRule(r, 'modifierProviders', () => {
        throw new Error('boom');
      });
      rules = addRule(rules, 'modifierProviders', (() => 5) as unknown as never);
      rules = addRule(rules, 'modifierProviders', () => [
        { key: 'xp.all', op: 'add', value: Number.NaN, group: 'items', source: 'bad' },
        { key: 'xp.all', op: 'add', value: 0.5, group: 'items', source: 'bad' },
      ]);
      return rules;
    });
    const mod = getMod(plainGenin(), 'xp.all', g.content, g.rules);
    expect(mod.total).toBeCloseTo(1.5, 10);
  });
});

describe('the wrapped drill of the test pack', () => {
  it('is guarded: it carries the pack', () => {
    const state = modGenin();
    void state;
    const g = composeGame([corePack, testmodPack]);
    expect(originOf(g.rules.actionKinds.drill as ActionKind)).toBe('testmod');
  });
});

describe('composeGame', () => {
  const throwing = pack('boom', () => {
    throw new Error('no good');
  });
  const dependent = pack('child', undefined, { dependsOn: ['core', 'boom'] });
  const badData = pack('baddata', undefined, {}, { items: [{ id: 'baddata:x', kind: 'nokind' }] });

  it('is the plain game when every pack is fine', () => {
    const g = composeGame([corePack, testmodPack]);
    expect(g.failed).toEqual([]);
    expect(g.content.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
  });

  it('leaves out a pack whose rules throw, and the packs that depend on it', () => {
    const g = composeGame([corePack, throwing, dependent, testmodPack]);
    expect(g.failed.map((f) => f.pack)).toEqual(['boom', 'child']);
    expect(g.failed[0]?.error).toContain('boom');
    expect(g.content.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
    expect(g.rules.systems.map((s) => s.id)).toContain('testmod:tokens');
  });

  it('leaves out a pack whose content does not compose', () => {
    const g = composeGame([corePack, badData, testmodPack]);
    expect(g.failed.map((f) => f.pack)).toEqual(['baddata']);
    expect(g.content.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
  });

  it('gives the same game for any order of the packs', () => {
    const a = composeGame([corePack, throwing, badData, dependent, testmodPack]);
    const b = composeGame([testmodPack, dependent, badData, throwing, corePack]);
    expect(b.failed.map((f) => f.pack).sort()).toEqual(a.failed.map((f) => f.pack).sort());
    expect(b.content.packs.map((p) => p.id)).toEqual(a.content.packs.map((p) => p.id));
  });

  it('names the pack for an error of addRule', () => {
    const clash = pack('clash', (r) =>
      addRule(r, 'actionKinds', 'practice', defaultRules.actionKinds.practice as ActionKind),
    );
    const g = composeGame([corePack, clash]);
    expect(g.failed[0]).toEqual({ pack: 'clash', error: expect.stringContaining('clash') });
  });
});
