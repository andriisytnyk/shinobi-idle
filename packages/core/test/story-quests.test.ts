/** The story chains of the slice: payments, summed counters, opened flags, the two-part Chunin exam and the data the chains rest on. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  conferralSeconds,
  counterValue,
  depositFlag,
  dispatch,
  evalReq,
  examFor,
  examWrittenFlag,
  killsKey,
  payKey,
  poiFlag,
  regionFlag,
  senseiTestSeconds,
  updateQuests,
  writtenPassed,
  xpAt,
  type GameState,
  type Req,
} from '../src/index.ts';
import { genin } from './helpers.ts';

const quest = (id: string) => {
  const found = content.quests.find((q) => q.id === id);
  if (!found) throw new Error(`no quest ${id}`);
  return found;
};
const intel = content.currencies.find((c) => c.role === 'study')?.id ?? '';
const renown = content.currencies.find((c) => c.role === 'renown')?.id ?? '';

/** A genin with the earlier chains of the story behind them, so that `id` has started. */
function atChain(id: string, step: number): GameState {
  const state = genin(5);
  const finish = (q: string) => {
    state.quests[q] = { step: quest(q).steps.length, base: 0, done: true };
  };
  if (id !== 'core:mission_board') finish('core:mission_board');
  if (id === 'core:grey_bands' || id === 'core:name_on_stone') finish('core:border_wolves');
  if (id === 'core:name_on_stone') finish('core:grey_bands');
  updateQuests(state, content);
  state.quests[id] = { step, base: 0, done: false };
  state.events = [];
  return state;
}

describe('a payment step', () => {
  // «Вовки», step 2: track the gang for Intel.
  const wolves = () => atChain('core:border_wolves', 1);
  const cost = (quest('core:border_wolves').steps[1]?.objective as { n: number }).n;

  it('takes the Intel and finishes the step', () => {
    const state = wolves();
    state.currencies[intel] = cost + 2;
    expect(dispatch(state, { type: 'quest.pay', quest: 'core:border_wolves' }, content).ok).toBe(
      true,
    );
    expect(state.currencies[intel]).toBe(2);
    expect(state.quests['core:border_wolves']?.step).toBe(2);
    expect(state.counters[payKey('core:border_wolves', 1)]).toBe(1);
  });

  it('refuses without the Intel and changes nothing', () => {
    const state = wolves();
    state.currencies[intel] = cost - 1;
    const result = dispatch(state, { type: 'quest.pay', quest: 'core:border_wolves' }, content);
    expect(result).toEqual({ ok: false, reason: 'error.questCannotPay' });
    expect(state.currencies[intel]).toBe(cost - 1);
    expect(state.quests['core:border_wolves']?.step).toBe(1);
  });

  it('refuses on a step that asks for something else, on a chain that is not under way and on nonsense', () => {
    const wrongStep = atChain('core:border_wolves', 2);
    wrongStep.currencies[intel] = 50;
    expect(
      dispatch(wrongStep, { type: 'quest.pay', quest: 'core:border_wolves' }, content),
    ).toEqual({
      ok: false,
      reason: 'error.questNoPayment',
    });
    const notStarted = genin(6);
    notStarted.currencies[intel] = 50;
    expect(dispatch(notStarted, { type: 'quest.pay', quest: 'core:grey_bands' }, content)).toEqual({
      ok: false,
      reason: 'error.questNotActive',
    });
    expect(dispatch(notStarted, { type: 'quest.pay', quest: 7 as never }, content).ok).toBe(false);
    expect(notStarted.currencies[intel]).toBe(50);
  });

  it('pays only once: the step after it is not a payment, and a finished chain is closed', () => {
    const state = wolves();
    state.currencies[intel] = cost * 3;
    dispatch(state, { type: 'quest.pay', quest: 'core:border_wolves' }, content);
    expect(dispatch(state, { type: 'quest.pay', quest: 'core:border_wolves' }, content).ok).toBe(
      false,
    );
    expect(state.currencies[intel]).toBe(cost * 2);
  });
});

