/**
 * Hooks of other packs cannot stop the engine (a throw, a timer that never settles), the order the
 * hooks are registered in does not matter, and every time of a fight stays a whole number whatever
 * factors the data puts on it.
 */
import { content as core, type ContentDb } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createFight,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  fightAdvance,
  parseFight,
  tagOrigin,
  serialize,
  validateHooks,
  workOf,
  type Encounter,
  type FightHook,
  type FightState,
  type Rules,
} from '../src/index.ts';
import {
  TECH,
  caster,
  encounter,
  mod,
  modRules,
  player,
  quiet,
  sec,
  withAi,
} from './combat-packs-helpers.ts';
import { enemyAt, scripted } from './fight-helpers.ts';
import { fighter, startFight } from './prep-state.ts';

/** The core rules with hooks added the way `composeRules` adds a pack's: recorded as the pack's, from the prefix of the id. */
const rulesWith = (...hooks: FightHook[]): Rules => ({
  ...defaultRules,
  fightHooks: [
    ...defaultRules.fightHooks,
    ...hooks.map((h) => (h.id.startsWith('core:') ? h : tagOrigin(h, h.id.split(':')[0] ?? 'x'))),
  ],
});

/** An encounter against a bandit that carries the hook as an encounter-wide special. */
const withHook = (id: string): Encounter => ({ ...enemyAt(10), specials: [id] });

const evil = (over: Partial<FightHook>): FightHook => ({ id: 'evil:hook', ...over });

function play(hook: FightHook, seconds = 60): FightState {
  const rules = rulesWith(hook);
  const fight = createFight(scripted(['core:dynamic_entry']), withHook(hook.id), 1, core, rules);
  fightAdvance(fight, sec(seconds), core, rules);
  return fight;
}

describe('a hook of another pack that fails', () => {
  const throwing: [string, Partial<FightHook>][] = [
    [
      'init',
      {
        init: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'publish',
      {
        publish: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'stat',
      {
        stat: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'onAttack',
      {
        onAttack: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'onDamaged',
      {
        onDamaged: () => {
          throw new Error('boom');
        },
      },
    ],
    [
      'onTimer',
      {
        init: (_c, b) => {
          b.timers.evil = { progress: 0, need: 1_000_000 };
        },
        onTimer: () => {
          throw new Error('boom');
        },
      },
    ],
  ];
  for (const [name, over] of throwing) {
    it(`ends the fight as void when ${name} throws, and names the pack and the hook`, () => {
      const hook = evil({ id: `evil:${name}`, ...over });
      const fight = play(hook);
      expect(fight.result).toBe('void');
      expect(fight.fault).toEqual({ pack: 'evil', hook: `evil:${name}` });
    });
  }

  it('ends the fight as void when onDeath throws', () => {
    const hook = evil({
      id: 'evil:death',
      onDeath: () => {
        throw new Error('boom');
      },
    });
    const rules = rulesWith(hook);
    const fight = createFight(scripted(['core:dynamic_entry']), withHook(hook.id), 1, core, rules);
    for (const e of fight.enemies) e.hp = 1;
    fightAdvance(fight, sec(60), core, rules);
    expect(fight.result).toBe('void');
    expect(fight.fault?.hook).toBe('evil:death');
  });

  for (const [name, need] of [
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
  ] as const) {
    it(`treats a timer re-armed with a ${name} size as a failure of the hook`, () => {
      const hook = evil({
        id: `evil:timer-${name}`,
        init: (_c, b) => {
          b.timers.evil = { progress: 0, need: 1_000_000 };
        },
        onTimer: (_c, b, timer) => {
          const t = b.timers[timer];
          if (t) t.need = need;
        },
      });
      const fight = play(hook);
      expect(fight.result).toBe('void');
      expect(fight.fault?.hook).toBe(hook.id);
    });
  }

  it('treats a timer that fires without end within one moment as a failure of the hook', () => {
    const hook = evil({
      id: 'evil:flood',
      init: (_c, b) => {
        b.timers.evil = { progress: 1e12, need: 1_000_000 };
      },
    });
    const fight = play(hook, 1);
    expect(fight.result).toBe('void');
  });

  it('is switched off afterwards: the next fight with the same rules plays', () => {
    const hook = evil({
      id: 'evil:once',
      init: () => {
        throw new Error('boom');
      },
    });
    const rules = rulesWith(hook);
    const run = () => {
      const fight = createFight(
        scripted(['core:dynamic_entry']),
        withHook(hook.id),
        1,
        core,
        rules,
      );
      fightAdvance(fight, sec(30), core, rules);
      return fight.result;
    };
    expect(run()).toBe('void');
    expect(run()).not.toBe('void');
  });

  it('is loud for a hook of the core pack', () => {
    const hook = evil({
      id: 'core:loud',
      init: () => {
        throw new Error('boom');
      },
    });
    expect(() => play(hook)).toThrow('boom');
  });

  it('voids the fight of a game, pays nothing, and the game goes on and reloads', () => {
    const bandit = core.enemies.find((e) => e.traits.includes('armor'));
    if (!bandit) throw new Error('no armoured enemy');
    // The content says the armour trait is run by a hook that a pack registered and that fails.
    const broken: ContentDb = {
      ...core,
      traits: core.traits.map((t) => (t.id === 'armor' ? { ...t, hook: 'evil:armor' } : t)),
    };
    const rules = rulesWith(
      evil({
        id: 'evil:armor',
        init: () => {
          throw new Error('boom');
        },
      }),
    );
    const state = fighter(3, Math.min(40, bandit.cl + 5), 'katon');
    const zone = broken.zones.find((z) => z.enemy === bandit.id);
    if (!zone) throw new Error('no zone');
    expect(
      dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: zone.id }, broken, rules)
        .ok,
    ).toBe(true);
    const wounds = state.wounds.stacks;
    expect(() => advance(state, 5 * 60_000, broken, rules)).not.toThrow();
    const voided = state.events.filter((e) => e.type === 'ruleDisabled');
    expect(voided.length).toBeGreaterThan(0);
    expect(voided[0]).toMatchObject({ pack: 'evil', hook: 'evil:armor' });
    expect(state.wounds.stacks).toBe(wounds);
    const back = deserialize(serialize(state, 0), broken, rules);
    expect(() => advance(back, 5 * 60_000, broken, rules)).not.toThrow();
    void startFight;
  });

  it('is found by the check of hook names when the content names a hook no pack registers', () => {
    expect(validateHooks(core, defaultRules)).toEqual([]);
    const missing = validateHooks(mod, defaultRules);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ pack: 'testmod' });
    expect(validateHooks(mod, modRules)).toEqual([]);
  });
});

