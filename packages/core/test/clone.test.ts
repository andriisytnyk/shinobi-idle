/**
 * Shadow clones, redesigned (docs: правки зрізу, розділ 5, рядок 19): a clone is a burst you pay for.
 * Life by chakra, knowledge passed on dispel, mind fatigue, the clone's own pouch, death without a retry,
 * the same action in several performers, saving and telemetry. Fights are in clone-fights.test.ts.
 */
import { composeContent, content, corePack, type ContentPack } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actingPerformer,
  addRule,
  asPerformer,
  advance,
  composeRules,
  wrapRule,
  type Rules,
  chakraDivisor,
  cloneSlots,
  cloneTelemetry,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  dispelPreview,
  fatigueLeftMs,
  growSlots,
  isCloneSlot,
  lifeLeftMs,
  LIFE_FULL,
  serialize,
  slotCount,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { player } from './missions-helpers.ts';

const CLONE = 'core:shadow_clone';
const SCROLL = 'core:scroll_shadow_clone';
const MINT = 'core:mint';
const WATER = 'core:water';
const ANTIDOTE = 'core:antidote';
const HOUR = 3_600_000;
const MIN = 60_000;

/** A genin at level 50 in the skills the tests use, who knows the clone technique (the second slot is open). */
export function cloner(seed = 1, extra: Record<string, number> = {}): GameState {
  const state = player({
    seed,
    natures: ['katon'],
    levels: { nin: 50, med: 40, cc: 40, herb: 20, alch: 20, prov: 20, katon: 20 },
    known: [CLONE],
    bank: { [MINT]: 5000, [WATER]: 5000, 'core:rice': 5000, 'core:salt': 5000, ...extra },
  });
  growSlots(state, content);
  state.events = [];
  return state;
}

const drills = (): string[] => content.exercises.filter((e) => e.level <= 30).map((e) => e.id);
const drill = (): string => drills()[0] ?? '';
const drill2 = (): string => drills()[1] ?? '';
const start = (state: GameState, slot: number, kind: string, id: string) =>
  dispatch(state, { type: 'action.start', slot, kind, id }, content);
const create = (state: GameState, items?: Record<string, number>) =>
  dispatch(state, { type: 'clone.create', ...(items ? { items } : {}) }, content);
const dispel = (state: GameState, slot?: number) =>
  dispatch(state, { type: 'clone.dispel', ...(slot === undefined ? {} : { slot }) }, content);
const xpSum = (state: GameState): number =>
  Object.values(state.skills).reduce((sum, s) => sum + s.xp, 0);
const heldXp = (state: GameState, slot = 1): number =>
  Object.values(state.clones[slot]?.xp ?? {}).reduce((a, b) => a + b, 0);

describe('the clone slot', () => {
  it('opens when the player learns the technique, by the data of the technique', () => {
    const state = player({ seed: 3, base: 50, natures: ['katon'], known: [] });
    delete state.known[CLONE];
    state.bank[SCROLL] = 1;
    expect(state.slots.length).toBe(1);
    expect(slotCount(state, content)).toBe(1);
    expect(create(state)).toEqual({ ok: false, reason: 'error.noCloneTechnique' });
    expect(dispatch(state, { type: 'item.use', id: SCROLL }, content)).toEqual({ ok: true });
    expect(state.known[CLONE]).toBe(true);
    expect(state.slots.length).toBe(2);
    expect(cloneSlots(state, content)).toEqual([{ slot: 1, technique: CLONE }]);
    expect(isCloneSlot(state, content, 1)).toBe(true);
    expect(isCloneSlot(state, content, 0)).toBe(false);
  });
});

