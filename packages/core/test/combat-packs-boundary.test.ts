/**
 * The boundary of the hooks of other packs: what they return, what they leave in a body, how small a
 * timer they arm and how often they run, the analysis kept apart from the live game, and the shape of
 * the rules a pack hands over. A hook that misbehaves by mistake must not crash, hang or corrupt a
 * fight; the failure is named and the game goes on.
 */
import { content as core, corePack, type ContentDb } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  analyzeFight,
  applyItem,
  composeGame,
  createFight,
  defaultRules,
  deserialize,
  dispatch,
  disabledCount,
  fightAdvance,
  makeCtx,
  serialize,
  tagOrigin,
  workOf,
  type Effect,
  type Encounter,
  type FightHook,
  type Rules,
} from '../src/index.ts';
import { testmodPack } from '../src/testmod/index.ts';
import { enemyAt, scripted, sec } from './fight-helpers.ts';
import { core as plain, mod, modRules } from './combat-packs-helpers.ts';
import { fighter } from './prep-state.ts';

const rulesWith = (...hooks: FightHook[]): Rules => ({
  ...defaultRules,
  fightHooks: [
    ...defaultRules.fightHooks,
    ...hooks.map((h) => tagOrigin(h, h.id.split(':')[0] ?? 'x')),
  ],
});
const withHook = (id: string): Encounter => ({ ...enemyAt(10), specials: [id] });
const play = (hook: FightHook, seconds = 60) => {
  const rules = rulesWith(hook);
  const fight = createFight(scripted(['core:dynamic_entry']), withHook(hook.id), 1, core, rules);
  fightAdvance(fight, sec(seconds), core, rules);
  return fight;
};
const boom = (): never => {
  throw new Error('boom');
};
/** Sets a raw structure into the combatant, the way a careless hook would. */
const raw = (c: { timers: unknown }, name: string, value: unknown) => {
  (c.timers as Record<string, unknown>)[name] = value;
};

describe('a timer that a hook arms', () => {
  for (const need of [1.5, 1000, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`fails the hook when its size is ${String(need)}, at once and without a hang`, () => {
      const hook: FightHook = {
        id: `evil:t${String(need)}`,
        init: (_c, b) => raw(b, 'evil', { progress: 0, need }),
      };
      const t0 = performance.now();
      const fight = play(hook, 300);
      expect(fight.result).toBe('void');
      expect(fight.fault?.hook).toBe(hook.id);
      // The same fight without the pack takes about as long; the abusive one must not take longer than three times that.
      const t1 = performance.now();
      const rules = rulesWith();
      const clean = createFight(scripted(['core:dynamic_entry']), enemyAt(10), 1, core, rules);
      fightAdvance(clean, sec(300), core, rules);
      const cleanMs = performance.now() - t1;
      expect(t1 - t0).toBeLessThan(3 * cleanMs + 50);
    });
  }

  it('is named as the owner of a stall: the hook that armed the timer, not the last one that ran', () => {
    const floor = workOf(core.balance.K.combat.timerMinMs) * 1000;
    const flood: FightHook = {
      id: 'evil:flood',
      init: (_c, b) => raw(b, 'evil', { progress: floor * 5000, need: floor }),
      onTimer: () => undefined,
    };
    const bystander: FightHook = { id: 'other:bystander', onAttack: () => undefined };
    const rules = rulesWith(flood, bystander);
    const enc: Encounter = { ...enemyAt(10), specials: [flood.id, bystander.id] };
    const fight = createFight(scripted(['core:dynamic_entry']), enc, 1, core, rules);
    fightAdvance(fight, sec(30), core, rules);
    expect(fight.result).toBe('void');
    expect(fight.fault?.hook).toBe('evil:flood');
  });

  it('is held to the budget of events a hook may have in one fight second', () => {
    const floor = workOf(core.balance.K.combat.timerMinMs) * 1000;
    const budget = core.balance.K.combat.hookEventsPerSec;
    const busy: FightHook = {
      id: 'evil:busy',
      init: (_c, b) => raw(b, 'evil', { progress: floor * (budget + 50), need: floor }),
      onTimer: () => undefined,
    };
    const fight = play(busy, 30);
    expect(fight.result).toBe('void');
    expect(fight.fault?.reason).toContain('budget');
  });
});

