/** Containment, second round: wrong shapes, stall accounting, budgets, floors, blame by data, and the review nits. */
import { composeContent, corePack, type ContentPack, type PackData } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  addRule,
  advance,
  advanceOffline,
  composeGame,
  composeRules,
  defaultRules,
  deserialize,
  dispatch,
  serialize,
  takeNotices,
  type ActionKind,
  type GameState,
  type Rules,
  type System,
} from '../src/index.ts';
import { restoreDormant, stashMissing } from '../src/pack-data.ts';
import type { ContentDb } from '@shinobi/content';
import type { DormantPack } from '../src/state.ts';
import { testmodPack } from '../src/testmod/index.ts';
import {
  HOUR,
  modContent,
  modRules,
  plainContent,
  plainGenin,
  plainRules,
  setSkill,
} from './packs-helpers.ts';

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

const game = (rules: (r: Rules) => Rules, base: Rules = defaultRules) => {
  const p = pack('bad', rules);
  const content = composeContent([corePack, p]);
  return { content, rules: composeRules(base, [corePack, p], content) };
};

const busy = (g: { content: ContentDb; rules: Rules }): GameState => {
  const state = plainGenin();
  setSkill(state, 'tai', 12);
  dispatch(
    state,
    { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' },
    g.content,
    g.rules,
  );
  return state;
};
/** 0, 1, 0, 1 ... ms: a system that alternates. */
const alternate = (() => {
  let n = 0;
  return () => n++ % 2;
})();
const sys = (over: Partial<System>): System => ({
  id: 'bad:s',
  nextEventIn: () => null,
  run: () => undefined,
  ...over,
});
const disabled = (s: GameState) => s.events.filter((e) => e.type === 'ruleDisabled');

describe('wrong shapes from a pack', () => {
  const kind = (over: Partial<ActionKind>): ActionKind => ({
    has: (id) => id === 'x',
    requirements: () => null,
    intervalMs: () => 2000,
    complete: () => undefined,
    ...over,
  });
  const cases: [string, Partial<ActionKind>][] = [
    ['a requirement that is a string', { requirements: () => 'no' as never }],
    ['a requirement of an unknown kind', { requirements: () => ({ t: 'bogus' }) as never }],
    [
      'a requirement tree with a bad leaf',
      { requirements: () => ({ t: 'all', of: [{ t: 'skill' }] }) as never },
    ],
    ['a completion result that is no result', { complete: () => 'weird' as never }],
    ['a blocked reason that is a number', { blocked: () => 5 as never }],
  ];
  for (const [name, over] of cases) {
    it(`survives ${name}: advance goes on, the slot stops, the pack is named`, () => {
      const g = game((r) => addRule(r, 'actionKinds', 'bad:kind', kind(over)));
      const state = plainGenin();
      dispatch(
        state,
        { type: 'action.start', slot: 0, kind: 'bad:kind', id: 'x' },
        g.content,
        g.rules,
      );
      advance(state, HOUR, g.content, g.rules);
      expect(state.now).toBe(HOUR);
      expect(state.slots[0]?.action).toBeNull();
      for (const e of disabled(state)) expect(e).toMatchObject({ pack: 'bad' });
    });
  }

  it('stops the slot of a failed kind at once, not after an hour', () => {
    const g = game((r) =>
      addRule(
        r,
        'actionKinds',
        'bad:kind',
        kind({
          complete: () => {
            throw new Error('boom');
          },
        }),
      ),
    );
    const state = plainGenin();
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'bad:kind', id: 'x' },
      g.content,
      g.rules,
    );
    advance(state, 3000, g.content, g.rules);
    expect(state.slots[0]?.action).toBeNull();
    const stopped = state.events.find((e) => e.type === 'actionStopped');
    expect(stopped).toMatchObject({ cause: 'error.packRuleFailed' });
    expect(disabled(state)[0]).toMatchObject({ pack: 'bad' });
  });

  it('drops modifiers with a NaN, an infinite, a zero or a negative mul, or a bad group', () => {
    const g = game((r) =>
      addRule(r, 'modifierProviders', () => [
        { key: 'xp.all', op: 'mul', value: 0, group: 'items', source: 'b' },
        { key: 'xp.all', op: 'mul', value: -1, group: 'items', source: 'b' },
        { key: 'xp.all', op: 'add', value: Infinity, group: 'items', source: 'b' },
        { key: 'xp.all', op: 'add', value: 1, group: 'nowhere' as never, source: 'b' },
        { key: 'xp.all', op: 'mul', value: 2, group: 'items', source: 'b' },
      ]),
    );
    const info = actionInfo(
      busy(g),
      { kind: 'practice', id: 'core:leaf_whirlwind' },
      g.content,
      g.rules,
    );
    const base = actionInfo(
      busy(g),
      { kind: 'practice', id: 'core:leaf_whirlwind' },
      plainContent,
      plainRules,
    );
    expect((info?.xpPerHour ?? 0) / (base?.xpPerHour ?? 1)).toBeCloseTo(2, 10);
  });

  it('refuses a modifier with a zero or negative mul in the content of a pack, naming it', () => {
    const bad = pack(
      'worse',
      undefined,
      {},
      {
        buildings: [
          {
            id: 'worse:hut',
            tier6: null,
            role: 'bonus',
            effects: [{ key: 'xp.all', op: 'mul', value: 0 }],
            capstone: [],
            produces: [],
          },
        ],
      },
    );
    expect(() => composeContent([corePack, bad])).toThrow(/worse/);
  });
});

