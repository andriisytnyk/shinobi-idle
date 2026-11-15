/** A8: determinism and split-invariance with the course and Meditation running; A9: the save migration to version 7. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  deserialize,
  dispatch,
  MIGRATIONS,
  refreshUnlocks,
  serialize,
  STATE_VERSION,
  type GameState,
} from '../src/index.ts';
import { genin, setLevel, start } from './helpers.ts';

const WINDOW = 240_000;

/** A genin with three obstacles built, the course in slot 0 and, when `shared`, meditation in a second slot. */
function scene(seed: number, shared: boolean): GameState {
  const s = genin(seed);
  setLevel(s, 'ath', 20);
  s.currencies.ryo = 100_000;
  for (const [slot, obstacle] of [
    [1, 'core:strybky_po_dakhakh'],
    [2, 'core:obtiazhuvachi'],
    [3, 'core:ukhylennia_vid_kunaiv'],
  ] as const) {
    expect(dispatch(s, { type: 'athletics.build', slot, obstacle }, content)).toEqual({ ok: true });
  }
  expect(dispatch(s, start('course', 'ath'), content)).toEqual({ ok: true });
  if (shared) {
    s.slots.push({ action: null, progress: 0, share: 0, data: null });
    expect(dispatch(s, start('meditate', 'core:tykha_kimnata', 1), content)).toEqual({ ok: true });
  }
  return s;
}

describe('A8: determinism and split-invariance', () => {
  for (const shared of [false, true]) {
    const label = shared
      ? 'shares 500 and 500 (course and meditation)'
      : 'share 1000 (course alone)';

    it(`gives the same state for any chunking, ${label}`, () => {
      const whole = scene(5, shared);
      advance(whole, WINDOW, content);
      expect(whole.counters['actions.course']).toBeGreaterThan(5);
      if (shared) expect(whole.counters['actions.meditate']).toBeGreaterThan(10);
      expect(whole.slots[0]?.share).toBe(shared ? 500 : 1000);
      const expected = serialize(whole);
      for (const chunk of [1, 7, 999, 3600]) {
        const split = scene(5, shared);
        for (let left = WINDOW; left > 0; left -= chunk)
          advance(split, Math.min(chunk, left), content);
        expect(serialize(split), `chunk ${chunk}`).toBe(expected);
      }
    });

    it(`gives byte-identical saves for the same seed, ${label}`, () => {
      const a = scene(9, shared);
      const b = scene(9, shared);
      advance(a, WINDOW, content);
      advance(b, WINDOW, content);
      expect(serialize(b)).toBe(serialize(a));
      // A different seed rolls different Insights.
      if (shared) {
        const c = scene(10, shared);
        advance(c, WINDOW, content);
        expect(serialize(c)).not.toBe(serialize(a));
      }
    });
  }

  it('survives a save and load in the middle of a lap', () => {
    const a = scene(2, true);
    advance(a, 100_003, content);
    const b = deserialize(serialize(a), content);
    advance(a, 90_001, content);
    advance(b, 90_001, content);
    expect(serialize(b)).toBe(serialize(a));
    expect(b.course).toEqual(a.course);
    expect(b.meditation).toEqual(a.meditation);
  });
});

/** A save as the version before this one wrote it: no meditation, no course, and the plain obstacle action. */
function v6Save(patch: (state: Record<string, unknown>) => void, version = 6): string {
  const s = createState(1, content);
  s.player.rank = 'genin';
  const parsed = JSON.parse(serialize(s)) as { v: number; state: Record<string, unknown> };
  parsed.v = version;
  parsed.state.v = version;
  delete parsed.state.meditation;
  delete parsed.state.course;
  patch(parsed.state);
  return JSON.stringify(parsed);
}

