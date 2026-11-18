/**
 * Allies in a fight earn by their own actions: each body accrues combat XP by its own style and Mastery by
 * its own casts, holds them, and hands them to the character once, when it falls or the fight ends.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, dealDamage, defaultRules, makeCtx } from '../src/index.ts';
import { fighter, run, startFight } from './prep-state.ts';

const CLONE = 'core:shadow_clone';
type State = ReturnType<typeof fighter>;

const total = (s: State): number => Object.values(s.skills).reduce((n, k) => n + (k?.xp ?? 0), 0);
const sum = (r: Record<string, number> | undefined): number =>
  Object.values(r ?? {}).reduce((n, x) => n + x, 0);
const held = (s: State, i = 0) => s.combat?.fight.allies?.[i]?.ally?.held;

/** A game with a fight in which the clones stand. */
function cloned(): State {
  const state = fighter(2, 40);
  state.known[CLONE] = true;
  state.mastery[CLONE] = { xp: 0 } as never;
  run(state, { type: 'loadout.prepare', encounter: 'core:zone_foreign_genin' });
  startFight(state, 'core:zone_foreign_genin');
  for (let i = 0; i < 90 && !state.combat?.fight.allies?.length; i++) {
    advance(state, 1000, content);
  }
  return state;
}

function run20(state: State): void {
  for (let i = 0; i < 8; i++) advance(state, 1000, content);
}

describe('each body earns by its own actions, and hands it over once', () => {
  it('accrues in the body, by the skill of what it did, and not in the tally while it lives', () => {
    const state = cloned();
    expect(state.combat?.fight.allies?.length).toBeGreaterThan(0);
    run20(state);
    const h = held(state);
    expect(sum(h?.xp)).toBeGreaterThan(0);
    expect(Object.keys(h?.xp ?? {}).length).toBeGreaterThan(0);
    expect(state.combat?.fight.tally.allyXp).toBeUndefined();
  });

  /** The same fight, the first body struck down after 8 s, and a second more for the game to pay. */
  function fallen(): { state: State; earned: number } {
    const state = cloned();
    run20(state);
    const fight = state.combat?.fight;
    const ally = fight?.allies?.[0];
    if (!fight || !ally) throw new Error('no ally');
    const earned = sum(ally.ally?.held?.xp);
    dealDamage(makeCtx(fight, content, defaultRules), ally, 1e12, 'test');
    advance(state, 1000, content);
    return { state, earned };
  }

  it('is held until the body falls, and then added once', () => {
    const { state, earned } = fallen();
    expect(earned).toBeGreaterThan(0);
    const ally = state.combat?.fight.allies?.[0];
    expect(sum(ally?.ally?.held?.xp)).toBe(0);
    expect(state.combat?.fight.tally.allyXp).toBeUndefined();
    // The same game without the fall of the body differs by what it handed over.
    const row = (content.balance.K.techFx as Record<string, Record<string, number>>).combatClone;
    if (!row) throw new Error('no row');
    const old = { ...row };
    try {
      row.passShare = 0;
      const none = fallen().state;
      expect(total(state) - total(none)).toBeGreaterThan(0);
      row.passShare = old.passShare ?? 1;
      row.xpShare = 0;
      const nothing = cloned();
      run20(nothing);
      expect(sum(held(nothing)?.xp)).toBe(0);
    } finally {
      Object.assign(row, old);
    }
  });

  it('leaves the style of the character to its own actions', () => {
    const state = cloned();
    run20(state);
    run20(state);
    expect(state.combat?.style).toBe(state.combat?.fight.tally.style);
  });
});
