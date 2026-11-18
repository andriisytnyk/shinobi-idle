/**
 * Allies in a fight, PR #127 fix 2: no way for a fight to end loses what living allies hold, and an ally's
 * numbers come from the technique that summoned it.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  dealDamage,
  defaultRules,
  dispatch,
  growSlots,
  makeCtx,
  parseFight,
} from '../src/index.ts';
import { fighter, run, startFight } from './prep-state.ts';
import { sharesOf } from '../src/combat/fight-allies.ts';

const CLONE = 'core:shadow_clone';
type State = ReturnType<typeof fighter>;

const total = (s: State): number => Object.values(s.skills).reduce((n, k) => n + (k?.xp ?? 0), 0);
const sum = (r: Record<string, number> | undefined): number =>
  Object.values(r ?? {}).reduce((n, x) => n + x, 0);
const heldSum = (s: State): number =>
  (s.combat?.fight.allies ?? []).reduce((n, a) => n + sum(a.ally?.held?.xp), 0);

function cloned(seed = 2): State {
  const state = fighter(seed, 40);
  state.known[CLONE] = true;
  state.mastery[CLONE] = { xp: 0 } as never;
  run(state, { type: 'loadout.prepare', encounter: 'core:zone_foreign_genin' });
  startFight(state, 'core:zone_foreign_genin');
  for (let i = 0; i < 90 && !state.combat?.fight.allies?.length; i++) {
    advance(state, 1000, content);
  }
  for (let i = 0; i < 8; i++) advance(state, 1000, content);
  return state;
}

describe('stopping the fight pays what living allies hold', () => {
  it("the character's fight stopped mid-fight pays the held XP, once", () => {
    const state = cloned();
    const held = heldSum(state);
    expect(held).toBeGreaterThan(0);
    const before = total(state);
    run(state, { type: 'action.stop', slot: 0 });
    expect(state.combat).toBeNull();
    expect(total(state) - before).toBeGreaterThanOrEqual(held * 0.999);
    // Stopping again (nothing runs) pays nothing more.
    const after = total(state);
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    expect(total(state)).toBe(after);
  });

  it('pays a body that fell on the tick of the stop once, with the others', () => {
    const state = cloned();
    const fight = state.combat?.fight;
    const [first, ...rest] = fight?.allies ?? [];
    if (!fight || !first || rest.length === 0) throw new Error('need two bodies');
    const all = heldSum(state);
    dealDamage(makeCtx(fight, content, defaultRules), first, 1e12, 'test');
    const before = total(state);
    run(state, { type: 'action.stop', slot: 0 });
    const paid = total(state) - before;
    expect(paid).toBeGreaterThanOrEqual(all * 0.999);
    expect(paid).toBeLessThan(all * 1.05);
  });

  it('pays a body that fell a tick earlier at that tick, and only the others at the stop', () => {
    const state = cloned();
    const fight = state.combat?.fight;
    const first = fight?.allies?.[0];
    if (!fight || !first) throw new Error('no body');
    dealDamage(makeCtx(fight, content, defaultRules), first, 1e12, 'test');
    advance(state, 1000, content);
    const standing = heldSum(state);
    const before = total(state);
    run(state, { type: 'action.stop', slot: 0 });
    const paid = total(state) - before;
    expect(paid).toBeGreaterThanOrEqual(standing * 0.999);
    expect(paid).toBeLessThan(standing * 1.05);
  });

  it('a stop leaves the same skills however the time before it was split', () => {
    const one = cloned(3);
    const many = cloned(3);
    advance(one, 60_000, content);
    for (let i = 0; i < 60; i++) advance(many, 1000, content);
    run(one, { type: 'action.stop', slot: 0 });
    run(many, { type: 'action.stop', slot: 0 });
    expect(one.skills).toEqual(many.skills);
    expect(one.fatigue).toBe(many.fatigue);
  });

  it('a clone dispelled mid-fight hands over the XP its bodies hold', () => {
    const state = fighter(1, 40);
    state.known[CLONE] = true;
    state.mastery[CLONE] = { xp: 0 } as never;
    growSlots(state, content);
    expect(dispatch(state, { type: 'clone.create', items: {} }, content).ok).toBe(true);
    expect(startFight(state, 'core:zone_foreign_genin', 1)).toEqual({ ok: true });
    for (let i = 0; i < 40 && !state.clones[1]?.fight?.fight.allies?.length; i++) {
      advance(state, 1000, content);
    }
    for (let i = 0; i < 8; i++) advance(state, 1000, content);
    const fight = state.clones[1]?.fight;
    const bodies = (fight?.fight.allies ?? []).reduce((n, a) => n + sum(a.ally?.held?.xp), 0);
    const own = sum(fight?.pending?.xp);
    expect(bodies).toBeGreaterThan(0);
    dispatch(state, { type: 'clone.dispel' }, content);
    const ended = state.events.find((e) => e.type === 'cloneDispelled');
    if (ended?.type !== 'cloneDispelled') throw new Error('no dispel event');
    expect(sum(ended.xp)).toBeGreaterThanOrEqual((own + bodies) * 0.999);
  });
});

describe('an ally uses the numbers of the technique that summoned it', () => {
  const rows = content.balance.K.techFx as Record<string, Record<string, number>>;
  const tech = content.techniques.find((t) => t.id === CLONE);

  /** The clone technique reads a second row, `testSummon`, while the core row says something else. */
  function withRow<T>(own: Record<string, number>, core: Record<string, number>, f: () => T): T {
    const base = rows.combatClone;
    const effect = tech?.combat?.effect;
    if (!base || effect?.kind !== 'summon') throw new Error('no clone technique');
    const saved = { ...base };
    rows.testSummon = { ...base, ...own };
    Object.assign(base, core);
    effect.fx = 'testSummon';
    try {
      return f();
    } finally {
      effect.fx = 'combatClone';
      delete rows.testSummon;
      Object.assign(base, saved);
    }
  }

  const earned = (): { held: number; paid: number; fatigue: number } => {
    const state = cloned();
    const held = heldSum(state);
    const before = total(state);
    const tired = state.fatigue;
    run(state, { type: 'action.stop', slot: 0 });
    return { held, paid: total(state) - before, fatigue: state.fatigue - tired };
  };

  it('earns, passes and tires by its own row, not the core clone row', () => {
    const base = earned();
    expect(base.paid).toBeGreaterThan(0);
    expect(base.fatigue).toBeGreaterThan(0);
    const mod = withRow(
      { xpShare: 2, passShare: 0.5, fatigueShare: 0 },
      { xpShare: 0, passShare: 0, fatigueShare: 5 },
      earned,
    );
    // Twice the earnings while it lives, half of them passed on, and no fatigue.
    expect(mod.held).toBeGreaterThan(base.held * 1.5);
    // 2 x 0.5 = 1: what passes on is what the core row would have passed (the paid sum also has the game's own modifiers).
    expect(Math.abs(mod.paid / base.paid - 1)).toBeLessThan(0.01);
    expect(mod.paid).toBeLessThan(mod.held * 0.6);
    expect(mod.fatigue).toBe(0);
  });

  it('never lets a negative share make held XP negative, and the fight still parses', () => {
    withRow({ xpShare: -3, passShare: -1, fatigueShare: -1 }, {}, () => {
      const state = cloned();
      expect(heldSum(state)).toBe(0);
      const fight = state.combat?.fight;
      if (!fight) throw new Error('no fight');
      expect(parseFight(JSON.parse(JSON.stringify(fight)), content)).not.toBeNull();
      run(state, { type: 'action.stop', slot: 0 });
    });
  });

  it('gives the defaults to a body of a technique the content lacks, and clamps at 0', () => {
    expect(sharesOf(content, 'gone:technique')).toEqual({ xp: 1, pass: 1, fatigue: 1 });
    expect(sharesOf(content, CLONE)).toEqual({ xp: 1, pass: 1, fatigue: 1 });
    withRow({ xpShare: -3, passShare: -1, fatigueShare: -1 }, {}, () => {
      expect(sharesOf(content, CLONE)).toEqual({ xp: 0, pass: 0, fatigue: 0 });
    });
  });
});
