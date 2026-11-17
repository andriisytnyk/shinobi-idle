/** Every performer is a separate figure on the map: position, survey range and travel follow the action slot. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  AUTOSURVEY_ID,
  AUTOSURVEY_KIND,
  autoPlan,
  deserialize,
  dispatch,
  EXPLORE_KIND,
  hexDistance,
  hexInfo,
  hexKey,
  hexOfAddress,
  positionHex,
  positionOf,
  rangeNow,
  serialize,
  surveyAccess,
  travelPlan,
  type Command,
  type GameState,
} from '../src/index.ts';
import { genin } from './helpers.ts';

const MIN = 60_000;

/** The character and one more performer, two slots at full speed each (what a shadow clone will add). */
function twoSlots(): GameState {
  const state = genin(1);
  state.slots.push({ action: null, progress: 0, share: 1000, data: null });
  return state;
}

const keyOf = (address: string): string => {
  const h = hexOfAddress(content, address);
  return h ? hexKey(h.q, h.r) : '';
};

describe('performers on the map', () => {
  const HOME = 'core:okolytsi_sela';
  const FAR = 'core:prykordonnyi_lis_okolytsia';

  it('reads the position by slot: slot 0 is the character, another slot falls back to the character', () => {
    const state = twoSlots();
    expect(positionOf(state, 0)).toBe(HOME);
    expect(positionOf(state, 1)).toBe(HOME);
    state.world.figures = { 1: FAR };
    expect(positionOf(state, 1)).toBe(FAR);
    expect(positionOf(state, 0)).toBe(HOME);
    expect(keyOf(FAR)).not.toBe(keyOf(HOME));
  });

  it('measures the survey range from the position of the slot that surveys', () => {
    const state = twoSlots();
    state.world.figures = { 1: FAR };
    const home = positionHex(state, content, 0);
    const far = positionHex(state, content, 1);
    expect(home && far && hexDistance(home, far)).toBeGreaterThan(0);
    // A hex within range of the clone and out of range of the character, and the other way round.
    const range = rangeNow(state, content, 0);
    expect(rangeNow(state, content, 1)).toBe(range);
    const near = (a: typeof home, b: typeof far) =>
      content.hexes.filter(
        (h) =>
          h.terrain !== undefined &&
          a &&
          b &&
          hexDistance(a, h) <= range &&
          hexDistance(b, h) > range,
      );
    const onlyCharacter = near(home, far)[0];
    const onlyClone = near(far, home)[0];
    expect(onlyCharacter).toBeDefined();
    expect(onlyClone).toBeDefined();
    if (!onlyCharacter || !onlyClone) return;
    expect(surveyAccess(state, content, onlyCharacter, undefined, 0)).not.toBe('outOfRange');
    expect(surveyAccess(state, content, onlyCharacter, undefined, 1)).toBe('outOfRange');
    expect(surveyAccess(state, content, onlyClone, undefined, 1)).not.toBe('outOfRange');
    expect(surveyAccess(state, content, onlyClone, undefined, 0)).toBe('outOfRange');
    expect(
      hexInfo(state, hexKey(onlyClone.q, onlyClone.r), content, undefined, undefined, 1)?.inRange,
    ).toBe(surveyAccess(state, content, onlyClone, undefined, 1) === 'ok');
  });

  it('moves only the performer whose slot walks, and leaves the other where it stands', () => {
    const state = twoSlots();
    state.world.figures = { 1: HOME };
    const command: Command = { type: 'world.travel', cell: 'core:rysovi_polia', slot: 1 };
    expect(travelPlan(state, 'core:rysovi_polia', content, undefined, 1).blocked).toBeNull();
    expect(dispatch(state, command, content)).toEqual({ ok: true });
    // On the way the clone stands on its own hex; the character stays at home.
    for (let i = 0; i < 40 && positionOf(state, 1) === HOME; i++) advance(state, MIN, content);
    expect(state.slots[1]?.action?.kind).toBe('walk');
    expect(positionOf(state, 1)).not.toBe(HOME);
    expect(state.world.location).toBe(HOME);
    expect(state.slots[0]?.action).toBeNull();
  });

  it('refuses a trip to the hex the slot already stands on, though another stands elsewhere', () => {
    const state = twoSlots();
    state.world.figures = { 1: FAR };
    const here = dispatch(state, { type: 'world.travel', cell: FAR, slot: 1 }, content);
    expect(here).toMatchObject({ ok: false, reason: 'error.alreadyThere' });
    expect(dispatch(state, { type: 'world.travel', cell: FAR, slot: 0 }, content)).toEqual({
      ok: true,
    });
  });

  it('runs a survey in each slot from its own position, and refuses a hex out of that slot range', () => {
    const state = twoSlots();
    state.world.figures = { 1: FAR };
    const range = rangeNow(state, content, 1);
    const home = positionHex(state, content, 0);
    const far = positionHex(state, content, 1);
    const outForClone = content.hexes.find(
      (h) =>
        h.terrain !== undefined &&
        !content.cells.some((c) => c.hex[0] === h.q && c.hex[1] === h.r) &&
        home &&
        far &&
        hexDistance(home, h) <= range &&
        hexDistance(far, h) > range,
    );
    expect(outForClone).toBeDefined();
    if (!outForClone) return;
    const address = hexKey(outForClone.q, outForClone.r);
    const subject = content.cells.find(
      (c) => c.hex[0] === outForClone.q && c.hex[1] === outForClone.r,
    );
    const id = subject?.id ?? address;
    const clone = dispatch(
      state,
      { type: 'action.start', slot: 1, kind: EXPLORE_KIND, id },
      content,
    );
    expect(clone).toMatchObject({ ok: false, reason: 'error.outOfRange' });
    expect(
      dispatch(state, { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id }, content),
    ).toEqual({ ok: true });
  });

  it('plans the auto-survey of each slot from its own position; one auto-survey runs at a time', () => {
    const state = twoSlots();
    state.world.figures = { 1: FAR };
    const a = autoPlan(state, content, 0);
    const b = autoPlan(state, content, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.stand).toBe(keyOf(HOME));
    expect(b?.stand).toBe(keyOf(FAR));
    const auto = (slot: number): Command => ({
      type: 'action.start',
      slot,
      kind: AUTOSURVEY_KIND,
      id: AUTOSURVEY_ID,
    });
    expect(dispatch(state, auto(0), content)).toEqual({ ok: true });
    // The same action in a second slot is refused, as every other action is.
    expect(dispatch(state, auto(1), content)).toMatchObject({
      ok: false,
      reason: 'error.sameActionElsewhere',
    });
    // The clone surveys by hand the hex the character would take next: that is another action, and
    // the plan of the character then skips the hex the clone is surveying.
    const target = autoPlan(state, content, 0)?.subject.address ?? '';
    expect(
      dispatch(state, { type: 'action.start', slot: 1, kind: EXPLORE_KIND, id: target }, content),
    ).toEqual({ ok: true });
    expect(autoPlan(state, content, 0)?.subject.address).not.toBe(target);
    advance(state, 30 * MIN, content);
    expect(state.slots[0]?.action?.kind).toBe(AUTOSURVEY_KIND);
  });

  it('does not depend on how the time is cut with two performers, and survives a save', () => {
    const make = (): GameState => {
      const s = twoSlots();
      dispatch(s, { type: 'world.travel', cell: 'core:rysovi_polia', slot: 0 }, content);
      dispatch(
        s,
        { type: 'action.start', slot: 1, kind: AUTOSURVEY_KIND, id: AUTOSURVEY_ID },
        content,
      );
      s.world.figures = { 1: FAR };
      return s;
    };
    const whole = make();
    advance(whole, 90 * MIN, content);
    const parts = make();
    for (let i = 0; i < 90; i++) advance(parts, MIN, content);
    expect(parts.world).toEqual(whole.world);
    expect(parts.slots.map((s) => s.action)).toEqual(whole.slots.map((s) => s.action));
    const loaded = deserialize(serialize(whole), content);
    expect(loaded.world.figures).toEqual(whole.world.figures);
    expect(loaded.world.location).toBe(whole.world.location);
  });

  describe('the life of a clone on the map', () => {
    const walkTo = (slot: number, cell: string): Command => ({ type: 'world.travel', cell, slot });

    it('appears where the character stands, and does not follow the character afterwards', () => {
      const state = twoSlots();
      expect(state.world.figures).toBeUndefined();
      expect(dispatch(state, walkTo(1, 'core:rysovi_polia'), content)).toEqual({ ok: true });
      expect(state.world.figures?.[1]).toBe(HOME);
      // The character walks off; the clone keeps its own position and its own route.
      expect(dispatch(state, walkTo(0, 'core:prykordonnyi_lis_okolytsia'), content)).toEqual({
        ok: true,
      });
      // Step by step until the character has left home while the clone is still on its way.
      for (let i = 0; i < 40 && state.world.location === HOME; i++) advance(state, MIN, content);
      expect(state.slots[1]?.action?.kind).toBe('walk');
      expect(state.world.location).not.toBe(HOME);
      expect(positionOf(state, 1)).toBe(state.world.figures?.[1]);
      expect(positionOf(state, 1)).not.toBe(positionOf(state, 0));
    });

    it('walks apart from the character and surveys from its own position', () => {
      const state = twoSlots();
      dispatch(state, walkTo(1, 'core:rysovi_polia'), content);
      advance(state, 60 * MIN, content);
      // Arrived: the walk is done, so the clone is gone from the map (it has nothing left to do).
      expect(state.slots[1]?.action).toBeNull();
      expect(state.world.figures?.[1]).toBeUndefined();
      expect(state.world.location).toBe(HOME);
      // A clone that surveys and a character that walks: the survey keeps its position.
      const auto: Command = {
        type: 'action.start',
        slot: 1,
        kind: AUTOSURVEY_KIND,
        id: AUTOSURVEY_ID,
      };
      expect(dispatch(state, auto, content)).toEqual({ ok: true });
      dispatch(state, walkTo(0, FAR), content);
      advance(state, 30 * MIN, content);
      expect(state.slots[1]?.action?.kind).toBe(AUTOSURVEY_KIND);
      expect(positionOf(state, 0)).not.toBe(HOME);
      expect(positionOf(state, 1)).toBe(state.world.figures?.[1]);
      expect(keyOf(positionOf(state, 1))).toBeDefined();
    });

    it('leaves the map when dispelled or stopped: no stale figure, the next clone starts at the character', () => {
      const state = twoSlots();
      dispatch(state, walkTo(1, 'core:rysovi_polia'), content);
      advance(state, 2 * MIN, content);
      expect(state.world.figures?.[1]).toBeDefined();
      state.world.figures = { 1: FAR };
      // A stop by hand is not a dispel, but the clone is gone all the same.
      expect(dispatch(state, { type: 'action.stop', slot: 1 }, content)).toEqual({ ok: true });
      expect(state.world.figures).toBeUndefined();
      dispatch(state, walkTo(1, 'core:rysovi_polia'), content);
      expect(state.world.figures?.[1]).toBe(HOME);
      // A new action given to a running clone keeps it where it stands.
      state.world.figures = { 1: FAR };
      dispatch(
        state,
        { type: 'action.start', slot: 1, kind: AUTOSURVEY_KIND, id: AUTOSURVEY_ID },
        content,
      );
      expect(state.world.figures?.[1]).toBe(FAR);
    });

    it('drops the figure of an idle slot when a save is loaded', () => {
      const state = twoSlots();
      state.world.figures = { 1: FAR };
      const loaded = deserialize(serialize(state), content);
      expect(loaded.world.figures).toBeUndefined();
    });
  });
});
