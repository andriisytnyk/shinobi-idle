import { content, type ContentDb } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  deserialize,
  dispatch,
  senseiTestSeconds,
  serialize,
  STATE_VERSION,
  updateQuests,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { greedyToGenin } from './bot.ts';
import { genin, setLevel } from './helpers.ts';

const QUEST = 'core:graduation';
const SCROLL = 'core:graduate_scroll';
const DUMMY = 'core:dummy';
const fight = { type: 'action.start', slot: 0, kind: 'fight', id: DUMMY } as const;
const stepOf = (s: GameState) => s.quests[QUEST]?.step;
const kills = (s: GameState) => s.counters[`kills.${DUMMY}`] ?? 0;

/** Fights the dummy until `n` more are down; the player is toughened so it never loses. */
function killDummies(state: GameState, n: number): void {
  setLevel(state, 'vit', 40);
  const goal = kills(state) + n;
  dispatch(state, fight, content);
  while (kills(state) < goal) advance(state, 1000, content);
  dispatch(state, { type: 'action.stop', slot: 0 }, content);
}

/** Meets the exam checklist, without touching anything else. */
function meetChecklist(state: GameState): void {
  setLevel(state, 'tai', 10);
  setLevel(state, 'nin', 10);
  setLevel(state, 'cc', 10);
}

describe('A5: the «Випуск» chain', () => {
  it('has five steps and starts with the game', () => {
    const quest = content.quests.find((q) => q.id === QUEST);
    expect(quest?.steps).toHaveLength(5);
    const state = createState(1, content);
    expect(state.quests[QUEST]).toEqual({ step: 0, base: 0, done: false });
  });

  it('advances through all five steps as objectives are met', () => {
    const state = createState(2, content);
    setLevel(state, 'tai', 5);
    updateQuests(state, content);
    expect(stepOf(state)).toBe(0);
    setLevel(state, 'ath', 5);
    updateQuests(state, content);
    expect(stepOf(state)).toBe(1);
    setLevel(state, 'cc', 5);
    setLevel(state, 'med', 5);
    // The academy techniques are known from the start, so step 3 falls at once.
    advance(state, 0, content);
    expect(stepOf(state)).toBe(3);
    killDummies(state, 10);
    expect(stepOf(state)).toBe(4);
    meetChecklist(state);
    expect(dispatch(state, { type: 'exam.genin.start' }, content)).toEqual({ ok: true });
    advance(state, 300_000, content);
    expect(state.player.rank).toBe('genin');
    expect(state.quests[QUEST]).toEqual({ step: 5, base: 0, done: true });
    const steps = state.events.filter((e) => e.type === 'questStep');
    expect(steps.map((e) => e.type === 'questStep' && e.step)).toEqual([1, 2, 3, 4, 5]);
    expect(state.events.filter((e) => e.type === 'questDone')).toHaveLength(1);
    expect(state.flags['leaf_headband']).toBe(true);
  });

  it('counts a counter objective only from the moment its step became active', () => {
    const state = createState(3, content);
    killDummies(state, 10);
    expect(stepOf(state)).toBe(0);
    setLevel(state, 'tai', 5);
    setLevel(state, 'ath', 5);
    setLevel(state, 'cc', 5);
    setLevel(state, 'med', 5);
    advance(state, 0, content);
    expect(stepOf(state)).toBe(3);
    expect(state.quests[QUEST]?.base).toBe(10);
    killDummies(state, 9);
    expect(stepOf(state)).toBe(3);
    killDummies(state, 1);
    expect(stepOf(state)).toBe(4);
  });

  it('cannot finish step 5 before the checklist is met, whatever the rank', () => {
    const state = createState(4, content);
    for (const skill of ['tai', 'ath', 'cc', 'med'] as const) setLevel(state, skill, 5);
    advance(state, 0, content);
    killDummies(state, 10);
    expect(stepOf(state)).toBe(4);
    expect(dispatch(state, { type: 'exam.genin.start' }, content)).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    state.player.rank = 'genin';
    updateQuests(state, content);
    expect(stepOf(state)).toBe(4);
    meetChecklist(state);
    updateQuests(state, content);
    expect(stepOf(state)).toBe(5);
    expect(state.quests[QUEST]?.done).toBe(true);
  });
});

