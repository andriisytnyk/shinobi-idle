/** `composeRules`, `addRule` and `wrapRule`: the rules of a game come from the rules of its packs, in load order, and never change the rules they start from. */
import { composeContent, corePack, type ContentPack } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { addRule, composeRules, defaultRules, wrapRule, type Rules } from '../src/index.ts';
import { testmodPack } from '../src/testmod/index.ts';
import { modContent, plainContent } from './packs-helpers.ts';

const ruled = (id: string, fn: (rules: Rules) => Rules, loadAfter: string[] = []): ContentPack => ({
  manifest: { id, version: '1', dependsOn: ['core'], loadAfter },
  data: {},
  balance: {},
  locales: { uk: {} },
  icons: {},
  patches: [],
  rules: fn as unknown as ContentPack['rules'],
});

const noop = { nextEventIn: () => null, run: () => undefined };

describe('composeRules', () => {
  it('is the rules of the core pack for the core pack alone', () => {
    expect(composeRules(defaultRules, [corePack], plainContent)).toBe(defaultRules);
  });

  it('runs the functions of the packs in the load order of the content, whatever the order given', () => {
    const calls: string[] = [];
    const a = ruled(
      'aaa',
      (r) => (calls.push('aaa'), addRule(r, 'systems', { ...noop, id: 'aaa:s' })),
    );
    const b = ruled(
      'bbb',
      (r) => (calls.push('bbb'), addRule(r, 'systems', { ...noop, id: 'bbb:s' })),
      ['aaa'],
    );
    const content = composeContent([corePack, a, b]);
    expect(content.packs.map((p) => p.id)).toEqual(['core', 'aaa', 'bbb']);
    const rules = composeRules(defaultRules, [b, corePack, a], content);
    expect(calls).toEqual(['aaa', 'bbb']);
    expect(rules.systems.map((s) => s.id).slice(-2)).toEqual(['aaa:s', 'bbb:s']);
    // A later pack sees what an earlier one added.
    const seen: (string | undefined)[] = [];
    const c = ruled('ccc', (r) => (seen.push(...r.systems.map((s) => s.id)), r), ['bbb']);
    composeRules(defaultRules, [c, a, b], composeContent([corePack, a, b, c]));
    expect(seen).toContain('aaa:s');
    expect(seen).toContain('bbb:s');
  });

  it('ignores a pack the content does not hold and does not change the rules it starts from', () => {
    const before = { ...defaultRules, systems: [...defaultRules.systems] };
    const stray = ruled('stray', (r) => addRule(r, 'systems', noop));
    expect(composeRules(defaultRules, [corePack, stray], plainContent)).toBe(defaultRules);
    composeRules(defaultRules, testmodPackList(), modContent);
    expect(defaultRules.systems).toEqual(before.systems);
    expect(Object.keys(defaultRules.actionKinds)).toEqual(Object.keys(before.actionKinds));
  });

  it('refuses a function that does not return rules, naming the pack', () => {
    const broken = ruled('broken', () => ({}) as Rules);
    expect(() =>
      composeRules(defaultRules, [corePack, broken], composeContent([corePack, broken])),
    ).toThrow(/broken/);
  });
});

const testmodPackList = (): ContentPack[] => [corePack, testmodPack];

describe('addRule and wrapRule', () => {
  it('appends systems and providers and adds a kind under a free key', () => {
    const provider = () => [];
    const rules = addRule(addRule(defaultRules, 'modifierProviders', provider), 'systems', noop);
    expect(rules.modifierProviders.at(-1)).toBe(provider);
    expect(rules.systems).toHaveLength(defaultRules.systems.length + 1);
    expect(defaultRules.systems).toHaveLength(5);
    const kind = defaultRules.actionKinds.practice;
    if (!kind) throw new Error('practice');
    expect(addRule(defaultRules, 'actionKinds', 'x:kind', kind).actionKinds['x:kind']).toBe(kind);
    expect(() => addRule(defaultRules, 'actionKinds', 'practice', kind)).toThrow(/exists/);
    expect(() => addRule(defaultRules, 'actionKinds', 'constructor', kind)).not.toThrow();
  });

  it('wraps a kind or a system by its key and fails when there is none', () => {
    const wrapped = wrapRule(defaultRules, 'actionKinds', 'drill', (drill) => ({
      ...drill,
      intervalMs: () => 42,
    }));
    expect(wrapped.actionKinds.drill?.intervalMs({} as never, 'x', {} as never, wrapped)).toBe(42);
    expect(defaultRules.actionKinds.drill?.intervalMs).not.toBe(
      wrapped.actionKinds.drill?.intervalMs,
    );
    expect(() => wrapRule(defaultRules, 'actionKinds', 'nothing', (k) => k)).toThrow(
      /no action kind/,
    );
    // `constructor` is a name of Object, not a kind.
    expect(() => wrapRule(defaultRules, 'actionKinds', 'constructor', (k) => k)).toThrow(
      /no action kind/,
    );
    const quiet = wrapRule(defaultRules, 'systems', 'quest', () => noop);
    expect(quiet.systems.at(-1)).toBe(noop);
    expect(() => wrapRule(defaultRules, 'systems', 'nothing', (s) => s)).toThrow(/no system/);
  });
});
