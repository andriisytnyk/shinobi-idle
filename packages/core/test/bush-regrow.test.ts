/**
 * Herb bushes regrow while they are gathered (G1): a bush that is not empty regrows one herb every
 * `K.field.regrowEachMs`, gathered or left alone; a bush gathered to 0 is a regrow phase of its own
 * (`K.field.regrowMs`), then whole again. Mint: 6 herbs, a cycle of 2.5 s, one herb regrown per 10 s.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  advanceOffline,
  bushNow,
  deserialize,
  rate,
  dispatch,
  serialize,
  settleBush,
  STATE_VERSION,
  createState,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, plainRules, start } from './helpers.ts';

const K = content.balance.K;
const MINT = 'core:mint';
const CYCLE = K.gather * 1000;
const SIZE = K.field.stockBase + 1;
const EACH = K.field.regrowEachMs;
const PAUSE = K.field.regrowMs;

const run = (s: GameState, ms: number) => advance(s, ms, content, plainRules);
const go = (s: GameState, herb = MINT) =>
  expect(dispatch(s, start('gather', herb), content)).toEqual({ ok: true });
const bush = (s: GameState) => bushNow(s, MINT, content, plainRules);

describe('the numbers the tests rest on', () => {
  it('has a regrow slower than a cycle, so steady gathering slowly empties a bush', () => {
    expect(CYCLE).toBe(2500);
    expect(SIZE).toBe(6);
    expect(EACH).toBeGreaterThan(CYCLE);
  });
});

describe('regrow while gathering', () => {
  it('takes one herb per cycle and gives one back per regrow interval', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 4);
    // 4 herbs taken, the interval (10 s) has just been reached: the clock started at the first herb (2.5 s).
    expect(bush(s).stock).toBe(SIZE - 4);
    run(s, CYCLE); // 12.5 s: the first regrown herb is there, a fifth is taken
    expect(bush(s).stock).toBe(SIZE - 5 + 1);
    expect(s.bank[MINT]).toBe(5);
  });

  it('empties a bush a herb later than the stock alone would, and holds out 7 herbs', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 7 - 1);
    expect(s.bank[MINT]).toBe(SIZE);
    run(s, 1);
    expect(s.bank[MINT]).toBe(SIZE + 1);
    expect(s.bushes[MINT]?.stock).toBe(0);
  });
});

describe('regrow of a bush left alone', () => {
  it('goes on one herb per interval while nobody gathers', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 2); // 2 herbs taken; the clock started at 2.5 s
    expect(dispatch(s, { type: 'action.stop', slot: 0 }, content)).toEqual({ ok: true });
    expect(bush(s).stock).toBe(SIZE - 2);
    run(s, EACH - 1 - CYCLE); // 12.499 s: the first herb is a ms short
    expect(bush(s).stock).toBe(SIZE - 2);
    run(s, 1);
    expect(bush(s)).toMatchObject({ stock: SIZE - 1, phase: null });
    run(s, EACH);
    expect(bush(s)).toMatchObject({ stock: SIZE, leftMs: 0 });
    run(s, HOUR);
    expect(bush(s).stock).toBe(SIZE);
  });
});

describe('depletion and the whole regrow', () => {
  it('is a regrow phase of the pause, then a full stock, then a gather phase', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 7);
    expect(s.bank[MINT]).toBe(7);
    const info = () => actionInfo(s, { kind: 'gather', id: MINT }, content, plainRules);
    // The phase the core reports: the pause, with its own length and time left.
    expect(bush(s)).toMatchObject({ stock: 0, phase: 'regrow', leftMs: PAUSE, spanMs: PAUSE });
    expect(info()?.phaseMs).toBe(PAUSE);
    expect(info()?.intervalMs).toBe(CYCLE);
    run(s, PAUSE - 1);
    expect(bush(s)).toMatchObject({ stock: 0, phase: 'regrow', leftMs: 1 });
    expect(s.bank[MINT]).toBe(7);
    run(s, 1);
    // The stock jumps to full when the pause ends, and nothing was gathered in it.
    expect(bush(s)).toMatchObject({ stock: SIZE, phase: null });
    expect(info()?.phaseMs).toBeUndefined();
    expect(s.bank[MINT]).toBe(7);
    run(s, CYCLE - 1);
    expect(s.bank[MINT]).toBe(7);
    run(s, 1);
    expect(s.bank[MINT]).toBe(8);
    expect(bush(s).stock).toBe(SIZE - 1);
  });

  it('gives no herb and no XP for the pause', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 7);
    const xp = s.skills.herb!.xp;
    run(s, PAUSE);
    expect(s.skills.herb!.xp).toBe(xp);
    expect(s.stats.completed).toBe(7);
  });
});

describe('split invariance', () => {
  const total = CYCLE * 7 + PAUSE + EACH * 3 + 123;
  const whole = (): GameState => {
    const s = genin();
    go(s);
    run(s, total);
    return s;
  };

  it('is the same for one advance and for many small ones', () => {
    const one = whole();
    const steps = genin();
    go(steps);
    let left = total;
    for (const n of [1, 7, 13, 999, 2500, 3, 4001, 250]) {
      run(steps, n);
      left -= n;
    }
    while (left > 0) {
      const n = Math.min(250, left);
      run(steps, n);
      left -= n;
    }
    expect(serialize(steps)).toBe(serialize(one));
  });

  it('is the same when the hero stops and starts between the steps', () => {
    const a = genin();
    go(a);
    run(a, 20_000);
    expect(dispatch(a, { type: 'action.stop', slot: 0 }, content)).toEqual({ ok: true });
    run(a, 30_000);
    const b = genin();
    go(b);
    run(b, 20_000);
    expect(dispatch(b, { type: 'action.stop', slot: 0 }, content)).toEqual({ ok: true });
    for (let i = 0; i < 30; i++) run(b, 1000);
    expect(serialize(b)).toBe(serialize(a));
  });

  it('settles a bush in one step over any span', () => {
    const b = { stock: 2, size: 6, at: 1000 };
    const once = settleBush(b, 1000 + EACH * 2 + 5, 6, EACH, PAUSE);
    const twice = settleBush(
      settleBush(b, 1000 + EACH + 3, 6, EACH, PAUSE),
      1000 + EACH * 2 + 5,
      6,
      EACH,
      PAUSE,
    );
    expect(twice).toEqual(once);
    expect(once.stock).toBe(4);
  });
});

describe('offline', () => {
  it('catches up with the same regrow as playing: the pace over an hour is that of the formula', () => {
    const online = genin();
    go(online);
    run(online, HOUR);
    const away = genin();
    go(away);
    advanceOffline(away, HOUR, content, plainRules);
    expect(away.bank[MINT]).toBe(online.bank[MINT]);
  });

  it('refills a bush left alone for hours', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 7);
    expect(dispatch(s, { type: 'action.stop', slot: 0 }, content)).toEqual({ ok: true });
    advanceOffline(s, 8 * 60 * 60 * 1000, content, plainRules);
    expect(bush(s)).toMatchObject({ stock: SIZE, phase: null });
  });
});

describe('capacity grows with Mastery', () => {
  it('shows a full bush at the capacity of today and regrows up to it', () => {
    const s = genin();
    go(s);
    run(s, CYCLE);
    expect(dispatch(s, { type: 'action.stop', slot: 0 }, content)).toEqual({ ok: true });
    s.mastery[MINT] = { xp: xpAt(10) };
    // Mastery 10: capacity 15. The bush has 5 left and regrows toward 15, one herb per interval.
    expect(bush(s)).toMatchObject({ stock: SIZE - 1, size: K.field.stockBase + 10 });
    run(s, EACH * 3);
    expect(bush(s).stock).toBe(SIZE - 1 + 3);
    run(s, EACH * 20);
    expect(bush(s)).toMatchObject({ stock: K.field.stockBase + 10, leftMs: 0 });
  });

  it('turns a full bush into a larger full bush', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 7 + PAUSE);
    s.mastery[MINT] = { xp: xpAt(20) };
    expect(bush(s)).toMatchObject({ stock: K.field.stockBase + 20, size: K.field.stockBase + 20 });
  });
});

describe('the pace of the formulas', () => {
  it('pays a herb the pace of its level over a long session, XP per hour included', () => {
    const s = genin();
    const info = actionInfo(s, { kind: 'gather', id: MINT }, content, plainRules);
    // Mastery 1: XP per hour is the rate of the level (the average cycle is the cycle plus the pause shared by 8 herbs).
    expect((info?.xpPerHour ?? 0) / rate(1, content)).toBeCloseTo(1, 2);
  });
});

describe('save', () => {
  it('round-trips a bush byte for byte', () => {
    const s = genin();
    go(s);
    run(s, CYCLE * 3 + 77);
    const back = deserialize(serialize(s), content);
    expect(back.bushes).toEqual(s.bushes);
  });

  it('migrates a version 21 save: the carried work becomes the time spent in the pause', () => {
    const s = createState(1, content);
    s.now = 50_000;
    const raw = JSON.parse(serialize(s)) as {
      v: number;
      state: { v: number; bushes: Record<string, unknown> };
    };
    raw.v = 21;
    raw.state.v = 21;
    raw.state.bushes = {
      [MINT]: { stock: 0, size: 6, carry: 3_000_000 },
      'core:nettle': { stock: 2, size: 6, carry: 0 },
    };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(loaded.bushes[MINT]).toEqual({ stock: 0, size: 6, at: 47_000 });
    expect(loaded.bushes['core:nettle']).toEqual({ stock: 2, size: 6, at: 50_000 });
  });
});
