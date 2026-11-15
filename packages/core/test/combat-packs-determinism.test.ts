/**
 * T5: with a pack that adds fight vocabulary and a hook, the game stays deterministic and splits
 * time without a trace: the same seed gives the same bytes however the time is chunked, and a saved
 * game played on equals one played straight through.
 */
import { describe, expect, it } from 'vitest';
import {
  advance,
  createFight,
  createState,
  deserialize,
  dispatch,
  fightAdvance,
  serialize,
  teamFor,
  type GameState,
} from '../src/index.ts';
import { HOUR } from './helpers.ts';
import {
  TECH,
  caster,
  encounter,
  mod,
  modRules,
  player,
  sec,
  withAi,
} from './combat-packs-helpers.ts';

function game(seed: number, zone: string): GameState {
  const state = createState(seed, mod);
  state.player.rank = 'genin';
  state.player.natures = ['katon'];
  // The team follows the native nature, as in a played game (a load works it out).
  state.team = teamFor(mod, 'katon');
  for (const skill of mod.skills) {
    const s = state.skills[skill.id];
    if (s) s.xp = 30_000;
  }
  state.known[TECH] = true;
  const started = dispatch(
    state,
    { type: 'action.start', slot: 0, kind: 'fight', id: zone },
    mod,
    modRules,
  );
  if (!started.ok) throw new Error(`cannot start ${zone}: ${started.reason}`);
  return state;
}

const played = (state: GameState, total: number, chunk: number): string => {
  for (let t = 0; t < total; t += chunk) advance(state, Math.min(chunk, total - t), mod, modRules);
  return serialize(state, 0);
};

describe('a game with the test pack', () => {
  for (const zone of ['testmod:zone_shellback', 'testmod:zone_boss_shell']) {
    it(`plays ${zone} the same however the time is split`, () => {
      const whole = played(game(4, zone), HOUR, HOUR);
      for (const chunk of [1000, 7919, 60_000, 600_000]) {
        expect(played(game(4, zone), HOUR, chunk), `chunks of ${chunk} ms`).toBe(whole);
      }
    });

    it(`gives the same state again for the same seed on ${zone}, and another for another seed`, () => {
      const a = played(game(4, zone), HOUR, 60_000);
      expect(played(game(4, zone), HOUR, 60_000)).toBe(a);
      expect(played(game(5, zone), HOUR, 60_000)).not.toBe(a);
    });

    it(`plays on from a save of ${zone} as if it had not been saved`, () => {
      const straight = played(game(6, zone), 2 * HOUR, 60_000);
      const first = game(6, zone);
      played(first, HOUR, 60_000);
      const back = deserialize(serialize(first, 0), mod, modRules);
      expect(played(back, HOUR, 60_000)).toBe(straight);
    });
  }

  it('plays a fight with the pack hook, status and combo exactly the same in any split', () => {
    const rules = withAi(caster(TECH));
    const run = (chunk: number): string => {
      const fight = createFight(player([TECH]), encounter('testmod:boss_shell'), 9, mod, rules);
      const total = sec(120);
      for (let t = 0; t < total; t += chunk)
        fightAdvance(fight, Math.min(chunk, total - t), mod, rules);
      return JSON.stringify(fight);
    };
    const whole = run(sec(120));
    for (const chunk of [sec(1), sec(1) + 3, sec(7)]) expect(run(chunk)).toBe(whole);
  });
});
