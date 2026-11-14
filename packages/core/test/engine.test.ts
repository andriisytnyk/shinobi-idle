import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  dispatch,
  registerActionKind,
  registerSystem,
  serialize,
  type Command,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, setLevel, start } from './helpers.ts';

const LEAF = 'core:leaf_whirlwind';

function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function busyState(): GameState {
  const state = genin();
  setLevel(state, 'tai', 12);
  dispatch(state, start('practice', LEAF), content);
  return state;
}

describe('advance', () => {
  it('rejects fractional or negative time', () => {
    const state = createState(1, content);
    expect(() => advance(state, -1, content)).toThrow(RangeError);
    expect(() => advance(state, 0.5, content)).toThrow(RangeError);
  });

  it('only moves the clock when nothing is running', () => {
    const state = createState(1, content);
    const before = serialize(state);
    advance(state, 1500, content);
    expect(state.now).toBe(1500);
    expect(serialize({ ...state, now: 0 })).toBe(before);
  });

  it('A3: one call, 1000 small calls and random chunks give the same state', () => {
    const whole = busyState();
    advance(whole, HOUR, content);

    const small = busyState();
    for (let i = 0; i < 1000; i++) advance(small, 3600, content);

    const random = busyState();
    const next = lcg(7);
    for (let left = HOUR; left > 0;) {
      const chunk = Math.min(left, 1 + Math.floor(next() * 40_000));
      advance(random, chunk, content);
      left -= chunk;
    }

    expect(whole.now).toBe(HOUR);
    expect(whole.stats.completed).toBeGreaterThan(1000);
    expect(serialize(small)).toBe(serialize(whole));
    expect(serialize(random)).toBe(serialize(whole));
  });

  it('keeps split invariance when the slot runs at half speed', () => {
    const make = () => {
      const s = busyState();
      s.slots[0]!.share = 0.5;
      return s;
    };
    const whole = make();
    advance(whole, 600_000, content);
    const parts = make();
    for (let i = 0; i < 600; i++) advance(parts, 1000, content);
    expect(parts.stats.completed).toBe(whole.stats.completed);
    expect(parts.skills.tai.xp).toBeCloseTo(whole.skills.tai.xp, 6);
  });

  it('a half-share slot completes half as many cycles', () => {
    const full = busyState();
    const half = busyState();
    half.slots[0]!.share = 0.5;
    advance(full, 600_000, content);
    advance(half, 600_000, content);
    expect(half.stats.completed).toBeCloseTo(full.stats.completed / 2, -1);
  });

  it('A11: 12 hours of practice finish in under 500 ms', () => {
    const state = busyState();
    const t0 = process.hrtime.bigint();
    advance(state, 12 * HOUR, content);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(state.now).toBe(12 * HOUR);
    expect(ms).toBeLessThan(500);
  });

  it('lets another system plug into the loop', () => {
    const state = createState(1, content);
    let fired = 0;
    let due = 5000;
    registerSystem({
      nextEventIn: (s) => (due > s.now ? due - s.now : null),
      run: (s) => {
        if (s.now >= due && due !== Infinity) {
          fired++;
          due = Infinity;
        }
      },
    });
    advance(state, 4999, content);
    expect(fired).toBe(0);
    advance(state, 1, content);
    expect(fired).toBe(1);
    advance(state, 10_000, content);
    expect(fired).toBe(1);
  });

  it('throws instead of hanging when a system never lets time move', () => {
    const state = createState(1, content);
    const never = { calls: 0 };
    const stuck = {
      nextEventIn: () => (never.calls >= 0 ? 0 : null),
      run: () => {
        never.calls++;
      },
    };
    registerSystem(stuck);
    expect(() => advance(state, 10, content)).toThrow(/no progress/);
    never.calls = -Infinity; // park it: from now on it reports nothing pending
  });
});