describe('a counter that adds up several counters', () => {
  // «Ім'я на камені», step 3: the beasts and mercenaries of the Forest of Death.
  const objective = quest('core:name_on_stone').steps[2]?.objective;
  const keys = objective?.t === 'counter' ? [objective.counter, ...(objective.also ?? [])] : [];

  it('names the three enemies of the Forest day pool', () => {
    const pool = content.operations
      .find((o) => o.id === 'core:op_forest_of_death')
      ?.stages.flatMap((s) => (s.t === 'days' ? s.pool : []));
    expect(keys.sort()).toEqual((pool ?? []).map(killsKey).sort());
  });

  it('counts only what is killed after the step became the active one', () => {
    const state = atChain('core:name_on_stone', 1);
    // Kills of an earlier time (zone fights in the exam region) do not count.
    state.counters[keys[0] ?? ''] = 40;
    state.flags[examWrittenFlag(content.exams.find((e) => e.id === 'core:chunin_exam')!)] = true;
    updateQuests(state, content);
    expect(state.quests['core:name_on_stone']?.step).toBe(2);
    expect(state.quests['core:name_on_stone']?.base).toBe(40);
    const n = objective?.t === 'counter' ? objective.n : 0;
    for (let i = 0; i < n - 1; i++)
      state.counters[keys[i % keys.length] ?? ''] =
        (state.counters[keys[i % keys.length] ?? ''] ?? 0) + 1;
    updateQuests(state, content);
    expect(state.quests['core:name_on_stone']?.step).toBe(2);
    state.counters[keys[2] ?? ''] = (state.counters[keys[2] ?? ''] ?? 0) + 1;
    updateQuests(state, content);
    expect(state.quests['core:name_on_stone']?.step).toBe(3);
  });
});

describe('what a step opens', () => {
  it('raises the flags when the step becomes active, not before, and keeps them', () => {
    const state = atChain('core:name_on_stone', 1);
    expect(state.flags['region.exam.unlocked']).toBeUndefined();
    expect(state.flags['op.forest_of_death.unlocked']).toBeUndefined();
    state.flags[examWrittenFlag(content.exams.find((e) => e.id === 'core:chunin_exam')!)] = true;
    updateQuests(state, content);
    expect(state.flags['region.exam.unlocked']).toBe(true);
    expect(state.flags['op.forest_of_death.unlocked']).toBe(true);
    // The Nameless and the tournament are still shut.
    expect(state.flags['boss.nameless.unlocked']).toBeUndefined();
    expect(state.flags['op.tournament.unlocked']).toBeUndefined();
  });

  it('restores them for a chain that was under way before the step had its flags', () => {
    const state = atChain('core:name_on_stone', 3);
    delete state.flags['boss.nameless.unlocked'];
    updateQuests(state, content);
    expect(state.flags['boss.nameless.unlocked']).toBe(true);
    // A step the chain has not reached opens nothing yet.
    expect(state.flags['op.tournament.unlocked']).toBeUndefined();
  });

  it('opens the C missions with the last step of «Вовки»', () => {
    const state = atChain('core:border_wolves', 5);
    updateQuests(state, content);
    expect(state.flags['missions.c.unlocked']).toBeUndefined();
    expect(state.flags['boss.wolf.unlocked']).toBe(true);
    state.counters[killsKey('core:boss_wolf')] = 1;
    updateQuests(state, content);
    expect(state.quests['core:border_wolves']?.done).toBe(true);
    expect(state.flags['missions.c.unlocked']).toBe(true);
  });
});

describe('a requirement on a currency', () => {
  it('holds from the amount on and names no currency that does not exist', () => {
    const state = genin(2);
    const req: Req = { t: 'currency', role: 'renown', n: 300 };
    state.currencies[renown] = 299;
    expect(evalReq(state, req, content)).toMatchObject({ met: false, current: 299, target: 300 });
    state.currencies[renown] = 300;
    expect(evalReq(state, req, content).met).toBe(true);
    expect(evalReq(state, { t: 'currency', role: 'nope', n: 1 }, content).met).toBe(false);
  });
});

