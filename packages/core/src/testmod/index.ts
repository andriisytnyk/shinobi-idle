/**
 * The behaviour of the `testmod` test pack, and the pack with it attached. It lives in the core
 * package because a pack's `rules` function is typed by `Rules`, which the content package cannot
 * import; it is exported only through `@shinobi/core/testmod`, so the app never bundles it by default.
 *
 * What it does, with no line of it known to the engine: a system that pays one test token every
 * ten game minutes, and a wrap of the core drill action that makes its cycle ten percent longer.
 */
import { testmodPack as data } from '@shinobi/content/testmod';
import type { ContentPack } from '@shinobi/content';
import type { FightHook } from '../combat/fight-types.ts';
import { addRule, wrapRule, type Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { System } from '../system.ts';

/** The currency the pack adds and its system pays. */
export const TOKEN = 'testmod:token';
/** The counter that holds how many token ticks have been paid. */
export const TOKEN_TICKS = 'ticks.testmod:token';
/** Game time between two token payments, in ms. */
export const TOKEN_PERIOD_MS = 600_000;

/** The length the wrapped drill keeps, as a factor of its cycle. */
export const DRILL_FACTOR = 1.1;

/** The game time at which the pack was attached to the state. */
const attachedAt = (state: GameState): number =>
  state.packs.find((p) => p.id === 'testmod')?.since ?? 0;

/**
 * Pays one token per period of game time. The payments are counted in `state.counters`, never from
 * the clock alone, so a run that is split anywhere pays the same and a system that fires twice at one
 * instant pays once. A save that has no count yet starts counting from now: no back pay.
 */
const tokenSystem: System = {
  id: 'testmod:tokens',
  nextEventIn(state) {
    if (!Object.hasOwn(state.currencies, TOKEN)) return null;
    const since = attachedAt(state);
    const paid = state.counters[TOKEN_TICKS];
    if (paid === undefined) return 0;
    const due = Math.floor((state.now - since) / TOKEN_PERIOD_MS);
    return Math.max(0, since + (Math.min(paid, due) + 1) * TOKEN_PERIOD_MS - state.now);
  },
  run(state) {
    if (!Object.hasOwn(state.currencies, TOKEN)) return;
    // Payments count from the moment the pack was attached; a count kept from an earlier stay is cut.
    const due = Math.floor((state.now - attachedAt(state)) / TOKEN_PERIOD_MS);
    const paid = state.counters[TOKEN_TICKS];
    if (paid === undefined || paid > due) {
      state.counters[TOKEN_TICKS] = due;
      return;
    }
    if (due <= paid) return;
    state.currencies[TOKEN] = (state.currencies[TOKEN] ?? 0) + (due - paid);
    state.counters[TOKEN_TICKS] = due;
  },
};

/**
 * The hook of the test boss: every third basic attack of the body is a heavy one (its damage times
 * `K.bossFx['testmod:third'].mult`). It is registered with the other fight hooks and the pack is
 * recorded as its owner, so a failure of it is contained and names the pack.
 */
const thirdStrike: FightHook = {
  id: 'testmod:thirdStrike',
  onAttack(ctx, c, plan) {
    const n = (c.data['testmod.attacks'] ?? 0) + 1;
    c.data['testmod.attacks'] = n;
    if (n % 3 === 0) {
      plan.damage *=
        (ctx.content.balance.K.bossFx as Record<string, Record<string, number> | undefined>)[
          'testmod:third'
        ]?.mult ?? 1;
      // The heavy blow carries the interrupt: it breaks the cast of whoever it hits.
      plan.interrupts = true;
    }
  },
};

/** The rules function of the pack: one added system and one wrapped action kind of the core pack. */
export function testmodRules(base: Rules): Rules {
  const withSystem: Rules = {
    ...addRule(base, 'systems', tokenSystem),
    fightHooks: [...base.fightHooks, thirdStrike],
  };
  return wrapRule(withSystem, 'actionKinds', 'drill', (drill) => ({
    ...drill,
    intervalMs: (state, id, content, rules, slot) =>
      Math.max(1, Math.round(drill.intervalMs(state, id, content, rules, slot) * DRILL_FACTOR)),
  }));
}

/** The test pack with its rules attached: what a game composed with the pack passes to `composeRules`. */
export const testmodPack: ContentPack = {
  ...data,
  rules: testmodRules as unknown as ContentPack['rules'],
};