describe('quest engine', () => {
  const quest = (patch: Partial<ContentDb['quests'][number]>) => ({
    id: 'core:t1',
    chain: 'core:t1',
    unlock: null,
    steps: [
      { textKey: 'k.1', objective: { t: 'counter' as const, counter: 'actions.drill', n: 2 } },
      {
        textKey: 'k.2',
        objective: { t: 'req' as const, req: { t: 'item' as const, id: 'core:mint', n: 1 } },
      },
    ],
    rewards: {
      items: [{ item: 'core:mint', n: 2 }],
      ryo: 50,
      rep: 7,
      flags: ['done'],
      rank: 'chunin' as const,
    },
    ...patch,
  });
  const withQuests = (...quests: ContentDb['quests']): ContentDb => ({ ...content, quests });

  it('pays the chain rewards: items, ryo, reputation, flags and rank', () => {
    const db = withQuests(quest({}));
    const state = createState(1, db);
    state.counters['actions.drill'] = 5;
    updateQuests(state, db);
    expect(state.quests['core:t1']).toEqual({ step: 1, base: 0, done: false });
    state.bank['core:mint'] = 1;
    updateQuests(state, db);
    expect(state.quests['core:t1']?.done).toBe(true);
    expect(state.bank['core:mint']).toBe(3);
    expect(state.currencies).toMatchObject({ ryo: 50, rep: 7 });
    expect(state.flags['done']).toBe(true);
    expect(state.player.rank).toBe('chunin');
    expect(state.events.some((e) => e.type === 'rankUp')).toBe(true);
  });

  it('starts a chain only when its unlock is met, and evaluates the quest requirement', () => {
    const second = quest({
      id: 'core:t2',
      chain: 'core:t2',
      unlock: { t: 'quest', id: 'core:t1' },
      rewards: { items: [], ryo: 0, rep: 0, flags: [], rank: null },
    });
    const db = withQuests(
      quest({ rewards: { items: [], ryo: 0, rep: 0, flags: [], rank: null } }),
      second,
    );
    const state = createState(1, db);
    expect(state.quests['core:t2']).toBeUndefined();
    state.counters['actions.drill'] = 2;
    state.bank['core:mint'] = 1;
    updateQuests(state, db);
    expect(state.quests['core:t1']?.done).toBe(true);
    expect(state.quests['core:t2']).toBeDefined();
  });
});