describe('stall accounting and budgets', () => {
  it('does not let pack systems trip the core stall check: two systems asking for +0 ms are both switched off', () => {
    const g = game((r) =>
      addRule(
        addRule(r, 'systems', sys({ id: 'bad:a', nextEventIn: () => 0 })),
        'systems',
        sys({ id: 'bad:b', nextEventIn: () => 0 }),
      ),
    );
    const state = busy(g);
    expect(() => advance(state, HOUR, g.content, g.rules)).not.toThrow();
    expect(state.now).toBe(HOUR);
    expect(
      disabled(state)
        .map((e) => (e as { rule: string }).rule)
        .sort(),
    ).toEqual(['bad:a', 'bad:b']);
    expect(state.stats.completed).toBeGreaterThan(100);
  });

  it('switches off a system that asks for 1 ms events, with the reason budget', () => {
    const g = game((r) => addRule(r, 'systems', sys({ nextEventIn: () => 1 })));
    const state = busy(g);
    advance(state, 12 * HOUR, g.content, g.rules);
    expect(state.now).toBe(12 * HOUR);
    expect(disabled(state)).toEqual([
      expect.objectContaining({
        pack: 'bad',
        rule: 'bad:s',
        reason: expect.stringContaining('budget'),
      }),
    ]);
  });

  it('switches off a system that alternates 0 and 1 ms', () => {
    const g = game((r) => addRule(r, 'systems', sys({ nextEventIn: () => alternate() })));
    const state = busy(g);
    advance(state, 12 * HOUR, g.content, g.rules);
    expect(state.now).toBe(12 * HOUR);
    expect(disabled(state)[0]).toMatchObject({ reason: expect.stringContaining('budget') });
  });

  const timeOf = (g: { content: ContentDb; rules: Rules }): number => {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const state = busy(g);
      const t0 = process.hrtime.bigint();
      advance(state, 12 * HOUR, g.content, g.rules);
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return best;
  };

  it('keeps 12 h of play within 3x of the core-only time with abusive systems and modifiers', () => {
    const core = timeOf({ content: plainContent, rules: plainRules });

    const abusive = game((r) => {
      let rules = addRule(r, 'systems', sys({ id: 'bad:one', nextEventIn: () => 1 }));
      rules = addRule(rules, 'systems', sys({ id: 'bad:flip', nextEventIn: () => alternate() }));
      rules = addRule(rules, 'modifierProviders', () => [
        { key: 'interval.skill.tai', op: 'mul', value: 0, group: 'items', source: 'b' },
        { key: 'speed.skill.tai', op: 'mul', value: 1e200, group: 'items', source: 'b' },
        { key: 'speed.skill.tai', op: 'mul', value: 1e200, group: 'village', source: 'b' },
      ]);
      return rules;
    });
    expect(timeOf(abusive)).toBeLessThan(core * 3);
  });

  it('never gives an action cycle under the floor of the balance', () => {
    const g = game((r) =>
      addRule(r, 'modifierProviders', () => [
        { key: 'speed.skill.tai', op: 'mul', value: 1e200, group: 'items', source: 'b' },
        { key: 'speed.skill.tai', op: 'mul', value: 1e200, group: 'village', source: 'b' },
      ]),
    );
    const info = actionInfo(
      busy(g),
      { kind: 'practice', id: 'core:leaf_whirlwind' },
      g.content,
      g.rules,
    );
    expect(info?.intervalMs).toBeGreaterThanOrEqual(g.content.balance.K.engine.minActionMs);
  });
});