describe('the Chunin exam, taken in two parts', () => {
  const exam = examFor(content, 'chunin');
  if (!exam) throw new Error('no Chunin exam');

  /** A genin who meets the checklist. */
  function ready(): GameState {
    const state = genin(8);
    for (const skill of ['vit', 'tai', 'scout', 'ath'] as const) state.skills[skill]!.xp = xpAt(45);
    state.currencies[renown] = 300;
    return state;
  }
  const start = (state: GameState) =>
    dispatch(state, { type: 'exam.start', rank: 'chunin' }, content);

  it('refuses before the checklist is met, one requirement at a time', () => {
    const state = ready();
    expect(start(state).ok).toBe(true);
    for (const undo of [
      (s: GameState) => (s.currencies[renown] = 299),
      (s: GameState) => (s.skills.scout!.xp = xpAt(19)),
      (s: GameState) => (s.skills.ath!.xp = xpAt(24)),
      (s: GameState) => (s.skills.vit!.xp = xpAt(39)),
    ]) {
      const s = ready();
      undo(s);
      const result = start(s);
      expect(result.ok).toBe(false);
      expect(s.slots[0]?.action).toBeNull();
    }
    // A style skill at 40 is enough, whichever it is; without any, the checklist fails.
    const noStyle = ready();
    noStyle.skills.tai!.xp = xpAt(39);
    expect(start(noStyle).ok).toBe(false);
    noStyle.skills.nin!.xp = xpAt(40);
    expect(start(noStyle).ok).toBe(true);
  });

  it('passes the written test without the rank, and confers the rank after the rest', () => {
    const state = ready();
    expect(start(state).ok).toBe(true);
    advance(state, 10 * 60_000, content);
    expect(writtenPassed(state, exam)).toBe(true);
    expect(state.player.rank).toBe('genin');
    expect(state.events.some((e) => e.type === 'examPassed')).toBe(true);
    expect(state.bank['core:chunin_vest']).toBeUndefined();
    // The rest of the exam (the whole chain) is not done: the same command is refused.
    expect(start(state).ok).toBe(false);
    state.quests['core:name_on_stone'] = { step: 6, base: 0, done: true };
    expect(start(state).ok).toBe(true);
    advance(state, 10 * 60_000, content);
    expect(state.player.rank).toBe('chunin');
    expect(state.bank['core:chunin_vest']).toBe(1);
    expect(state.events.some((e) => e.type === 'rankUp' && e.rank === 'chunin')).toBe(true);
    // The exam pays once.
    expect(start(state)).toEqual({ ok: false, reason: 'error.examPassed' });
  });

  it('does not confer the rank in a second slot before the rest of the exam is done', () => {
    const state = ready();
    state.slots.push({ action: null, progress: 0, share: state.slots[0]!.share, data: null });
    expect(dispatch(state, { type: 'exam.start', rank: 'chunin', slot: 0 }, content).ok).toBe(true);
    expect(dispatch(state, { type: 'exam.start', rank: 'chunin', slot: 1 }, content).ok).toBe(true);
    advance(state, 30 * 60_000, content);
    expect(writtenPassed(state, exam)).toBe(true);
    expect(state.player.rank).toBe('genin');
    expect(state.bank['core:chunin_vest']).toBeUndefined();
    expect(state.events.some((e) => e.type === 'rankUp')).toBe(false);
  });

  it('is shorter with Scouting and Intel, and the conferral is the shortest test', () => {
    const base = ready();
    base.skills.scout!.xp = xpAt(20);
    const plain = senseiTestSeconds(base, exam, content);
    const withIntel = ready();
    withIntel.skills.scout!.xp = xpAt(20);
    withIntel.currencies[intel] = 3;
    expect(senseiTestSeconds(withIntel, exam, content)).toBeLessThan(plain);
    // The Intel that counts is capped by the balance.
    const capped = ready();
    capped.skills.scout!.xp = xpAt(20);
    capped.currencies[intel] = content.balance.K.intel.writtenTestMaxIntel;
    const over = ready();
    over.skills.scout!.xp = xpAt(20);
    over.currencies[intel] = 500;
    expect(senseiTestSeconds(over, exam, content)).toBe(senseiTestSeconds(capped, exam, content));
    expect(conferralSeconds(content)).toBe(content.balance.K.senseiTest.floor);
    expect(plain).toBeGreaterThanOrEqual(conferralSeconds(content));
  });

  it('leaves the first exam as it was: passing the test confers the rank at once', () => {
    const first = content.exams.find((e) => e.rank === 'genin');
    expect(first?.then).toBeUndefined();
  });
});