describe('A6: graduation', () => {
  const graduate = (seed: number): GameState => {
    const state = createState(seed, content);
    meetChecklist(state);
    expect(dispatch(state, { type: 'exam.genin.start' }, content)).toEqual({ ok: true });
    advance(state, 300_000, content);
    return state;
  };

  it('needs the checklist to start, and cannot be taken twice', () => {
    const fresh = createState(1, content);
    expect(dispatch(fresh, { type: 'exam.genin.start' }, content)).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    const state = graduate(2);
    expect(dispatch(state, { type: 'exam.genin.start' }, content)).toEqual({
      ok: false,
      reason: 'error.examPassed',
    });
  });

  it('takes 300 s less 1% per Taijutsu, Ninjutsu and Chakra Control level, never under 120 s', () => {
    const exam = content.exams[0];
    if (!exam) throw new Error('no exam');
    const state = createState(1, content);
    expect(senseiTestSeconds(state, exam, content)).toBeCloseTo(300 * 0.97);
    meetChecklist(state);
    expect(senseiTestSeconds(state, exam, content)).toBeCloseTo(210);
    for (const skill of ['tai', 'nin', 'cc'] as const) setLevel(state, skill, 50);
    expect(senseiTestSeconds(state, exam, content)).toBe(content.balance.K.senseiTest.floor);
    meetChecklist(state);
    dispatch(state, { type: 'exam.genin.start' }, content);
    advance(state, 209_999, content);
    expect(state.player.rank).toBe('student');
    expect(state.slots[0]?.action?.kind).toBe('senseiTest');
    advance(state, 1, content);
    expect(state.player.rank).toBe('genin');
    expect(state.slots[0]?.action).toBeNull();
  });

  it('makes the player a genin with the mentor techniques, the scroll and the goal', () => {
    const state = createState(3, content);
    meetChecklist(state);
    setLevel(state, 'katon', 5);
    dispatch(state, { type: 'exam.genin.start' }, content);
    advance(state, 300_000, content);
    expect(state.player.rank).toBe('genin');
    for (const t of content.techniques) {
      if (t.src !== 'N') continue;
      const reached = (state.skills[t.skill].xp >= xpAt(t.level)) as boolean;
      expect(Boolean(state.known[t.id]), t.id).toBe(reached);
    }
    expect(Object.keys(state.known).length).toBeGreaterThan(4);
    expect(state.bank[SCROLL]).toBe(1);
    expect(state.goal).toEqual({ kind: 'technique', id: 'core:shadow_clone' });
    const types = state.events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['rankUp', 'itemGained', 'goalSet', 'actionStopped']),
    );
  });

  it('lets the scroll give exactly one hour of mastery to an academy technique', () => {
    const state = graduate(4);
    const before = state.mastery['core:clone']?.xp ?? 0;
    expect(
      dispatch(state, { type: 'item.use', id: SCROLL, target: 'core:clone' }, content),
    ).toEqual({ ok: true });
    expect((state.mastery['core:clone']?.xp ?? 0) - before).toBe(content.balance.K.masteryPerHour);
    expect(state.bank[SCROLL]).toBeUndefined();
  });

  it('refuses the scroll for a non-academy technique and keeps it', () => {
    const state = graduate(5);
    const other = content.techniques.find((t) => t.mentor === 'other');
    if (!other) throw new Error('no non-academy technique');
    expect(dispatch(state, { type: 'item.use', id: SCROLL, target: other.id }, content)).toEqual({
      ok: false,
      reason: 'error.invalidTarget',
    });
    expect(state.bank[SCROLL]).toBe(1);
    expect(state.mastery[other.id]).toBeUndefined();
  });

  it('gives a reason key for every other way the use can fail', () => {
    const state = createState(6, content);
    const use = (id: string, target = 'core:clone') =>
      dispatch(state, { type: 'item.use', id, target }, content);
    expect(use('core:nothing')).toEqual({ ok: false, reason: 'error.unknownItem' });
    expect(use(SCROLL)).toEqual({ ok: false, reason: 'error.noItem' });
    state.bank['core:mint'] = 1;
    expect(use('core:mint')).toEqual({ ok: false, reason: 'error.itemNotUsable' });
    state.bank[SCROLL] = 1;
    expect(use(SCROLL, 'core:no_such')).toEqual({ ok: false, reason: 'error.invalidTarget' });
  });
});

describe('A7: a greedy run to genin', () => {
  it('takes 45 to 75 minutes of game time', () => {
    const run = greedyToGenin(createState(1, content));
    console.log(`A7: time to genin ${run.minutes.toFixed(1)} min`);
    expect(run.state.player.rank).toBe('genin');
    expect(run.state.quests[QUEST]?.done).toBe(true);
    expect(run.minutes).toBeGreaterThanOrEqual(45);
    expect(run.minutes).toBeLessThanOrEqual(75);
  });
});