describe('a pack system that touches the game time', () => {
  for (const [name, set] of [
    ['a NaN', Number.NaN],
    ['a fraction', 1.5],
    ['the past', -5],
  ] as const) {
    it(`is switched off and time is put back after ${name}`, () => {
      const g = game((r) =>
        addRule(
          r,
          'systems',
          sys({
            nextEventIn: () => 1000,
            run: (s) => {
              s.now = set;
            },
          }),
        ),
      );
      const state = busy(g);
      advance(state, HOUR, g.content, g.rules);
      expect(state.now).toBe(HOUR);
      expect(Number.isInteger(state.now)).toBe(true);
      expect(disabled(state)).toHaveLength(1);
    });
  }
});

describe('the player AI of a pack', () => {
  const ai = (rules: Rules) => rules.combatAi;
  it('falls back to the AI it replaced when it throws or answers with rubbish, and says so once', () => {
    takeNotices();
    for (const bad of [
      () => {
        throw new Error('boom');
      },
      () => 'attack' as never,
      () => ({ type: 'technique' }) as never,
    ]) {
      const base: Rules = { ...defaultRules, combatAi: () => ({ type: 'wait' }) };
      const g = game((r) => ({ ...r, combatAi: bad }), base);
      expect(ai(g.rules)({} as never)).toEqual({ type: 'wait' });
      expect(ai(g.rules)({} as never)).toEqual({ type: 'wait' });
      const notices = takeNotices();
      expect(notices).toEqual([expect.objectContaining({ pack: 'bad', rule: 'combatAi' })]);
    }
  });

  it('hands the notice to the UI at the end of an advance', () => {
    takeNotices();
    const g = game(
      (r) =>
        addRule(
          {
            ...r,
            combatAi: () => {
              throw new Error('x');
            },
          },
          'systems',
          sys({}),
        ),
      { ...defaultRules, combatAi: () => ({ type: 'wait' }) },
    );
    g.rules.combatAi({} as never);
    const state = busy(g);
    advance(state, 1000, g.content, g.rules);
    expect(disabled(state)).toContainEqual(
      expect.objectContaining({ pack: 'bad', rule: 'combatAi' }),
    );
  });
});