describe('making a clone', () => {
  it('takes a share of the chakra pool and the pouch it is given from the Bank, and stands where the character stands', () => {
    const state = cloner();
    const rice = state.bank['core:rice'] ?? 0;
    expect(chakraDivisor(state, content)).toBe(1);
    expect(create(state, { 'core:rice': 100 })).toEqual({ ok: true });
    expect(chakraDivisor(state, content)).toBe(2);
    expect(state.bank['core:rice']).toBe(rice - 100);
    const body = state.clones[1];
    expect(body?.bag).toEqual({ 'core:rice': 100 });
    expect(body?.life).toBe(LIFE_FULL);
    expect(body?.max).toBeGreaterThan(0);
    expect(state.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
    expect(state.world.figures?.[1]).toBe(state.world.location);
    expect(state.events.some((e) => e.type === 'cloneMade')).toBe(true);
    // One clone only per slot.
    expect(create(state)).toEqual({ ok: false, reason: 'error.cloneExists' });
  });

  it('refuses a pick the Bank cannot give', () => {
    const state = cloner();
    expect(create(state, { 'core:rice': 1e9 })).toEqual({ ok: false, reason: 'error.noItem' });
    expect(create(state, { 'core:not_an_item': 1 })).toEqual({ ok: false, reason: 'error.noItem' });
    expect(state.clones[1]).toBeUndefined();
  });

  it('is made by an action started in its slot, with the default pouch', () => {
    const state = cloner();
    expect(start(state, 1, 'drill', drill())).toEqual({ ok: true });
    expect(state.clones[1]).toBeDefined();
    expect(state.slots[1]?.action).toEqual({ kind: 'drill', id: drill() });
  });
});

describe('every performer works at full speed', () => {
  it('has no shared speed pool: the character and the clone each run at 1000', () => {
    const state = cloner();
    start(state, 0, 'drill', drill());
    start(state, 1, 'drill', drill2());
    expect(state.slots.map((s) => s.share)).toEqual([1000, 1000]);
    // The character gets what it gets alone: the clone's XP is held, not shared.
    const alone = cloner();
    start(alone, 0, 'drill', drill());
    advance(alone, 20 * MIN, content);
    advance(state, 20 * MIN, content);
    expect(xpSum(state)).toBeCloseTo(xpSum(alone), 6);
    expect(heldXp(state)).toBeGreaterThan(0);
    expect(state.stats.completed).toBeGreaterThan(alone.stats.completed);
  });
});

describe('the life of a clone', () => {
  it('spends its chakra: standing costs little, work costs more, and it is dispelled at 0', () => {
    const idle = cloner();
    create(idle);
    const busy = cloner();
    start(busy, 1, 'drill', drill());
    advance(idle, HOUR, content);
    advance(busy, HOUR, content);
    expect(idle.clones[1]?.life ?? 0).toBeGreaterThan(busy.clones[1]?.life ?? 0);
    expect(busy.clones[1]?.life).toBeGreaterThan(0);
    // The time it has left is what the data says: the seconds of its kind, longer by Meditation and Mastery.
    const left = lifeLeftMs(busy, 1, content, defaultRules);
    expect(left).toBeGreaterThan(0);
    advance(busy, left + 1000, content);
    expect(busy.clones[1]).toBeUndefined();
    expect(busy.slots[1]?.action).toBeNull();
    expect(busy.world.figures).toBeUndefined();
    const ended = busy.events.find((e) => e.type === 'cloneDispelled');
    expect(ended).toMatchObject({ type: 'cloneDispelled', slot: 1, cause: 'life' });
    expect(chakraDivisor(busy, content)).toBe(1);
  });

  it('costs more for a technique than for a drill, and the most for a fight', () => {
    const K = content.balance.K.clone.life;
    expect(K.stand ?? 0).toBeGreaterThan(K['default'] ?? 0);
    expect(K['default'] ?? 0).toBeGreaterThan(K.practice ?? 0);
    expect(K.practice ?? 0).toBeGreaterThan(K.fight ?? 0);
  });

  it('lasts longer with the level of Meditation and the Mastery of the technique', () => {
    const base = cloner();
    start(base, 1, 'drill', drill());
    const calm = cloner();
    calm.skills.med!.xp = xpAt(90);
    start(calm, 1, 'drill', drill());
    const master = cloner();
    master.mastery[CLONE] = { xp: xpAt(60) };
    start(master, 1, 'drill', drill());
    const t = (s: GameState) => lifeLeftMs(s, 1, content, defaultRules);
    expect(t(calm)).toBeGreaterThan(t(base));
    expect(t(master)).toBeGreaterThan(t(base));
  });

  it('gives the same state however the time is cut', () => {
    const run = (chunk: number): string => {
      const s = cloner(4);
      create(s, { 'core:rice': 50 });
      start(s, 1, 'drill', drill());
      start(s, 0, 'drill', drill2());
      for (let t = 0; t < 4 * HOUR; t += chunk) advance(s, Math.min(chunk, 4 * HOUR - t), content);
      return serialize(s);
    };
    const whole = run(4 * HOUR);
    for (const chunk of [1000, 7001, 999_999]) expect(run(chunk)).toBe(whole);
    expect(whole).toContain('"clones":{}');
  });
});

describe('knowledge stays in the clone until it is dispelled', () => {
  it('keeps XP and Mastery in the clone while it works, and the same action runs in two performers', () => {
    const state = cloner();
    expect(start(state, 0, 'drill', drill())).toEqual({ ok: true });
    // No "one action, one performer" for a clone: the very same drill runs in both.
    expect(start(state, 1, 'drill', drill())).toEqual({ ok: true });
    const before = xpSum(state);
    advance(state, 10 * MIN, content);
    // What the character earned itself is in its skills; what the clone earned is held.
    const own = xpSum(state) - before;
    expect(heldXp(state)).toBeGreaterThan(0);
    const solo = cloner();
    start(solo, 0, 'drill', drill());
    advance(solo, 10 * MIN, content);
    expect(own).toBeCloseTo(xpSum(solo) - xpSum(cloner()), 6);
    expect(heldXp(state)).toBeCloseTo(own, 6);
  });

  it('hands over what the clone knows when it is dispelled by hand, and leaves fatigue', () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    advance(state, 30 * MIN, content);
    const held = heldXp(state);
    const preview = dispelPreview(state, 1, content, defaultRules);
    expect(preview?.fatigueMs).toBeGreaterThan(0);
    const before = xpSum(state);
    expect(dispel(state)).toEqual({ ok: true });
    expect(xpSum(state) - before).toBeCloseTo(held, 6);
    expect(state.clones[1]).toBeUndefined();
    expect(state.fatigue).toBeGreaterThan(0);
    expect(state.events.find((e) => e.type === 'cloneDispelled')).toMatchObject({
      cause: 'manual',
    });
    expect(dispel(state)).toEqual({ ok: false, reason: 'error.noClone' });
  });

  it('hands over what the clone knows when its chakra runs out', () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    const before = xpSum(state);
    advance(state, 6 * HOUR, content);
    expect(state.clones[1]).toBeUndefined();
    expect(xpSum(state)).toBeGreaterThan(before);
    const ended = state.events.find((e) => e.type === 'cloneDispelled');
    expect(ended).toMatchObject({ cause: 'life' });
    expect(ended?.type === 'cloneDispelled' ? ended.fatigueMs : 0).toBeGreaterThan(0);
  });

  it('a stop of the action lets the clone stand, a second stop dispels it', () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    advance(state, 5 * MIN, content);
    dispatch(state, { type: 'action.stop', slot: 1 }, content);
    expect(state.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
    expect(state.clones[1]).toBeDefined();
    dispatch(state, { type: 'action.stop', slot: 1 }, content);
    expect(state.clones[1]).toBeUndefined();
  });
});

