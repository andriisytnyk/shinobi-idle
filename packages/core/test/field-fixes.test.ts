/** Review fixes for the field and crafts stage: bush memory, aborted crafts, gear rank, selectors. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  cycleSeconds,
  actionInfo,
  advance,
  createState,
  deserialize,
  dispatch,
  listSkillActions,
  rate,
  refreshUnlocks,
  serialize,
  xpAt,
  type Command,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, setLevel, start } from './helpers.ts';

const K = content.balance.K;
const MINT = 'core:mint';
const ANTIDOTE = 'core:antidote';
const OINTMENT = 'core:tsiliushcha_maz';
const ok = (s: GameState, c: Command) => expect(dispatch(s, c, content)).toEqual({ ok: true });

describe('bush memory: stop and start does not skip the regrow', () => {
  const cycle = K.gather * 1000;

  /** Stops and restarts every 5 s (two whole cycles): nothing half-done is lost, and the bush goes on regrowing meanwhile. */
  function restartingRun(herb: string, total: number): GameState {
    const s = genin();
    while (s.now < total) {
      ok(s, start('gather', herb));
      advance(s, Math.min(5000, total - s.now), content);
      ok(s, { type: 'action.stop', slot: 0 });
    }
    return s;
  }

  it('gets no more herbs or XP per hour than uninterrupted gathering', () => {
    const honest = genin();
    ok(honest, start('gather', MINT));
    advance(honest, HOUR, content);
    const cheat = restartingRun(MINT, HOUR);
    expect(cheat.now).toBe(HOUR);
    const herbs = (s: GameState) => s.bank[MINT] ?? 0;
    expect(herbs(cheat)).toBeLessThanOrEqual(herbs(honest));
    expect(cheat.skills.herb!.xp).toBeLessThanOrEqual(honest.skills.herb!.xp);
    expect(herbs(cheat) / herbs(honest)).toBeGreaterThan(0.99);
  });

  it('keeps the regrow clock of an emptied bush while the hero is away: the pause is time, not work', () => {
    const s = genin();
    ok(s, start('gather', MINT));
    // 7 herbs empty the first bush at 17.5 s (it regrows one herb per 10 s meanwhile).
    advance(s, cycle * 7, content);
    expect(s.bushes[MINT]?.stock).toBe(0);
    expect(s.bank[MINT]).toBe(7);
    advance(s, 2000, content);
    ok(s, { type: 'action.stop', slot: 0 });
    // Away for a minute: the bush regrew whole by itself.
    advance(s, 60_000, content);
    ok(s, start('gather', MINT));
    expect(s.bushes[MINT]?.stock).toBe(K.field.stockBase + 1);
    expect(s.slots[0]?.progress).toBe(0);
    advance(s, cycle, content);
    expect(s.bank[MINT]).toBe(8);
    // Back within the pause: the time already spent counts.
    const t = genin();
    ok(t, start('gather', MINT));
    advance(t, cycle * 7, content);
    ok(t, { type: 'action.stop', slot: 0 });
    advance(t, 3000, content);
    ok(t, start('gather', MINT));
    expect(t.slots[0]?.progress).toBe(3000 * 1000);
    advance(t, K.field.regrowMs - 3000 + cycle - 1, content);
    expect(t.bank[MINT]).toBe(7);
    advance(t, 1, content);
    expect(t.bank[MINT]).toBe(8);
  });

  it('keeps each herb its own bush when switching', () => {
    const s = genin();
    setLevel(s, 'herb', 5);
    ok(s, start('gather', MINT));
    advance(s, cycle * 2, content);
    ok(s, start('gather', 'core:nettle'));
    const nettle = content.herbs.find((h) => h.id === 'core:nettle')!;
    advance(s, Math.round(cycleSeconds('gather', nettle, content) * 1000), content);
    ok(s, start('gather', MINT));
    expect(s.bushes[MINT]?.stock).toBe(K.field.stockBase + 1 - 2);
    expect(s.bushes['core:nettle']?.stock).toBe(K.field.stockBase + 1 - 1);
  });

  it('survives a save: the same continuation after load', () => {
    const s = genin();
    refreshUnlocks(s, content, true);
    ok(s, start('gather', MINT));
    advance(s, cycle * (K.field.stockBase + 1) + 1500, content);
    ok(s, { type: 'action.stop', slot: 0 });
    const back = deserialize(serialize(s), content);
    for (const x of [s, back]) {
      ok(x, start('gather', MINT));
      advance(x, 9000, content);
    }
    expect(serialize(back)).toBe(serialize(s));
  });
});

describe('a craft that cannot be made is not a completion', () => {
  it('stops without counting a cycle or spending a tonic charge', () => {
    const s = genin();
    s.bank[MINT] = 2;
    s.bank['core:water'] = 1;
    s.buffs['core:tonik_kontsentratsii'] = { skill: 'alch', charges: 40 };
    ok(s, start('craft', ANTIDOTE));
    s.bank = {};
    advance(s, K.craft * 1000, content);
    expect(s.stats.completed).toBe(0);
    expect(s.counters['actions.craft']).toBeUndefined();
    expect(s.buffs['core:tonik_kontsentratsii']?.charges).toBe(40);
    expect(s.skills.alch!.xp).toBe(0);
    expect(s.slots[0]?.action).toBeNull();
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: 'actionStopped', reason: 'requirements', missing: MINT }),
    );
  });
});