describe('A2: determinism', () => {
  const script: Command[] = [
    { type: 'action.start', slot: 0, kind: 'practice', id: 'core:clone' },
    { type: 'action.start', slot: 0, kind: 'drill', id: 'core:lystok_na_lobi' },
    { type: 'action.start', slot: 0, kind: 'meditate', id: 'core:tykha_kimnata' },
    { type: 'action.stop', slot: 0 },
    { type: 'action.start', slot: 0, kind: 'obstacle', id: 'core:strybky_po_dakhakh' },
    { type: 'action.start', slot: 0, kind: 'practice', id: LEAF },
  ];

  const run = (seed: number) => {
    const state = createState(seed, content);
    for (const [i, command] of script.entries()) {
      dispatch(state, command, content);
      advance(state, 777_777 + i * 1234, content);
    }
    return serialize(state);
  };

  it('gives byte-identical saves for the same seed and script', () => {
    const a = run(42);
    expect(run(42)).toBe(a);
    expect(a.length).toBeGreaterThan(500);
  });

  it('differs for another seed', () => {
    expect(run(43)).not.toBe(run(42));
  });
});

describe('dispatch', () => {
  it('starts an action, resets progress and runs it', () => {
    const state = genin();
    state.slots[0]!.progress = 999;
    expect(dispatch(state, start('practice', 'core:clone'), content)).toEqual({ ok: true });
    expect(state.slots[0]).toEqual({
      action: { kind: 'practice', id: 'core:clone' },
      progress: 0,
      share: 1,
    });
    advance(state, 10_000, content);
    expect(state.stats.completed).toBeGreaterThan(0);
  });

  it('fails with locale keys', () => {
    const state = createState(1, content);
    const fail = (c: unknown) => dispatch(state, c as Command, content);
    expect(fail({ type: 'nope' })).toEqual({ ok: false, reason: 'error.unknownCommand' });
    expect(fail(start('practice', 'core:clone', 5))).toEqual({
      ok: false,
      reason: 'error.invalidSlot',
    });
    expect(fail(start('fly', 'x'))).toEqual({ ok: false, reason: 'error.unknownActionKind' });
    expect(fail(start('practice', 'core:nothing'))).toEqual({
      ok: false,
      reason: 'error.unknownAction',
    });
    // Known technique id, but not learned yet and the skill level is too low.
    expect(fail(start('practice', 'core:dynamic_entry'))).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    expect(fail(start('drill', 'core:khodinnia_po_derevu'))).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    expect(fail({ type: 'action.stop', slot: 0 })).toEqual({ ok: false, reason: 'error.noAction' });
    expect(fail({ type: 'action.stop', slot: 9 })).toEqual({
      ok: false,
      reason: 'error.invalidSlot',
    });
  });

  it('stops an action and queues actionStopped', () => {
    const state = createState(1, content);
    dispatch(state, start('practice', 'core:clone'), content);
    expect(dispatch(state, { type: 'action.stop', slot: 0 }, content)).toEqual({ ok: true });
    expect(state.slots[0]?.action).toBeNull();
    expect(state.events).toEqual([
      {
        type: 'actionStopped',
        slot: 0,
        kind: 'practice',
        id: 'core:clone',
        reason: 'manual',
        at: 0,
      },
    ]);
    const before = state.stats.completed;
    advance(state, 60_000, content);
    expect(state.stats.completed).toBe(before);
  });

  it('stops by itself when requirements stop holding, and accepts new action kinds', () => {
    registerActionKind('test-eat', {
      has: (id) => id === 'bun',
      requirements: () => ({ t: 'item', id: 'core:bun', n: 1 }),
      intervalMs: () => 1000,
      complete: (state) => {
        state.bank['core:bun'] = (state.bank['core:bun'] ?? 0) - 1;
      },
    });
    const state = createState(1, content);
    state.bank['core:bun'] = 3;
    expect(dispatch(state, start('test-eat', 'bun'), content)).toEqual({ ok: true });
    advance(state, 10_000, content);
    expect(state.stats.completed).toBe(3);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.events.at(-1)).toMatchObject({ type: 'actionStopped', reason: 'requirements' });
  });

  it('keeps only the newest 200 events', () => {
    const state = createState(1, content);
    for (let i = 0; i < 250; i++) {
      dispatch(state, start('practice', 'core:clone'), content);
      dispatch(state, { type: 'action.stop', slot: 0 }, content);
    }
    expect(state.events.length).toBe(200);
  });
});