describe('mind fatigue', () => {
  function tired(): GameState {
    const state = cloner();
    start(state, 1, 'drill', drill());
    advance(state, 30 * MIN, content);
    dispel(state);
    return state;
  }

  it('is proportional to the knowledge passed on, and capped', () => {
    const short = cloner();
    start(short, 1, 'drill', drill());
    advance(short, 10 * MIN, content);
    dispel(short);
    const long = cloner();
    start(long, 1, 'drill', drill());
    advance(long, 40 * MIN, content);
    dispel(long);
    expect(long.fatigue).toBeGreaterThan(short.fatigue * 3);
    const K = content.balance.K.clone.fatigue;
    expect(long.fatigue).toBeLessThanOrEqual(K.maxMs * 1000);
  });

  it('blocks a new clone while it lasts, and lets one be made after', () => {
    const state = tired();
    expect(create(state)).toEqual({ ok: false, reason: 'error.cloneFatigued' });
    expect(start(state, 1, 'drill', drill())).toEqual({ ok: false, reason: 'error.cloneFatigued' });
    expect(state.clones[1]).toBeUndefined();
    advance(state, fatigueLeftMs(state, content, defaultRules) + 1000, content);
    expect(state.fatigue).toBe(0);
    expect(create(state)).toEqual({ ok: true });
  });

  it('slows the character, and only the character', () => {
    const run = (fatigue: number): { own: number; held: number } => {
      const state = cloner();
      state.fatigue = fatigue;
      start(state, 0, 'drill', drill());
      // The clone is made before the tired mind (a clone of an earlier hour), so it works at its own speed.
      state.fatigue = 0;
      start(state, 1, 'drill', drill2());
      state.fatigue = fatigue;
      const base = xpSum(state);
      advance(state, 20 * MIN, content);
      return { own: xpSum(state) - base, held: heldXp(state) };
    };
    const rested = run(0);
    const worn = run(3_600_000 * 1000);
    expect(worn.own).toBeLessThan(rested.own);
    expect(worn.held).toBeCloseTo(rested.held, 6);
  });

  it('is cleared faster by Meditation', () => {
    const left = (med: number): number => {
      const state = cloner();
      state.skills.med!.xp = xpAt(med);
      state.fatigue = 3_600_000 * 1000;
      advance(state, 20 * MIN, content);
      return state.fatigue;
    };
    expect(left(90)).toBeLessThan(left(1));
  });
});

