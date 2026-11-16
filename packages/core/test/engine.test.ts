import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  createState,
  dispatch,
  defaultRules,
  deserialize,
  serialize,
  type Command,
  type GameState,
  type Rules,
  type ActionKind,
} from '../src/index.ts';
import { genin, HOUR, setLevel, start } from './helpers.ts';
import { bestOf, speedBudget } from './speed.ts';

const LEAF = 'core:leaf_whirlwind';

/** The practice cycle of Leaf Whirlwind for the test player, in ms. */
function leafCycleMs(): number {
  const state = genin();
  setLevel(state, 'tai', 12);
  return actionInfo(state, { kind: 'practice', id: LEAF }, content)!.intervalMs;
}

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

const kindRules = (kind: ActionKind): Rules => ({
  ...defaultRules,
  actionKinds: { ...defaultRules.actionKinds, test: kind },
});

/** A test action that eats one bun per 1 s cycle and needs a bun to run. */
const eatKind = (): ActionKind => ({
  has: (id) => id === 'bun' || id === 'bun2',
  requirements: () => ({ t: 'item', id: 'core:bun', n: 1 }),
  intervalMs: () => 1000,
  complete: (state) => {
    state.bank['core:bun'] = (state.bank['core:bun'] ?? 0) - 1;
  },
});

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

  it('A11: 12 hours of practice finish within the speed budget (500 ms on the reference machine, never above 2 s)', () => {
    // Other test files run at the same time and CI runners are slower, so the budget is scaled to
    // the machine, and the best of several runs is taken: the run the machine disturbed least.
    const limit = speedBudget(500, 2000);
    const best = bestOf(5, limit, () => {
      const state = busyState();
      advance(state, 12 * HOUR, content);
      expect(state.now).toBe(12 * HOUR);
    });
    expect(best).toBeLessThan(limit);
  });

  it('runs extra systems of a custom rule set, without touching the default one', () => {
    const state = createState(1, content);
    let fired = 0;
    let due = 5000;
    const rules: Rules = {
      ...defaultRules,
      systems: [
        ...defaultRules.systems,
        {
          nextEventIn: (s) => (due > s.now ? due - s.now : null),
          run: (s) => {
            if (s.now >= due && due !== Infinity) {
              fired++;
              due = Infinity;
            }
          },
        },
      ],
    };
    advance(state, 4999, content, rules);
    expect(fired).toBe(0);
    advance(state, 1, content, rules);
    expect(fired).toBe(1);
    advance(state, 10_000, content, rules);
    expect(fired).toBe(1);
    expect(defaultRules.systems).toHaveLength(5);
  });

  it('throws instead of hanging when a system never lets time move', () => {
    const state = createState(1, content);
    const rules: Rules = {
      ...defaultRules,
      systems: [{ nextEventIn: () => 0, run: () => undefined }],
    };
    expect(() => advance(state, 10, content, rules)).toThrow(/no progress/);
  });
});

describe('integer time accounting', () => {
  const SHARES = [1000, 500, 333, 700, 300, 600];
  const CHUNKS = [1, 7, 999, 3600, 1000];
  const TOTAL = 60_000;

  const make = (share: number) => {
    const s = busyState();
    s.slots[0]!.share = share;
    return s;
  };

  for (const share of SHARES) {
    it(`share ${share}: every chunking gives byte-identical states`, () => {
      const whole = make(share);
      advance(whole, TOTAL, content);
      const expected = serialize(whole);
      expect(whole.now).toBe(TOTAL);
      for (const chunk of CHUNKS) {
        const s = make(share);
        for (let left = TOTAL; left > 0; left -= chunk) advance(s, Math.min(chunk, left), content);
        expect(serialize(s)).toBe(expected);
      }
    });
  }

  it('slows cycles in proportion to the share', () => {
    const full = make(1000);
    const half = make(500);
    advance(full, 600_000, content);
    advance(half, 600_000, content);
    // The cast part of the cycle shortens with the mastery the practice itself earns (2087 ms at half the
    // mastery against 2060 ms at full), so the halves differ by that drift, about 1%, not by rounding.
    expect(Math.abs(half.stats.completed - full.stats.completed / 2)).toBeLessThanOrEqual(
      full.stats.completed * 0.01 + 1,
    );
  });

  it('rounds the next event up: a cycle ends at the first whole ms with enough work', () => {
    // A cycle of C ms is C x 1000 units; share 333 needs C x 1000 / 333 ms, rounded up.
    const units = leafCycleMs() * 1000;
    const need = Math.ceil(units / 333);
    const state = make(333);
    advance(state, need - 1, content);
    expect(state.stats.completed).toBe(0);
    advance(state, 1, content);
    expect(state.stats.completed).toBe(1);
    expect(state.slots[0]?.progress).toBe(need * 333 - units);
  });
});