describe('what a hook leaves in a body', () => {
  it('fails the hook that writes a raw number as a timer, and the fight plays on afterwards and after a reload', () => {
    const hook: FightHook = { id: 'evil:raw', init: (_c, b) => raw(b, 'zz', 5) };
    const rules = rulesWith(hook);
    const first = createFight(scripted(['core:dynamic_entry']), withHook(hook.id), 1, core, rules);
    fightAdvance(first, sec(60), core, rules);
    expect(first.result).toBe('void');
    expect((first.enemies[0]?.timers as Record<string, unknown>).zz).toBeUndefined();
    // The same rules, hook now off: a new fight with it runs.
    const again = createFight(scripted(['core:dynamic_entry']), withHook(hook.id), 2, core, rules);
    fightAdvance(again, sec(20), core, rules);
    expect(again.result).not.toBe('void');
  });

  it('fails the hook that leaves a wrong effect or a number that is not finite in the body', () => {
    const effect: FightHook = {
      id: 'evil:effect',
      init: (_c, b) => {
        b.effects.push({ id: 'x', kind: 'nope' } as unknown as Effect);
      },
    };
    expect(play(effect).result).toBe('void');
    const data: FightHook = {
      id: 'evil:data',
      init: (_c, b) => {
        b.data.thing = Number.NaN;
      },
    };
    expect(play(data).result).toBe('void');
  });
});

describe('what a hook returns', () => {
  const stat = (value: unknown): FightHook => ({
    id: `evil:stat-${String(value)}`,
    stat: () => value as number,
  });
  for (const value of [Number.NaN, -1, 'x', 1e9, Number.POSITIVE_INFINITY]) {
    it(`fails the hook whose stat is ${String(value)}`, () => {
      const fight = play(stat(value));
      expect(fight.result).toBe('void');
    });
  }
  it('fails the hook whose castInfo is not the documented object', () => {
    const hook: FightHook = {
      id: 'evil:cast',
      castInfo: () => ({ kind: 5 }) as never,
    };
    // The view asks for it when the player has to choose.
    expect(play(hook).result).toBe('void');
  });
  it('fails the hook whose attack plan it spoils', () => {
    const hook: FightHook = {
      id: 'evil:plan',
      onAttack: (_ctx, _c, plan) => {
        plan.damage = Number.NaN;
      },
    };
    expect(play(hook).result).toBe('void');
  });
  it('fails a hook whose working throws', () => {
    const broken: ContentDb = {
      ...core,
      traits: core.traits.map((t) => (t.id === 'armor' ? { ...t, hook: 'evil:working' } : t)),
    };
    const hook: FightHook = { id: 'evil:working', working: boom };
    const rules = rulesWith(hook);
    const enc = enemyAt(10, ['armor']);
    const fight = createFight(scripted(['core:dynamic_entry']), enc, 1, broken, rules);
    fightAdvance(fight, sec(30), broken, rules);
    expect(fight.result).toBe('void');
    expect(fight.fault?.hook).toBe('evil:working');
  });
});

describe('a fault is the fault of the entry that was registered', () => {
  it('does not switch off a core hook that shares its id with a pack hook', () => {
    const rules = rulesWith({ id: 'special:twins', init: boom } as FightHook);
    const fight = createFight(scripted([]), withHook('special:twins'), 1, core, rules);
    fightAdvance(fight, sec(5), core, rules);
    expect(disabledCount(rules.fightHooks)).toBe(1);
    // The core hook of that id is still among the hooks of a body.
    const core2 = defaultRules.fightHooks.find((h) => h.id === 'special:twins');
    expect(core2).toBeDefined();
  });
});

describe('the battle analysis is detached from the live game', () => {
  it('switches off nothing in the live rules and says it was cut short', () => {
    const bandit = core.enemies.find((e) => e.traits.includes('armor'));
    if (!bandit) throw new Error('no armoured enemy');
    const broken: ContentDb = {
      ...core,
      traits: core.traits.map((t) => (t.id === 'armor' ? { ...t, hook: 'evil:armor' } : t)),
    };
    const rules = rulesWith({ id: 'evil:armor', init: boom } as FightHook);
    const zone = broken.zones.find((z) => z.enemy === bandit.id);
    if (!zone) throw new Error('no zone');
    const state = fighter(3, Math.min(40, bandit.cl + 5), 'katon');
    const result = analyzeFight(
      state,
      { kind: 'zone', id: zone.id },
      { seed: 2, samples: 8, minSessions: 2, maxSessions: 2 },
      broken,
      rules,
    );
    expect(result?.voided).toBeGreaterThan(0);
    expect(disabledCount(rules.fightHooks)).toBe(0);
    expect(state.events.filter((e) => e.type === 'ruleDisabled')).toEqual([]);
    // The live fight still runs the hook, and it fails there, as it should.
    expect(
      dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: zone.id }, broken, rules)
        .ok,
    ).toBe(true);
    advance(state, 60_000, broken, rules);
    expect(state.events.some((e) => e.type === 'ruleDisabled')).toBe(true);
  });
});