describe('A8: saves', () => {
  /** Mid-fight, with quest progress, a counter and a technique on cooldown. */
  const busy = (): GameState => {
    const state = createState(7, content);
    for (const skill of ['tai', 'ath', 'cc', 'med'] as const) setLevel(state, skill, 5);
    advance(state, 0, content);
    setLevel(state, 'vit', 30);
    dispatch(state, fight, content);
    advance(state, 47_321, content);
    return state;
  };

  it('round-trips a fight and quest progress, and carries on identically', () => {
    const a = busy();
    expect(a.combat).not.toBeNull();
    expect(a.counters[`kills.${DUMMY}`]).toBeGreaterThan(0);
    const text = serialize(a, 1234);
    const b = deserialize(text, content);
    expect(serialize(b, 1234)).toBe(text);
    expect(b.combat).toEqual(a.combat);
    expect(b.quests).toEqual(a.quests);
    advance(a, 90_000, content);
    advance(b, 90_000, content);
    expect(serialize(b, 0)).toBe(serialize(a, 0));
  });

  it('migrates a version 3 save and starts the chain', () => {
    const state = createState(8, content);
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' },
      content,
    );
    advance(state, 20_000, content);
    const parsed = JSON.parse(serialize(state, 55)) as {
      v: number;
      state: Record<string, unknown>;
    };
    const old: { v: number; savedAt: number; state: Record<string, unknown> } = {
      v: 3,
      savedAt: 55,
      state: { ...parsed.state, v: 3 },
    };
    for (const key of ['counters', 'quests', 'combat', 'goal']) delete old.state[key];
    const loaded = deserialize(JSON.stringify(old), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(loaded.slots[0]?.action).toEqual({ kind: 'practice', id: 'core:leaf_whirlwind' });
    expect(loaded.skills.tai.xp).toBe(state.skills.tai.xp);
    expect(loaded.counters).toEqual({});
    expect(loaded.combat).toBeNull();
    expect(loaded.goal).toBeNull();
    expect(loaded.quests[QUEST]).toEqual({ step: 0, base: 0, done: false });
  });

  it('restarts a damaged fight instead of trusting it', () => {
    const a = busy();
    type Doc = {
      v: number;
      state: { combat: { fight: Record<string, unknown> } & Record<string, unknown> };
    };
    const damage = (edit: (doc: Doc) => void): ReturnType<typeof deserialize> => {
      const parsed = JSON.parse(serialize(a, 0)) as Doc;
      edit(parsed);
      return deserialize(JSON.stringify(parsed), content);
    };
    const fresh = (b: ReturnType<typeof deserialize>) => {
      expect(b.combat?.enemy).toBe(DUMMY);
      expect(b.combat?.fight.t).toBe(0);
      expect(b.combat?.fight.result).toBe('ongoing');
      advance(b, 10_000, content);
    };
    fresh(damage((d) => ((d.state.combat.fight.player as Record<string, unknown>).hp = 'x')));
    fresh(damage((d) => ((d.state.combat.fight.player as Record<string, unknown>).intervalMs = 0)));
    fresh(damage((d) => (d.state.combat.fight.t = -4)));
    fresh(damage((d) => (d.state.combat.fight.result = 'defeat')));
    fresh(damage((d) => (d.state.combat.fight.rng = [1, 2])));
    fresh(damage((d) => delete (d.state.combat as Record<string, unknown>).fight));
    // Numbers around the fight are clamped, not trusted.
    const b = damage((d) => Object.assign(d.state.combat, { work: 1e18, pause: -4, carry: 1e18 }));
    expect(b.combat?.work).toBeLessThanOrEqual(3_600_000 * 1000);
    expect(b.combat?.pause).toBe(0);
    advance(b, 10_000, content);
    // A save without a combat block but with a fight slot gets a fresh fight.
    const parsed = JSON.parse(serialize(a, 0)) as { state: Record<string, unknown> };
    delete parsed.state.combat;
    expect(deserialize(JSON.stringify(parsed), content).combat?.enemy).toBe(DUMMY);
    // A combat block without a fight slot is dropped.
    const idle = JSON.parse(serialize(a, 0)) as { state: { slots: { action: unknown }[] } };
    for (const slot of idle.state.slots) slot.action = null;
    expect(deserialize(JSON.stringify(idle), content).combat).toBeNull();
  });

  it('keeps a graduate a graduate across save and load', () => {
    const state = genin(9);
    state.goal = { kind: 'technique', id: 'core:shadow_clone' };
    state.bank[SCROLL] = 1;
    state.counters['kills.core:dummy'] = 12;
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.goal).toEqual(state.goal);
    expect(loaded.bank[SCROLL]).toBe(1);
    expect(loaded.counters).toEqual(state.counters);
    expect(loaded.quests[QUEST]?.step).toBeGreaterThanOrEqual(0);
  });
});