describe('the order of the hooks', () => {
  /** A special that makes the Illusionist cast much faster: it publishes the number the trait reads. */
  const strong = (): FightHook => ({
    id: 'test:strong',
    publish(_ctx, c) {
      if (c.data['illusionist.everyMs'] === undefined) c.data['illusionist.everyMs'] = 1500;
    },
  });
  const illusions = (hooks: FightHook[]): number => {
    const rules: Rules = { ...defaultRules, fightHooks: hooks };
    const levels = { med: 1 };
    const enc: Encounter = { ...enemyAt(10, ['illusionist']), specials: ['test:strong'] };
    const fight = createFight(scripted([], levels), enc, 1, core, rules);
    quiet(fight);
    fightAdvance(fight, sec(60), core, rules);
    return fight.tally.statuses.illusion ?? 0;
  };

  it('does not matter: a special that strengthens a trait works registered first or last', () => {
    const base = [...defaultRules.fightHooks];
    const first = illusions([strong(), ...base]);
    const last = illusions([...base, strong()]);
    const none = illusions(base);
    expect(first).toBe(last);
    expect(first).toBeGreaterThan(none);
  });
});

describe('integer time', () => {
  const walk = (value: unknown, path: string, bad: string[]): void => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, bad));
    else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (
          typeof v === 'number' &&
          /^(t|cap|poolAt|until|next|every|wardUntil|decoyUntil|progress|need)$/.test(k) &&
          !Number.isInteger(v)
        ) {
          bad.push(`${path}.${k}=${v}`);
        }
        if (k === 'cd' && v !== null && typeof v === 'object') {
          for (const [id, n] of Object.entries(v))
            if (!Number.isInteger(n)) bad.push(`${path}.cd.${id}=${String(n)}`);
        }
        walk(v, `${path}.${k}`, bad);
      }
    }
  };

  const variant = (factor: number, chill: number): ContentDb => {
    const K = mod.balance.K;
    return {
      ...mod,
      combos: mod.combos.map((c) =>
        (c.id as string) === 'testmod:frostburn'
          ? { ...c, effect: { kind: 'lengthen' as const } }
          : c,
      ),
      balance: {
        ...mod.balance,
        K: {
          ...K,
          combo: { ...K.combo, ['testmod:frostburn' as 'steam']: factor },
          ext: { ...K.ext, testmod: { ...K.ext?.testmod, chillSecs: chill } },
        },
      },
    };
  };

  for (const [factor, chill] of [
    [1.1, 7],
    [1 / 3, 6.1],
    [0.07, 5.5],
    [2.5, 1 / 3],
  ] as const) {
    it(`keeps every time a whole number with the factor ${factor.toFixed(3)} and reads back`, () => {
      const c = variant(factor, chill);
      const rules = withAi(caster(TECH));
      const fight = createFight(player([TECH], c), encounter('testmod:shellback', c), 4, c, rules);
      quiet(fight);
      for (const e of fight.enemies) e.timer.need = 1e15;
      fightAdvance(fight, workOf(90_000), c, rules);
      expect(fight.tally.uses[TECH] ?? 0).toBeGreaterThan(1);
      const bad: string[] = [];
      walk(JSON.parse(JSON.stringify(fight)), 'fight', bad);
      expect(bad).toEqual([]);
      expect(parseFight(JSON.parse(JSON.stringify(fight)), c)).not.toBeNull();
    });
  }

  it('is not asked of a game of the core pack', () => {
    expect(createState(1, core)).toBeDefined();
  });
});