describe('training gear needs the rank of Genin', () => {
  it('refuses a student, accepts a genin', () => {
    const student = createState(1, content);
    student.currencies.ryo = 5000;
    expect(
      dispatch(student, { type: 'gear.buy', line: 'core:trenuvalni_manekeny' }, content),
    ).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    expect(student.currencies.ryo).toBe(5000);
    expect(student.gear).toEqual({});
    const g = genin();
    g.currencies.ryo = 5000;
    setLevel(g, 'tai', 10);
    ok(g, { type: 'gear.buy', line: 'core:trenuvalni_manekeny' });
  });
});

describe('selectors cover gather and craft', () => {
  it('lists the herbs, the Alchemy and the Provisions recipes by level', () => {
    const s = genin();
    const herbs = listSkillActions(s, 'herb', content);
    expect(herbs.map((a) => a.id)).toEqual(
      [...content.herbs].sort((a, b) => a.level - b.level).map((h) => h.id),
    );
    for (const skill of ['alch', 'prov'] as const) {
      const list = listSkillActions(s, skill, content);
      const recipes = content.recipes.filter((r) => r.skill === skill);
      expect(list).toHaveLength(recipes.length);
      expect(list.every((a) => a.kind === 'craft' && a.skill === skill)).toBe(true);
      expect(list.map((a) => a.level)).toEqual([...list.map((a) => a.level)].sort((a, b) => a - b));
    }
  });

  it('describes a gather: level, requirement tree, interval, XP per hour, mastery', () => {
    const s = genin();
    const info = actionInfo(s, { kind: 'gather', id: 'core:edelweiss' }, content);
    expect(info?.available).toBe(false);
    expect(info?.level).toBe(35);
    expect(info?.req?.children.length).toBeGreaterThanOrEqual(2);
    setLevel(s, 'herb', 35);
    setLevel(s, 'cc', 15);
    const ready = actionInfo(s, { kind: 'gather', id: 'core:edelweiss' }, content);
    expect(ready?.available).toBe(true);
    const edelweiss = content.herbs.find((h) => h.id === 'core:edelweiss')!;
    expect(ready?.intervalMs).toBe(Math.round(cycleSeconds('gather', edelweiss, content) * 1000));
    // At mastery 1 the bush holds the first size, the one the XP of a gather is set against.
    expect((ready?.xpPerHour ?? 0) / rate(35, content)).toBeCloseTo(1, 4);
    expect(ready?.xpPerCycle).toBe(edelweiss.xp);
    expect(ready?.masteryLevel).toBe(1);
    expect(ready?.inputs).toEqual([]);
  });

  it('describes a craft: missing ingredients are item requirements, inputs and outputs listed', () => {
    const s = genin();
    setLevel(s, 'alch', 5);
    const bare = actionInfo(s, { kind: 'craft', id: OINTMENT }, content);
    expect(bare?.available).toBe(false);
    const leaves = bare?.req?.children.map((c) => c.req.t) ?? [];
    expect(leaves).toContain('item');
    expect(bare?.inputs).toEqual([
      { item: 'core:nettle', n: 2, have: 0 },
      { item: 'core:oil', n: 1, have: 0 },
    ]);
    expect(bare?.outputs).toEqual([{ item: OINTMENT, n: 2 }]);
    s.bank['core:nettle'] = 2;
    s.bank['core:oil'] = 1;
    const ready = actionInfo(s, { kind: 'craft', id: OINTMENT }, content);
    expect(ready?.available).toBe(true);
    expect(ready?.intervalMs).toBe(K.craft * 1000);
    expect((ready?.xpPerHour ?? 0) / (rate(5, content) * K.craftXpMult)).toBeCloseTo(1, 4);
    expect(ready?.inputs.map((i) => i.have)).toEqual([2, 1]);
  });

  // The XP of a gather is fixed against a first-size bush, while the bush grows with mastery, so its regrow pause is
  // shared among more herbs and an hour pays more: the accepted mastery benefit of gathering, measured in the
  // balance model ("Темп дії"): mint 1.00x at mastery 1, about 1.25x at 25, 1.29x at 50, 1.31x at 99. The band is
  // that measurement; a change of it is a change of the model, to be decided and written there.
  for (const [mastery, low, high] of [
    [1, 1.0, 1.25],
    [25, 1.2, 1.3],
    [99, 1.25, 1.35],
  ] as const) {
    it(`XP per hour of a gather at mastery ${mastery} is the model's rate times the mastery benefit`, () => {
      const s = genin();
      s.mastery[MINT] = { xp: xpAt(mastery) };
      ok(s, start('gather', MINT));
      advance(s, HOUR, content);
      const ratio =
        s.skills.herb!.xp / rate(content.herbs.find((h) => h.id === MINT)!.level, content);
      expect(ratio).toBeGreaterThan(low);
      expect(ratio).toBeLessThan(high);
    });
  }
});