describe('A2: determinism', () => {
  const script: Command[] = [
    { type: 'action.start', slot: 0, kind: 'practice', id: 'core:clone' },
    { type: 'action.start', slot: 0, kind: 'drill', id: 'core:lystok_na_lobi' },
    { type: 'action.start', slot: 0, kind: 'meditate', id: 'core:tykha_kimnata' },
    { type: 'action.stop', slot: 0 },
    { type: 'athletics.build', slot: 1, obstacle: 'core:strybky_po_dakhakh' },
    { type: 'action.start', slot: 0, kind: 'course', id: 'ath' },
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
      share: 1000,
      data: null,
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

  it('stops by itself when requirements stop holding', () => {
    const state = createState(1, content);
    state.bank['core:bun'] = 3;
    const rules = kindRules(eatKind());
    expect(dispatch(state, start('test', 'bun'), content, rules)).toEqual({ ok: true });
    advance(state, 10_000, content, rules);
    expect(state.stats.completed).toBe(3);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.events.at(-1)).toMatchObject({ type: 'actionStopped', reason: 'requirements' });
  });

  it('a kind can end itself by returning "stop"', () => {
    const state = createState(1, content);
    const rules = kindRules({ ...eatKind(), requirements: () => null, complete: () => 'stop' });
    dispatch(state, start('test', 'bun'), content, rules);
    advance(state, 10_000, content, rules);
    expect(state.stats.completed).toBe(1);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.events.at(-1)).toMatchObject({ type: 'actionStopped', reason: 'finished' });
  });

  it('calls start and stop hooks, and keeps per-slot data in the save', () => {
    const log: string[] = [];
    const rules = kindRules({
      ...eatKind(),
      requirements: () => null,
      start: (state, slot, id) => {
        log.push(`start ${slot} ${id}`);
        state.slots[slot]!.data = { count: 0 };
      },
      complete: (state) => {
        const data = state.slots[0]!.data as { count: number };
        data.count++;
      },
      stop: (_state, slot, id, _content, _rules, reason) =>
        log.push(`stop ${slot} ${id} ${reason}`),
    });
    const state = createState(1, content);
    dispatch(state, start('test', 'bun'), content, rules);
    advance(state, 3500, content, rules);
    expect(state.slots[0]?.data).toEqual({ count: 3 });
    const back = deserialize(serialize(state), content, rules);
    expect(back.slots[0]?.data).toEqual({ count: 3 });
    dispatch(state, { type: 'action.stop', slot: 0 }, content, rules);
    expect(state.slots[0]?.data).toBeNull();
    // Starting over a running action stops the old one first.
    dispatch(state, start('test', 'bun'), content, rules);
    dispatch(state, start('test', 'bun2'), content, rules);
    expect(log).toEqual([
      'start 0 bun',
      'stop 0 bun manual',
      'start 0 bun',
      'stop 0 bun replaced',
      'start 0 bun2',
    ]);
    expect(state.events.filter((e) => e.type === 'actionStopped').map((e) => e.reason)).toEqual([
      'manual',
      'replaced',
    ]);
  });

  it('a save whose slot uses a kind missing from the rule set loads with the slot emptied', () => {
    const rules = kindRules({ ...eatKind(), requirements: () => null });
    const state = createState(1, content);
    dispatch(state, start('test', 'bun'), content, rules);
    advance(state, 1500, content, rules);
    const back = deserialize(serialize(state), content);
    expect(back.slots[0]).toEqual({ action: null, progress: 0, share: 1000, data: null });
    expect(back.events).toEqual([
      { type: 'actionStopped', slot: 0, kind: 'test', id: 'bun', reason: 'missing', at: 1500 },
    ]);
  });

  it('a doctored save cannot hold more progress than one cycle', () => {
    const state = busyState();
    const doc = JSON.parse(serialize(state));
    doc.state.slots[0].progress = 1e15;
    const back = deserialize(JSON.stringify(doc), content);
    expect(back.slots[0]?.progress).toBe(leafCycleMs() * 1000);
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

describe('speed budget', () => {
  const sum = (s: GameState) => s.slots.reduce((n, slot) => n + slot.share, 0);
  const slots = (n: number) => {
    const s = createState(1, content);
    s.player.rank = 'genin';
    for (let i = 1; i < n; i++) s.slots.push({ action: null, progress: 0, share: 0, data: null });
    return s;
  };

  it('one slot always has the full budget', () => {
    const s = slots(1);
    expect(s.slots[0]?.share).toBe(1000);
    dispatch(s, start('practice', 'core:clone'), content);
    expect(s.slots[0]?.share).toBe(1000);
    dispatch(s, { type: 'action.stop', slot: 0 }, content);
    expect(s.slots[0]?.share).toBe(1000);
  });

  it('splits among active slots, remainder to the first, and re-splits on stop', () => {
    const s = slots(3);
    dispatch(s, start('practice', 'core:clone', 0), content);
    dispatch(s, start('practice', 'core:transformation', 1), content);
    expect(s.slots.map((x) => x.share)).toEqual([500, 500, 0]);
    dispatch(s, start('practice', 'core:body_replacement', 2), content);
    expect(s.slots.map((x) => x.share)).toEqual([334, 333, 333]);
    expect(sum(s)).toBe(1000);
    dispatch(s, { type: 'action.stop', slot: 0 }, content);
    expect(s.slots.map((x) => x.share)).toEqual([0, 500, 500]);
    advance(s, 30_000, content);
    expect(s.stats.completed).toBeGreaterThan(0);
  });

  it('is recomputed on load, so a doctored share does nothing', () => {
    const s = busyState();
    const doc = JSON.parse(serialize(s));
    doc.state.slots[0].share = 1e9;
    expect(deserialize(JSON.stringify(doc), content).slots[0]?.share).toBe(1000);
  });
});
