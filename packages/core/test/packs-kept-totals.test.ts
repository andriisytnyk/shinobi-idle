/**
 * The totals kept while `advance` runs are never stale with a pack's rules: a system of a pack may write
 * what a core provider reads (here a tonic buff) without saying so, and the game must still give the
 * numbers it would give with every total asked afresh, however the time is cut.
 */
import { corePack, type ContentPack } from '@shinobi/content';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addRule,
  advance,
  composeRules,
  defaultRules,
  dispatch,
  serialize,
  type GameState,
  type Rules,
  type System,
} from '../src/index.ts';
import { verifyModCache } from '../src/modifiers.ts';
import { testmodPack, testmodRules } from '../src/testmod/index.ts';
import { HOUR, modContent, modGenin, setSkill, skillsOf } from './packs-helpers.ts';

const MIN = 60_000;
const PERIOD = 7 * MIN;

/** Hands the character a tonic buff on a timer: no event, no `touchMods`, and every core provider reads it. */
const granter: System = {
  id: 'testmod:granter',
  nextEventIn: (state) => PERIOD - (state.now % PERIOD),
  run(state) {
    if (state.now % PERIOD === 0)
      state.buffs['core:tonik_iasnoho_rozumu'] = { skill: 'med', charges: 3 };
  },
};

const pack: ContentPack = {
  ...testmodPack,
  rules: ((base: Rules) =>
    addRule(testmodRules(base), 'systems', granter)) as unknown as ContentPack['rules'],
};
const packRules = composeRules(defaultRules, [corePack, pack], modContent);

/** The same rules with the entries that the pack added left as they are but the core providers copied (so never kept). */
const unkept: Rules = {
  ...packRules,
  modifierProviders: packRules.modifierProviders.map(
    (p) =>
      (...a) =>
        p(...a),
  ),
};

function meditating(): GameState {
  const state = modGenin(3);
  setSkill(state, 'med', 20);
  const practice = modContent.practices[0]?.id ?? '';
  expect(
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'meditate', id: practice },
      modContent,
      packRules,
    ).ok,
  ).toBe(true);
  return state;
}

describe('kept modifier totals and the systems of a pack', () => {
  afterEach(() => verifyModCache(false));

  it('give the same state as asking the providers every time', () => {
    const kept = meditating();
    const asked = meditating();
    advance(kept, HOUR, modContent, packRules);
    advance(asked, HOUR, modContent, unkept);
    expect(serialize(kept)).toBe(serialize(asked));
    // The system did work: the tonic bonus was in the numbers.
    expect(skillsOf(kept)['med']?.xp).toBeGreaterThan(skillsOf(meditating())['med']?.xp ?? 0);
  });

  it('do not depend on how the time is cut', () => {
    const whole = meditating();
    const cut = meditating();
    advance(whole, HOUR, modContent, packRules);
    for (let i = 0; i < 60; i++) advance(cut, MIN, modContent, packRules);
    expect(serialize(cut)).toBe(serialize(whole));
  });

  it('are not found stale when every total is checked', () => {
    verifyModCache(true);
    expect(() => advance(meditating(), HOUR, modContent, packRules)).not.toThrow();
  });
});