describe('the rules a pack hands over', () => {
  const packWith = (fightHooks: unknown) => ({
    ...testmodPack,
    rules: ((base: Rules) => ({ ...base, fightHooks })) as unknown as typeof testmodPack.rules,
  });
  for (const [name, value] of [
    ['a null entry', [null]],
    ['a number', [5]],
    ['not a list', 'nope'],
    ['an entry without an id', [{ init: () => undefined }]],
    ['a member that is not a function', [{ id: 'testmod:x', init: 5 }]],
  ] as const) {
    it(`leaves the pack out with its name when fightHooks holds ${name}`, () => {
      const game = composeGame([corePack, packWith(value)]);
      expect(game.failed[0]?.pack).toBe('testmod');
      expect(game.content.packs.map((p) => p.id)).toEqual(['core']);
    });
  }
  it('rejects a fight hook registered under the id of another entry', () => {
    const hooks = [...defaultRules.fightHooks, { id: 'special:twins' }];
    const game = composeGame([corePack, packWith(hooks)]);
    expect(game.failed[0]?.error).toContain('registered twice');
  });
  it('rejects a system, an action kind and a provider of the wrong shape', () => {
    const wrong = (patch: Partial<Record<keyof Rules, unknown>>) =>
      composeGame([
        corePack,
        {
          ...testmodPack,
          rules: ((base: Rules) => ({ ...base, ...patch })) as unknown as typeof testmodPack.rules,
        },
      ]).failed[0]?.pack;
    expect(wrong({ systems: [null] })).toBe('testmod');
    expect(wrong({ actionKinds: { x: 5 } })).toBe('testmod');
    expect(wrong({ modifierProviders: [5] })).toBe('testmod');
    expect(wrong({ combatAi: 5 })).toBe('testmod');
  });
});

describe('the sleeping powder replaces a stun, as the data says', () => {
  it('shortens a stun that is longer, where a stronger stun would keep it', () => {
    for (let seed = 1; seed < 200; seed++) {
      const fight = createFight(scripted([]), enemyAt(10), seed, plain, defaultRules);
      const body = fight.enemies[0];
      if (!body) throw new Error('no body');
      const long = fight.t + workOf(120_000);
      body.effects.push({
        kind: 'modifier',
        id: 'stun',
        src: 'test',
        until: long,
        stat: 'speed',
        op: 'mul',
        value: 0,
      });
      applyItem(makeCtx(fight, plain, defaultRules), 'core:sonnyi_poroshok');
      const stun = body.effects.find((e) => e.id === 'stun');
      if (stun?.src === 'core:sonnyi_poroshok') {
        expect(stun.until).toBeLessThan(long);
        return;
      }
    }
    throw new Error('the powder never took');
  });
});

describe('the pack comes back with its report', () => {
  it('keeps the report of a pack target while the pack is away and gives it back', () => {
    const state = deserialize(
      serialize(
        (() => {
          const s = fighter(5, 5, 'katon');
          return s;
        })(),
        0,
      ),
      mod,
      modRules,
    );
    state.report['testmod:shellback'] = {
      fights: 3,
      wins: 2,
      losses: 1,
      timeouts: 0,
      winMs: 1000,
      allMs: 2000,
      damage: {},
      uses: {},
      statuses: { 'testmod:crackBreak': 2 },
      combos: {},
      basic: 1,
      interrupts: 0,
      taken: 5,
      habLow: {},
    } as never;
    const away = deserialize(serialize(state, 0), plain, defaultRules);
    expect(Object.keys(away.report)).not.toContain('testmod:shellback');
    const back = deserialize(serialize(away, 0), mod, modRules);
    expect(Object.keys(back.report)).toContain('testmod:shellback');
  });
});
