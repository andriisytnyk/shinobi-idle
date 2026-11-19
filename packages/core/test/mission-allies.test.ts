/** Allies in a mission's combat stage: the XP they earn is paid by the same route as in a normal fight, once. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, deserialize, dispatch, growSlots, serialize } from '../src/index.ts';
import { ableFor, mission, startMission } from './missions-helpers.ts';

const CLONE = 'core:shadow_clone';
const ENEMY = 'core:merc_pack';
const MISSION = 'core:caravan';
type State = ReturnType<typeof ableFor>;

const total = (s: State): number => Object.values(s.skills).reduce((n, k) => n + (k?.xp ?? 0), 0);
const sumOf = (r: Record<string, number>): number => Object.values(r).reduce((n, x) => n + x, 0);
const row = (): Record<string, number> => {
  const found = (content.balance.K.techFx as Record<string, Record<string, number>>).combatClone;
  if (!found) throw new Error('no row');
  return found;
};
const fightOf = (s: State, slot: number) =>
  slot === 0 ? s.combat?.fight : s.clones[slot]?.fight?.fight;
/**
 * The character's XP modifiers lift what is paid a little over the clock's figure (about 9% here), so the check is a
 * band that a payment made twice (about 2.2 times the figure) or not at all cannot fit.
 */
const expectPaidOnce = (paid: number, expected: number): void => {
  expect(expected).toBeGreaterThan(0);
  expect(paid / expected).toBeGreaterThan(1);
  expect(paid / expected).toBeLessThan(1.25);
};
const won = (s: State): boolean => (s.counters['missions.stage.combat'] ?? 0) > 0;

/** A character with combat clones in the loadout, on a mission whose first fight is the one of `ENEMY`. */
function withClones(): State {
  const state: State = ableFor(mission(MISSION));
  state.mastery[CLONE] = { xp: 0 } as never;
  expect(dispatch(state, { type: 'loadout.prepare', encounter: ENEMY }, content).ok).toBe(true);
  expect(startMission(state, MISSION).ok).toBe(true);
  return state;
}

/** A clone on the mission, with combat clones in its own loadout. */
function cloneRun(): State {
  const state: State = ableFor(mission(MISSION));
  state.mastery[CLONE] = { xp: 0 } as never;
  growSlots(state, content);
  expect(dispatch(state, { type: 'clone.create', items: {} }, content).ok).toBe(true);
  expect(dispatch(state, { type: 'loadout.prepare', encounter: ENEMY }, content).ok).toBe(true);
  expect(
    dispatch(state, { type: 'action.start', slot: 1, kind: 'mission', id: MISSION }, content).ok,
  ).toBe(true);
  return state;
}

/**
 * Runs the game until the combat stage is won and returns what the clock says the bodies earned and handed over: each
 * body's time alive, times the pace of the fight, the weights of combat XP and the two shares. Time is counted over steps
 * of 10 ms, as the bodies are seen at the start of each step.
 */
function expectedPay(state: State, r: Record<string, number>, slot = 0): number {
  let bodyMs = 0;
  let rate = 0;
  for (let i = 0; i < 2_000_000 && !won(state); i++) {
    const fight = fightOf(state, slot);
    const alive = (fight?.allies ?? []).filter((a) => a.hp > 0).length;
    const t = fight?.t ?? 0;
    advance(state, 10, content);
    if (fight && fightOf(state, slot) === fight) {
      bodyMs += alive * (fight.t - t);
      rate = fight.allyXpRate ?? rate;
    }
  }
  return (
    bodyMs *
    rate *
    sumOf(content.balance.K.combatXp as Record<string, number>) *
    (r.xpShare ?? 1) *
    (r.passShare ?? 1)
  );
}

/** Runs until the combat stage is won. */
function throughFight(state: State, step = 100): void {
  for (let i = 0; i < 200_000 && !won(state); i++) advance(state, step, content);
}

describe('allies of a mission combat stage', () => {
  it('earn combat XP by the clock and pay it to the character once, as in a fight', () => {
    const r = row();
    const old = { ...r };
    try {
      const pays = withClones();
      const expected = expectedPay(pays, r);
      expect(pays.counters['missions.stage.combat']).toBe(1);
      expect(pays.combat?.fight.tally.allyXp).toBeUndefined();
      r.passShare = 0;
      const none = withClones();
      throughFight(none);
      // The same game, but the bodies hand nothing over: the difference is what they earned, once.
      expectPaidOnce(total(pays) - total(none), expected);
    } finally {
      Object.assign(r, old);
    }
  });

  it('keeps the count across a save, and a fight saved without it loads', () => {
    const state = withClones();
    for (let i = 0; i < 60_000 && !state.combat?.fight.allies?.length; i++) {
      advance(state, 100, content);
    }
    expect(state.combat?.fight.allyXpRate).toBeGreaterThan(0);
    const copy = deserialize(serialize(state), content);
    expect(copy.combat?.fight.allyXpRate).toBe(state.combat?.fight.allyXpRate);
    expect(serialize(copy)).toBe(serialize(state));
    const raw = JSON.parse(serialize(state)) as {
      state: { combat: { fight: { allyXpRate?: number } } };
    };
    delete raw.state.combat.fight.allyXpRate;
    expect(deserialize(JSON.stringify(raw), content).combat).not.toBeNull();
  });

  it('keep earning in the fight that replaces one that timed out', () => {
    const state = withClones();
    for (let i = 0; i < 60_000 && !state.combat?.fight.allies?.length; i++) {
      advance(state, 100, content);
    }
    const old = state.combat?.fight;
    if (!old) throw new Error('no fight');
    const rate = old.allyXpRate ?? 0;
    expect(rate).toBeGreaterThan(0);
    // The time cap comes at once: the fight pays nothing and a new one starts, with the same mission support.
    old.cap = old.t + 1;
    for (let i = 0; i < 1_000 && state.combat?.fight === old; i++) advance(state, 100, content);
    const next = state.combat?.fight;
    expect(next).toBeDefined();
    expect(next).not.toBe(old);
    expect(next?.allyXpRate).toBe(rate);
    // The bodies of the new fight count their time: after a while they hold combat XP.
    for (let i = 0; i < 60_000 && !next?.allies?.length; i++) advance(state, 100, content);
    expect(next?.allies?.length).toBeGreaterThan(0);
    for (const a of next?.allies ?? []) expect(a.ally?.held?.xpAt).toBeDefined();
  });

  it("pay a clone's mission fight through the clone's pending knowledge, which its win pays", () => {
    const r = row();
    const old = { ...r };
    const dispelled = (state: State): State => {
      // The clone's win pays its held knowledge; the dispel hands it to the character.
      dispatch(state, { type: 'clone.dispel' }, content);
      return state;
    };
    try {
      const pays = cloneRun();
      const expected = expectedPay(pays, r, 1);
      dispelled(pays);
      expect(pays.counters['missions.stage.combat']).toBe(1);
      r.passShare = 0;
      const none = cloneRun();
      throughFight(none);
      dispelled(none);
      expectPaidOnce(total(pays) - total(none), expected);
    } finally {
      Object.assign(r, old);
    }
  });
});
