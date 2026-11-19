/**
 * A long offline return with shadow clones: a clone that stands, works or fights beside a 12 h fight,
 * and two long fights at once. The answers must not depend on the totals kept while `advance` runs,
 * nor on how the time is cut, and the whole must stay inside the A11 speed budget.
 */
import { content } from '@shinobi/content';
import { afterEach, describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  dispatch,
  growSlots,
  serialize,
  type GameState,
  type Rules,
} from '../src/index.ts';
import { markCacheable, verifyModCache } from '../src/modifiers.ts';
import { HOUR } from './helpers.ts';
import { fighter, ids, startFight, stock } from './prep-state.ts';
import { bestOf, speedBudget, speedIt } from './speed.ts';

const CLONE = 'core:shadow_clone';
const WOLF = 'core:zone_wolf';
const PRACTICE = content.practices[0]?.id ?? '';

/** The way a clone takes part in the window: it stands, practises, or fights a fight of its own. */
type Kind = 'alone' | 'standing' | 'practising' | 'two fights';
const KINDS: Kind[] = ['alone', 'standing', 'practising', 'two fights'];

/** A genin fighting in a zone, with a clone as `kind` says whose life lasts the whole window (as the dev tools set it). */
function scene(kind: Kind, seed = 5): GameState {
  const state = fighter(seed, 36);
  state.known[CLONE] = true;
  growSlots(state, content);
  stock(state, { [ids.heal]: 300 });
  state.events = [];
  startFight(state, WOLF, 0);
  if (kind === 'standing') dispatch(state, { type: 'clone.create' }, content);
  if (kind === 'practising')
    dispatch(state, { type: 'action.start', slot: 1, kind: 'meditate', id: PRACTICE }, content);
  if (kind === 'two fights') startFight(state, WOLF, 1);
  const body = state.clones[1];
  if (body) body.life = 1e30;
  return state;
}

/** The rules of the game with every provider a copy that the totals are not kept for. */
function unkept(): Rules {
  return {
    ...defaultRules,
    modifierProviders: defaultRules.modifierProviders.map(
      (p) =>
        (...a) =>
          p(...a),
    ),
  };
}

describe('the totals kept while advance runs', () => {
  afterEach(() => verifyModCache(false));

  for (const kind of KINDS) {
    it(`give the same state as asking the providers every time: ${kind}`, () => {
      const kept = scene(kind);
      const asked = scene(kind);
      advance(kept, 2 * HOUR, content);
      advance(asked, 2 * HOUR, content, unkept());
      expect(serialize(kept)).toBe(serialize(asked));
      expect(kept.clones[1] !== undefined).toBe(kind !== 'alone');
    }, 120_000);

    it(`do not depend on how the time is cut: ${kind}`, () => {
      const whole = scene(kind);
      const cut = scene(kind);
      advance(whole, HOUR, content);
      const chunks = [1, 999, 61_000, 7 * 60_000 + 13, 20 * 60_000];
      for (const ms of chunks) advance(cut, ms, content);
      advance(cut, HOUR - chunks.reduce((sum, ms) => sum + ms, 0), content);
      expect(serialize(cut)).toBe(serialize(whole));
    }, 120_000);
  }

  it('are worked out again at every use when asked to check, and agree', () => {
    verifyModCache(true);
    for (const kind of KINDS) advance(scene(kind), 30 * 60_000, content);
  }, 120_000);

  it('are checked: a provider that reads what nothing announces is caught', () => {
    verifyModCache(true);
    const secret = (state: GameState) => state.counters['test.secret'] ?? 0;
    const provider: Rules['modifierProviders'][number] = (state) => [
      { key: 'xp.all', op: 'add', value: secret(state) / 1000, group: 'character', source: 'test' },
    ];
    // A system that changes the number without saying so (no event, no touch).
    const rules: Rules = {
      ...defaultRules,
      modifierProviders: [...defaultRules.modifierProviders, provider],
      systems: [
        ...defaultRules.systems,
        {
          nextEventIn: () => 1000,
          elapse: (state, dt) => {
            state.counters['test.secret'] = (state.counters['test.secret'] ?? 0) + dt;
          },
          run: () => undefined,
        },
      ],
    };
    markCacheable(rules.modifierProviders);
    expect(() => advance(scene('alone'), 60_000, content, rules)).toThrow(/stale/);
  });

  it('are not kept for a provider that was not declared safe', () => {
    verifyModCache(true);
    const provider: Rules['modifierProviders'][number] = (state) => [
      {
        key: 'xp.all',
        op: 'add',
        value: (state.counters['test.secret'] ?? 0) / 1000,
        group: 'character',
        source: 'test',
      },
    ];
    const rules: Rules = {
      ...defaultRules,
      modifierProviders: [...defaultRules.modifierProviders, provider],
      systems: [
        ...defaultRules.systems,
        {
          nextEventIn: () => 1000,
          elapse: (state, dt) => {
            state.counters['test.secret'] = (state.counters['test.secret'] ?? 0) + dt;
          },
          run: () => undefined,
        },
      ],
    };
    // Not marked: every total is asked of the providers afresh, so nothing is stale.
    expect(() => advance(scene('alone'), 60_000, content, rules)).not.toThrow();
  });
});

describe('A11: speed with clones', () => {
  const play = (kind: Kind, limit: number): { ms: number; state: GameState } => {
    let state = scene(kind);
    const ms = bestOf(3, limit, () => {
      // Each run starts from a fresh state: advancing the same one again would play hours 12 to 24.
      state = scene(kind);
      advance(state, 12 * HOUR, content);
    });
    console.log(`A11: 12 h of zone fighting, ${kind}: ${ms.toFixed(0)} ms`);
    return { ms, state };
  };

  // A clone beside a fight costs little next to the fight: the time is held to the fight alone (the same
  // machine, the same minute) and to a ceiling stretched like the other A11 budgets.
  const beside = (kind: Kind, share: number): void => {
    const limit = speedBudget(4000, 16_000);
    const alone = play('alone', limit).ms;
    const { ms, state } = play(kind, limit);
    expect(state.clones[1]).toBeDefined();
    expect(ms).toBeLessThan(alone * share);
    expect(ms).toBeLessThan(limit);
  };

  speedIt(
    'plays 12 h of a fight with a standing clone beside it as fast as the fight alone',
    () => {
      beside('standing', 1.35);
    },
  );

  speedIt(
    'plays 12 h of a fight with a clone that practises beside it as fast as the fight alone',
    () => {
      beside('practising', 1.5);
    },
  );

  speedIt('plays 12 h of two fights at once in about twice the time of one', () => {
    const limit = speedBudget(6500, 26_000);
    const alone = play('alone', speedBudget(4000, 16_000)).ms;
    const { ms, state } = play('two fights', limit);
    expect(state.clones[1]?.fight).not.toBeNull();
    // Two fights are two times the work of one.
    expect(ms).toBeLessThan(alone * 2.6);
    expect(ms).toBeLessThan(limit);
  });
});
