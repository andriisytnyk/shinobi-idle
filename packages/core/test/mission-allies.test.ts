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

/** A character with combat clones in the loadout, on a mission whose first fight is the one of `ENEMY`. */
function withClones(): State {
  const state: State = ableFor(mission(MISSION));
  state.mastery[CLONE] = { xp: 0 } as never;
  expect(dispatch(state, { type: 'loadout.prepare', encounter: ENEMY }, content).ok).toBe(true);
  expect(startMission(state, MISSION).ok).toBe(true);
  return state;
}

/** Runs until the combat stage's fight is won. */
function throughFight(state: State, step = 100): void {
  for (let i = 0; i < 200_000 && (state.counters['missions.stage.combat'] ?? 0) === 0; i++) {
    advance(state, step, content);
  }
}

describe('allies of a mission combat stage', () => {
  it('earn combat XP by the clock and pay it to the character once, as in a fight', () => {
    const row = (content.balance.K.techFx as Record<string, Record<string, number>>).combatClone;
    if (!row) throw new Error('no row');
    const old = { ...row };
    try {
      const pays = withClones();
      throughFight(pays);
      expect(pays.counters['missions.stage.combat']).toBe(1);
      expect(pays.combat?.fight.tally.allyXp).toBeUndefined();
      row.passShare = 0;
      const none = withClones();
      throughFight(none);
      // The same game, but the bodies hand nothing over: the difference is what they earned.
      expect(total(pays) - total(none)).toBeGreaterThan(0);
    } finally {
      Object.assign(row, old);
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

  it("pay a clone's mission fight through the clone's pending knowledge, which its win pays", () => {
    const row = (content.balance.K.techFx as Record<string, Record<string, number>>).combatClone;
    if (!row) throw new Error('no row');
    const old = { ...row };
    const cloneRun = (): State => {
      const state: State = ableFor(mission(MISSION));
      state.mastery[CLONE] = { xp: 0 } as never;
      growSlots(state, content);
      expect(dispatch(state, { type: 'clone.create', items: {} }, content).ok).toBe(true);
      expect(dispatch(state, { type: 'loadout.prepare', encounter: ENEMY }, content).ok).toBe(true);
      expect(
        dispatch(state, { type: 'action.start', slot: 1, kind: 'mission', id: MISSION }, content)
          .ok,
      ).toBe(true);
      for (let i = 0; i < 200_000 && (state.counters['missions.stage.combat'] ?? 0) === 0; i++) {
        advance(state, 100, content);
      }
      // The clone's win pays its held knowledge; the dispel hands it to the character.
      dispatch(state, { type: 'clone.dispel' }, content);
      return state;
    };
    try {
      const pays = cloneRun();
      expect(pays.counters['missions.stage.combat']).toBe(1);
      row.passShare = 0;
      const none = cloneRun();
      expect(total(pays) - total(none)).toBeGreaterThan(0);
    } finally {
      Object.assign(row, old);
    }
  });
});