describe('the pouch of a clone', () => {
  it('has no access to the Bank: an action that needs ingredients works only with what the clone carries', () => {
    const state = cloner();
    // The Bank holds plenty of mint and water, but the clone carries none.
    expect(start(state, 1, 'craft', ANTIDOTE).ok).toBe(false);
    expect(state.clones[1]).toBeUndefined();
    expect(create(state, { [MINT]: 3, [WATER]: 2 })).toEqual({ ok: true });
    expect(start(state, 1, 'craft', ANTIDOTE)).toEqual({ ok: true });
    const bank = { ...state.bank };
    advance(state, 20 * MIN, content);
    // It used its own stock; the Bank was not touched.
    expect(state.bank).toEqual(bank);
    expect(state.clones[1]?.bag[MINT] ?? 0).toBeLessThan(3);
    expect(state.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
  });

  it('puts what it made, and what is left, in the Bank when it is dispelled', () => {
    const state = cloner();
    create(state, { [MINT]: 3, [WATER]: 2 });
    start(state, 1, 'craft', ANTIDOTE);
    advance(state, 20 * MIN, content);
    const made = state.clones[1]?.bag[ANTIDOTE] ?? 0;
    expect(made).toBeGreaterThan(0);
    expect(state.bank[ANTIDOTE] ?? 0).toBe(0);
    const mint = state.bank[MINT] ?? 0;
    const left = state.clones[1]?.bag[MINT] ?? 0;
    dispel(state);
    expect(state.bank[ANTIDOTE]).toBe(made);
    expect(state.bank[MINT]).toBe(mint + left);
  });

  it('gathers into its own bag', () => {
    const state = cloner();
    const herb = content.herbs[0]?.id ?? '';
    expect(start(state, 1, 'gather', herb)).toEqual({ ok: true });
    const bank = state.bank[herb] ?? 0;
    advance(state, 10 * MIN, content);
    expect(state.bank[herb] ?? 0).toBe(bank);
    expect(state.clones[1]?.bag[herb] ?? 0).toBeGreaterThan(0);
    dispel(state);
    expect(state.bank[herb] ?? 0).toBeGreaterThan(bank);
  });
});

describe('saving', () => {
  it('round-trips a clone with its bag, its knowledge and the fatigue', () => {
    const state = cloner();
    create(state, { 'core:rice': 10 });
    start(state, 1, 'drill', drill());
    advance(state, 12 * MIN, content);
    state.fatigue = 123_456;
    const back = deserialize(serialize(state), content);
    expect(serialize(back)).toBe(serialize(state));
    expect(back.clones[1]?.bag).toEqual({ 'core:rice': 10 });
    expect(heldXp(back)).toBeCloseTo(heldXp(state), 6);
    expect(back.fatigue).toBe(123_456);
  });

  it('drops a clone slot with no clone, and a clone body of a slot that is not there', () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    const raw = JSON.parse(serialize(state)) as { state: Record<string, unknown> };
    const clones = raw.state.clones as Record<string, unknown>;
    clones['5'] = clones['1'];
    delete clones['1'];
    const back = deserialize(JSON.stringify(raw), content);
    expect(back.clones).toEqual({});
    expect(back.slots[1]?.action).toBeNull();
  });

  it('cleans a doctored body', () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    const raw = JSON.parse(serialize(state)) as {
      state: { clones: Record<string, Record<string, unknown>> };
    };
    const body = raw.state.clones['1'] as Record<string, unknown>;
    body.life = 1e30;
    body.xp = { 'core:ghost': 5, tai: -3, nin: 1e30 };
    body.bag = { 'core:ghost': 5, 'core:rice': -2, 'core:mint': 1.5 };
    const back = deserialize(JSON.stringify(raw), content);
    expect(back.clones[1]?.life).toBeLessThanOrEqual(LIFE_FULL);
    expect(Object.keys(back.clones[1]?.xp ?? {})).toEqual(['nin']);
    expect(back.clones[1]?.xp.nin).toBeLessThanOrEqual(1e15);
    expect(back.clones[1]?.bag).toEqual({});
  });

  it('is on the version of the redesign', () => {
    expect(createState(1, content).v).toBe(21);
  });
});