describe('the data the chains rest on', () => {
  it("asks the same checklist in the first step of «Ім'я на камені» as the exam does", () => {
    const step = quest('core:name_on_stone').steps[0]?.objective;
    expect(step).toEqual({ t: 'req', req: exam().checklist });
  });

  it("refers the Chunin exam from the end of «Сірі пов'язки» as the new goal", () => {
    expect(quest('core:grey_bands').rewards.goal).toEqual({ kind: 'exam', id: exam().id });
  });

  it('points every «poi.» flag of a step at a point that exists', () => {
    const pois = new Set(content.cells.flatMap((c) => c.pois.map((p) => poiFlag(p.id))));
    for (const q of content.quests) {
      for (const flag of flagsIn(q.steps.map((s) => s.objective))) {
        if (flag.startsWith('poi.')) expect(pois.has(flag), `${q.id}: ${flag}`).toBe(true);
      }
    }
  });

  it('gives every flag a requirement reads a way to be raised', () => {
    const raised = new Set<string>(['firstFight']);
    for (const r of content.regions) raised.add(regionFlag(r.id));
    for (const c of content.cells) for (const p of c.pois) raised.add(poiFlag(p.id));
    for (const b of content.buildings) raised.add(depositFlag(b.id));
    for (const q of content.quests) {
      for (const s of q.steps) for (const f of s.opens ?? []) raised.add(f);
      for (const f of q.rewards.flags) raised.add(f);
    }
    for (const o of content.operations) raised.add(o.clearFlag);
    for (const e of content.exams) raised.add(examWrittenFlag(e));
    const read = flagsIn([content.zones, content.operations, content.missions, content.skills]);
    for (const flag of read) expect(raised.has(flag), `no setter for ${flag}`).toBe(true);
  });

  it('chains give rewards that exist, and no chain pays a rank except through an exam', () => {
    for (const q of content.quests) {
      for (const { item } of q.rewards.items) {
        expect(
          content.items.some((i) => i.id === item),
          `${q.id}: ${item}`,
        ).toBe(true);
      }
      expect(q.rewards.rank, q.id).toBeNull();
    }
  });
});

const exam = () => {
  const found = content.exams.find((e) => e.id === 'core:chunin_exam');
  if (!found) throw new Error('no exam');
  return found;
};

/** Every flag id a requirement tree somewhere inside `value` reads. */
function flagsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) flagsIn(v, out);
  else if (value !== null && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (node.t === 'flag' && typeof node.id === 'string') out.add(node.id);
    for (const v of Object.values(node)) flagsIn(v, out);
  }
  return out;
}

describe('«Суперник» on a save from before the natures counter', () => {
  /** The shape of an older save: natures held, no `natures.gained`, no entry for the chain. */
  function oldSave(natures: string[]): GameState {
    const state = genin(5);
    state.player.natures = natures;
    delete state.counters['natures.gained'];
    delete state.quests['core:rival'];
    return state;
  }

  it('counts the natures the character already has: three natures finish step 1', () => {
    const state = oldSave(['katon', 'futon', 'doton']);
    updateQuests(state, content);
    expect(counterValue(state, 'natures.gained')).toBe(3);
    expect(state.quests['core:rival']?.step).toBeGreaterThanOrEqual(1);
  });

  it('with two natures it is done too, with one it waits for the second', () => {
    const two = oldSave(['katon', 'futon']);
    updateQuests(two, content);
    expect(two.quests['core:rival']?.step).toBeGreaterThanOrEqual(1);
    const one = oldSave(['katon']);
    updateQuests(one, content);
    expect(one.quests['core:rival']?.step).toBe(0);
    one.player.natures.push('doton');
    updateQuests(one, content);
    expect(one.quests['core:rival']?.step).toBeGreaterThanOrEqual(1);
  });
});

describe('the reward scroll of «Суперник»', () => {
  const scrollsIn = (state: GameState): string[] =>
    Object.keys(state.bank).filter((id) => content.items.find((i) => i.id === id)?.scroll);
  const finish = (natures: string[]): GameState => {
    const state = atChain('core:rival', 3);
    state.player.natures = natures;
    state.quests['core:rival'] = { step: 3, base: 0, done: false };
    state.counters['kills.core:boss_ren2'] = 1;
    updateQuests(state, content);
    expect(state.quests['core:rival']?.done).toBe(true);
    return state;
  };
  const techOf = (item: string) =>
    content.techniques.find(
      (x) => x.id === content.items.find((i) => i.id === item)?.scroll?.technique,
    )!;

  it('is a scroll the player can read, whatever the natures: not a fixed one', () => {
    const quest = content.quests.find((q) => q.id === 'core:rival')!;
    expect(quest.rewards.items).toEqual([]);
    expect(quest.rewards.scroll).toEqual({ library: 3 });
    for (const natures of [['suiton'], ['katon'], ['doton', 'raiton']]) {
      const state = finish(natures);
      const got = scrollsIn(state);
      expect(got).toHaveLength(1);
      const tech = techOf(got[0]!);
      const open = content.skills.find((s) => s.id === tech.skill)?.unlockReq;
      if (open) expect(evalReq(state, open, content).met).toBe(true);
    }
  });

  it('gives a player without Katon no Katon scroll, and one with Katon the scroll of his nature', () => {
    const without = finish(['suiton']);
    expect(without.bank['core:scroll_dragon_fire']).toBeUndefined();
    const withKaton = finish(['katon']);
    expect(techOf(scrollsIn(withKaton)[0]!).skill).toBe('katon');
  });
});
