/** Work that a found point opens: the ruin search and the gathering of sulphur (the map's «points that open actions»). */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  deserialize,
  dispatch,
  hexInfo,
  hexKey,
  listSkillActions,
  revealOf,
  serialize,
  touchWorld,
  type Command,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, setLevel, start } from './helpers.ts';

const RUINS = 'core:war_fort_ruins';
const SEARCH = 'core:search_war_fort_ruins';
const VALLEY = 'core:hell_valley';
const SULPHUR_WORK = 'core:gather_hell_valley_sulphur';
const SULPHUR = 'core:sulphur';
const BOMB = 'core:iidka_dymova_bomba';

const work = (id: string, slot = 0): Command => start('fieldwork', id, slot);
const find = (s: GameState, place: string): void => {
  s.world.pois[place] = true;
  touchWorld(s);
};
const cycleMs = (id: string): number =>
  Math.round((content.fieldworks.find((w) => w.id === id)?.cycle ?? 0) * 1000);

describe('what the points open', () => {
  it('gives the ruins a search and Hell Valley a gathering, both of the scouting skill', () => {
    const ids = content.fieldworks.map((w) => w.id);
    expect(ids).toEqual([SEARCH, SULPHUR_WORK]);
    const s = genin();
    const scout = content.skills.find((x) => x.activity === 'map')?.id ?? '';
    expect(listSkillActions(s, scout, content).map((i) => i.id)).toEqual(ids);
  });

  it('keeps the action locked until the point is found, then open for good', () => {
    const s = genin();
    setLevel(s, 'scout', 10);
    expect(dispatch(s, work(SEARCH), content).ok).toBe(false);
    const locked = actionInfo(s, { kind: 'fieldwork', id: SEARCH }, content);
    expect(locked?.available).toBe(false);
    find(s, RUINS);
    expect(actionInfo(s, { kind: 'fieldwork', id: SEARCH }, content)?.available).toBe(true);
    // The hero is nowhere near the ruins: finding the point once is enough.
    expect(dispatch(s, work(SEARCH), content)).toEqual({ ok: true });
  });

  it('also asks for the Scouting level', () => {
    const s = genin();
    find(s, VALLEY);
    setLevel(s, 'scout', 14);
    expect(dispatch(s, work(SULPHUR_WORK), content).ok).toBe(false);
    setLevel(s, 'scout', 15);
    expect(dispatch(s, work(SULPHUR_WORK), content)).toEqual({ ok: true });
  });
});

describe('what the work pays', () => {
  it('gathering sulphur pays one sulphur and Scouting XP every cycle', () => {
    const s = genin();
    setLevel(s, 'scout', 15);
    find(s, VALLEY);
    const before = s.skills.scout?.xp ?? 0;
    expect(dispatch(s, work(SULPHUR_WORK), content)).toEqual({ ok: true });
    advance(s, 10 * cycleMs(SULPHUR_WORK), content);
    expect(s.bank[SULPHUR]).toBe(10);
    const xp = content.fieldworks.find((w) => w.id === SULPHUR_WORK)?.xp ?? 0;
    expect((s.skills.scout?.xp ?? 0) - before).toBeCloseTo(10 * xp, 3);
    expect(s.mastery[SULPHUR_WORK]?.xp ?? 0).toBeGreaterThan(0);
  });

  it('the ruin search pays coins and now and then Intel, deterministically', () => {
    const run = (seed: number) => {
      const s = genin(seed);
      setLevel(s, 'scout', 10);
      find(s, RUINS);
      s.bank['core:coin'] = 0;
      dispatch(s, work(SEARCH), content);
      advance(s, 400 * cycleMs(SEARCH), content);
      return s;
    };
    const a = run(7);
    const b = run(7);
    const coins = a.bank['core:coin'] ?? 0;
    // A drop of 30%: some of 400 cycles, never all of them.
    expect(coins).toBeGreaterThan(40);
    expect(coins).toBeLessThan(250);
    expect(a.currencies['intel']).toBeGreaterThan(0);
    expect(JSON.stringify(serialize(a))).toBe(JSON.stringify(serialize(b)));
    expect(JSON.stringify(serialize(run(8)))).not.toBe(JSON.stringify(serialize(a)));
  });

  it('survives a save: the mastery of the work is kept', () => {
    const s = genin();
    setLevel(s, 'scout', 15);
    find(s, VALLEY);
    dispatch(s, work(SULPHUR_WORK), content);
    advance(s, HOUR / 10, content);
    const back = deserialize(serialize(s), content);
    expect(back.mastery[SULPHUR_WORK]?.xp).toBe(s.mastery[SULPHUR_WORK]?.xp);
    expect(back.world.pois[VALLEY]).toBe(true);
  });
});

describe('the recipe that takes sulphur', () => {
  it('cannot be started without sulphur and makes bombs with it', () => {
    const s = genin();
    setLevel(s, 'alch', 16);
    s.bank['core:nettle'] = 2;
    expect(dispatch(s, start('craft', BOMB), content).ok).toBe(false);
    s.bank[SULPHUR] = 1;
    expect(dispatch(s, start('craft', BOMB), content)).toEqual({ ok: true });
    advance(s, 3_000, content);
    expect(s.bank[BOMB]).toBeGreaterThanOrEqual(3);
    expect(s.bank[SULPHUR] ?? 0).toBe(0);
  });
});

describe('the reveal rule', () => {
  it('shows nothing of the work until its point is found', () => {
    const s = genin();
    const ref = { kind: 'fieldwork', id: SEARCH };
    expect(revealOf(s, ref, content)).toBe('hidden');
    find(s, RUINS);
    expect(revealOf(s, ref, content)).toBe('full');
  });

  it('a veiled point names no place and opens no action on the hex panel', () => {
    const s = genin();
    const place = content.places.find((p) => p.id === VALLEY);
    if (!place) throw new Error('no valley');
    const key = hexKey(place.hex[0], place.hex[1]);
    // Survey the hex, but Scouting is below what the point asks for: it is only veiled.
    s.world.surveyed[key] = true;
    // A plain hex (no cell) is surveyed by explores counted under its key.
    s.world.explores[key] = 100;
    touchWorld(s);
    const info = hexInfo(s, key, content)!;
    const veiled = info.points.filter((p) => p.status === 'veiled');
    expect(veiled.length).toBeGreaterThan(0);
    for (const p of veiled) {
      expect(p.place).toBeNull();
      expect(p.opens).toEqual([]);
    }
  });
});