describe('telemetry', () => {
  it('counts how long a clone existed against the time the technique was known', () => {
    const state = cloner();
    advance(state, HOUR, content);
    expect(cloneTelemetry(state).runMs).toBe(0);
    create(state);
    advance(state, HOUR, content);
    const t = cloneTelemetry(state);
    expect(t.openMs).toBe(2 * HOUR);
    expect(t.runMs).toBe(HOUR);
    expect(t.share).toBeCloseTo(0.5, 6);
  });
});

describe("the character's tonics and the clone", () => {
  const TONIC = 'core:tonik_iasnoho_rozumu';
  const practice = (): string => content.practices[0]?.id ?? '';

  function meditate(tonic: boolean): GameState {
    const state = cloner(3, { [TONIC]: 1 });
    if (tonic) expect(dispatch(state, { type: 'item.use', id: TONIC }, content).ok).toBe(true);
    expect(start(state, 1, 'meditate', practice()).ok).toBe(true);
    advance(state, 10 * MIN, content);
    return state;
  }

  it('does not spend the charges of the tonic the character drank, and gets no bonus from it', () => {
    const drank = meditate(true);
    const plain = meditate(false);
    const charges = drank.buffs[TONIC]?.charges ?? 0;
    expect(charges).toBeGreaterThan(0);
    // Nothing was spent by the clone: the full charges are still there.
    expect(Object.keys(drank.buffs)).toEqual([TONIC]);
    const left = meditate(true);
    expect(left.buffs[TONIC]?.charges).toBe(charges);
    expect(heldXp(drank)).toBeCloseTo(heldXp(plain), 6);
    expect(heldXp(drank)).toBeGreaterThan(0);
  });

  it('still lets the character spend and use them in its own action', () => {
    const state = cloner(3, { [TONIC]: 1 });
    dispatch(state, { type: 'item.use', id: TONIC }, content);
    const full = state.buffs[TONIC]?.charges ?? 0;
    expect(start(state, 0, 'meditate', practice()).ok).toBe(true);
    advance(state, 10 * MIN, content);
    expect(state.buffs[TONIC]?.charges ?? 0).toBeLessThan(full);
  });
});

describe('what the character cannot take', () => {
  it('holds no XP the level cap would throw away, and charges no fatigue for it', () => {
    const state = cloner();
    const skill = defaultRules.actionKinds.drill?.skill?.(drill(), content) ?? '';
    const cap = xpAt(content.balance.K.cap);
    const entry = state.skills[skill];
    if (!entry) throw new Error(`no skill ${skill}`);
    entry.xp = cap - 100;
    expect(start(state, 1, 'drill', drill()).ok).toBe(true);
    advance(state, HOUR, content);
    expect(state.clones[1]?.xp[skill]).toBeLessThanOrEqual(100);
    const preview = dispelPreview(state, 1, content, defaultRules);
    expect(preview?.xp[skill]).toBeLessThanOrEqual(100);
    expect(dispel(state).ok).toBe(true);
    expect(state.skills[skill]?.xp).toBe(cap);
    // 100 XP is a few seconds of work, not an hour.
    expect(fatigueLeftMs(state, content, defaultRules)).toBeLessThan(5 * MIN);
  });

  it('shows what is paid at the dispel', () => {
    const state = cloner();
    expect(start(state, 1, 'drill', drill()).ok).toBe(true);
    advance(state, 10 * MIN, content);
    const preview = dispelPreview(state, 1, content, defaultRules);
    const before = Object.values(state.skills).reduce((a, k) => a + k.xp, 0);
    const held = Object.values(preview?.xp ?? {}).reduce((a, b) => a + b, 0);
    expect(dispel(state).ok).toBe(true);
    const after = Object.values(state.skills).reduce((a, k) => a + k.xp, 0);
    expect(after - before).toBeCloseTo(held, 6);
  });
});