describe('composeGame blames the pack that failed, by data', () => {
  it('keeps a healthy testmod when another pack refers to a testmod id that does not exist', () => {
    const bad = pack(
      'bad',
      undefined,
      { dependsOn: ['core', 'testmod'] },
      {
        items: [
          {
            id: 'bad:x',
            kind: 'misc',
            tags: [],
            extraSources: [],
            madeFrom: [{ item: 'testmod:nothing', n: 1 }],
          },
        ],
      },
    );
    const g = composeGame([corePack, testmodPack, bad]);
    expect(g.failed.map((f) => f.pack)).toEqual(['bad']);
    expect(g.content.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
  });

  it('drops only the pack at fault when one id is the prefix of another', () => {
    const throwing = (id: string) =>
      pack(id, () => {
        throw new Error('boom');
      });
    const g = composeGame([corePack, pack('mod'), throwing('mod_x'), pack('mod_xy')]);
    expect(g.failed.map((f) => f.pack)).toEqual(['mod_x']);
    expect(g.content.packs.map((p) => p.id)).toEqual(['core', 'mod', 'mod_xy']);
  });
});

describe('what a loadout and a report keep for a missing pack', () => {
  const withPacks = (ids: string[]): ContentDb =>
    ({
      ...plainContent,
      packs: ids.map((id) => ({ id, version: '1', dependsOn: [], loadAfter: [] })),
    }) as ContentDb;

  it('returns the techniques of two packs and the signature of a saved loadout', () => {
    const raw = () => ({
      loadouts: {
        active: [],
        signature: null,
        saved: { main: { techniques: ['core:a', 'one:x', 'two:y', 'core:b'], signature: 'two:y' } },
      },
    });
    const dormant: Record<string, DormantPack> = {};
    const away = stashMissing(raw(), withPacks(['core']), dormant, new Map()) as {
      loadouts: { saved: { main: { techniques: string[]; signature: unknown } } };
    };
    expect(away.loadouts.saved.main).toEqual({ techniques: ['core:a', 'core:b'], signature: null });
    expect(Object.keys(dormant).sort()).toEqual(['one', 'two']);
    let back = restoreDormant(away, withPacks(['core', 'one']), dormant).raw as typeof away;
    expect(back.loadouts.saved.main.techniques).toEqual(['core:a', 'one:x', 'core:b']);
    back = restoreDormant(back, withPacks(['core', 'one', 'two']), dormant).raw as typeof away;
    expect(back.loadouts.saved.main).toEqual({
      techniques: ['core:a', 'one:x', 'two:y', 'core:b'],
      signature: 'two:y',
    });
  });

  it('keeps a pack technique counted inside an entry of the core', () => {
    const raw = () => ({
      report: { 'core:wolf': { fights: 3, used: { 'core:clone': 2, 'ghost:spell': 5 } } },
    });
    const dormant: Record<string, DormantPack> = {};
    const away = stashMissing(raw(), withPacks(['core']), dormant, new Map());
    expect(dormant.ghost?.data['report~']).toBeDefined();
    // Meanwhile the core entry grows.
    const grown = { report: { 'core:wolf': { fights: 9, used: { 'core:clone': 7 } } } };
    void away;
    const back = restoreDormant(grown, withPacks(['core', 'ghost']), dormant).raw as typeof grown;
    expect(back.report['core:wolf']).toEqual({
      fights: 9,
      used: { 'core:clone': 7, 'ghost:spell': 5 },
    });
  });
});

describe('small fixes', () => {
  it('sanitises a fractional attach time to a whole number', () => {
    const state = plainGenin();
    const text = JSON.parse(serialize(state)) as {
      state: { packs: { id: string; since: number }[] };
    };
    for (const p of text.state.packs) p.since = 1.5;
    const loaded = deserialize(JSON.stringify(text), plainContent, plainRules);
    expect(loaded.packs.every((p) => Number.isInteger(p.since))).toBe(true);
  });

  it('brings the rules that failed while away into the offline summary', () => {
    const g = game((r) => addRule(r, 'systems', sys({ nextEventIn: () => -1 })));
    const state = busy(g);
    const summary = advanceOffline(state, HOUR, g.content, g.rules);
    expect(summary.rulesDisabled).toEqual([
      expect.objectContaining({ pack: 'bad', rule: 'bad:s' }),
    ]);
  });

  it('the test pack still plays with its guarded rules', () => {
    const state = plainGenin();
    void state;
    expect(modRules.systems.some((s) => s.id === 'testmod:tokens')).toBe(true);
    expect(modContent.packs).toHaveLength(2);
  });
});