describe('A9: save migration to version 7', () => {
  it('is the seventh step', () => {
    expect(STATE_VERSION).toBe(8);
    expect(MIGRATIONS).toHaveLength(STATE_VERSION - 1);
  });

  it('loads a version 6 save with empty Meditation and course', () => {
    const state = deserialize(
      v6Save(() => {}),
      content,
    );
    expect(state.v).toBe(STATE_VERSION);
    expect(state.meditation).toEqual({});
    expect(state.course).toEqual({});
  });

  it('also carries a version 5 save through both steps', () => {
    const text = v6Save((state) => {
      state.slots = [
        {
          action: { kind: 'obstacle', id: 'core:bih_navkolo_sela' },
          progress: 0,
          share: 1000,
          data: null,
        },
      ];
    }, 5);
    const state = deserialize(text, content);
    expect(state.v).toBe(STATE_VERSION);
    expect(state.course).toEqual({ '1': 'core:bih_navkolo_sela' });
  });

  it('turns a running obstacle of slot 1 into a course lap with that obstacle built', () => {
    const text = v6Save((state) => {
      state.skills = { ...(state.skills as object), ath: { xp: 400 } };
      state.slots = [
        {
          action: { kind: 'obstacle', id: 'core:bih_navkolo_sela' },
          progress: 1_234_567,
          share: 1000,
          data: null,
        },
      ];
    });
    const state = deserialize(text, content);
    expect(state.slots[0]?.action).toEqual({ kind: 'course', id: 'ath' });
    expect(state.course).toEqual({ '1': 'core:bih_navkolo_sela' });
    expect(state.slots[0]?.progress).toBe(1_234_567);
    // It keeps running as a course lap and pays out.
    advance(state, 60_000, content);
    expect(state.counters['actions.course']).toBeGreaterThan(10);
    expect(state.mastery['core:bih_navkolo_sela']?.xp).toBeGreaterThan(0);
  });

  it('builds the obstacle where it stood when it was in a later slot', () => {
    const text = v6Save((state) => {
      state.slots = [
        {
          action: { kind: 'obstacle', id: 'core:obtiazhuvachi' },
          progress: 0,
          share: 1000,
          data: null,
        },
      ];
    });
    const state = deserialize(text, content);
    expect(state.course).toEqual({ '2': 'core:obtiazhuvachi' });
    expect(state.slots[0]?.action).toEqual({ kind: 'course', id: 'ath' });
  });

  it('drops a running obstacle the content does not know', () => {
    const text = v6Save((state) => {
      state.slots = [
        { action: { kind: 'obstacle', id: 'core:gone' }, progress: 5, share: 1000, data: null },
      ];
    });
    const state = deserialize(text, content);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.course).toEqual({});
  });

  it('cleans doctored Meditation and course data in a current save', () => {
    const s = genin();
    s.meditation['core:tykha_kimnata'] = {
      insight: 4,
      enlight: 1,
      bought: { 'insight.0': 99, 'insight.9': 3, 'enlight.1': 2 },
    };
    s.course = { '1': 'core:bih_navkolo_sela', '2': 'core:strybky_po_dakhakh', '9': 'core:nope' };
    const parsed = JSON.parse(serialize(s)) as { state: { meditation: Record<string, unknown> } };
    parsed.state.meditation['core:made_up'] = { insight: 1, enlight: 1, bought: {} };
    const loaded = deserialize(JSON.stringify(parsed), content);
    expect(loaded.course).toEqual({ '1': 'core:bih_navkolo_sela' });
    expect(Object.keys(loaded.meditation)).toEqual(['core:tykha_kimnata']);
    expect(loaded.meditation['core:tykha_kimnata']).toEqual({
      insight: 4,
      enlight: 1,
      bought: { 'insight.0': content.balance.K.meditation.insightLevels, 'enlight.1': 2 },
    });
  });

  it('round-trips a current save byte for byte', () => {
    const s = scene(4, true);
    advance(s, 50_000, content);
    refreshUnlocks(s, content, true);
    s.meditation['core:tykha_kimnata'] = { insight: 3, enlight: 1, bought: { 'insight.0': 2 } };
    expect(serialize(deserialize(serialize(s), content))).toBe(serialize(s));
  });
});