describe('a clone that meditates', () => {
  it('holds its Insights and Enlightenments with its knowledge and hands them over on the dispel', () => {
    const state = cloner(5);
    const practice = content.practices[0]?.id ?? '';
    expect(start(state, 1, 'meditate', practice).ok).toBe(true);
    // Chances are small: run until the clone has found something (and stop before its life ends).
    for (let i = 0; i < 40 && !state.clones[1]?.insight; i++) advance(state, 10 * MIN, content);
    const held = state.clones[1]?.insight?.[practice];
    expect(held).toBeDefined();
    expect(state.meditation[practice]?.insight ?? 0).toBe(0);
    expect(state.meditation[practice]?.enlight ?? 0).toBe(0);
    // It survives a save.
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.clones[1]?.insight).toEqual(state.clones[1]?.insight);
    expect(dispel(state).ok).toBe(true);
    expect(state.meditation[practice]?.insight ?? 0).toBe(held?.insight);
    expect(state.meditation[practice]?.enlight ?? 0).toBe(held?.enlight);
  });
});

describe('asPerformer nests', () => {
  it('puts back the outer swap when the inner call is on another state', () => {
    const a = cloner(4);
    create(a, { 'core:rice': 7 });
    const b = cloner(5);
    const bank = a.bank;
    const buffs = a.buffs;
    asPerformer(a, 1, () => {
      expect(a.bank['core:rice']).toBe(7);
      asPerformer(b, 0, () => undefined);
      asPerformer(b, 1, () => undefined);
      expect(a.bank['core:rice']).toBe(7);
      expect(actingPerformer()).toBe(1);
    });
    expect(a.bank).toBe(bank);
    expect(a.buffs).toBe(buffs);
    expect(a.bank['core:rice']).toBe(4993);
    expect(actingPerformer()).toBe(0);
  });
});

describe('a pack and the uniqueness of an action', () => {
  const HEX = 'core:rysovi_polia';
  const pack = (fn: (rules: Rules) => Rules): ContentPack => ({
    manifest: { id: 'uniq', version: '1', dependsOn: ['core'], loadAfter: [] },
    data: {},
    balance: {},
    locales: { uk: {} },
    icons: {},
    patches: [],
    rules: fn as unknown as ContentPack['rules'],
  });
  const compose = (fn: (rules: Rules) => Rules): Rules => {
    const p = pack(fn);
    return composeRules(defaultRules, [corePack, p], composeContent([corePack, p]));
  };
  const explore = (state: GameState, slot: number, rules: Rules) =>
    dispatch(state, { type: 'action.start', slot, kind: 'explore', id: HEX }, content, rules);

  it('keeps `unique` on a core kind a pack wraps: the same hex is not explored by two performers', () => {
    const rules = compose((r) => wrapRule(r, 'actionKinds', 'explore', (k) => ({ ...k })));
    expect(rules.actionKinds.explore).not.toBe(defaultRules.actionKinds.explore);
    expect(rules.actionKinds.explore?.unique?.(HEX, content)).toBe(true);
    const state = cloner();
    // The cell is three hexes from the start: the range at Scouting 30.
    state.skills.scout!.xp = xpAt(30);
    expect(explore(state, 1, rules)).toEqual({ ok: true });
    expect(explore(state, 0, rules)).toEqual({ ok: false, reason: 'error.sameActionElsewhere' });
  });

  it('keeps `unique` on a kind of the pack itself, and a throwing `unique` means not unique', () => {
    const base = defaultRules.actionKinds.explore;
    if (!base) throw new Error('explore');
    const rules = compose((r) =>
      addRule(
        addRule(r, 'actionKinds', 'uniq:one', { ...base, unique: () => true }),
        'actionKinds',
        'uniq:bad',
        {
          ...base,
          unique: () => {
            throw new Error('boom');
          },
        },
      ),
    );
    expect(rules.actionKinds['uniq:one']?.unique?.(HEX, content)).toBe(true);
    expect(rules.actionKinds['uniq:bad']?.unique?.(HEX, content)).toBe(false);
  });
});
