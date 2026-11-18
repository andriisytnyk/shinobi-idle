/** Shadow clones: a second action slot, the speed pool, the link bonus, fights (see clone-fights.test.ts), telemetry and saving. */
import { content, type ContentDb } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  addRule,
  advance,
  cloneSlots,
  cloneTelemetry,
  createState,
  defaultRules,
  deserialize,
  feeds as feedsLink,
  dispatch,
  getMod,
  growSlots,
  isCloneSlot,
  linked,
  serialize,
  slotCount,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { analyze, build, zone } from './analysis-helpers.ts';
import { openWorld } from './helpers.ts';
import { player } from './missions-helpers.ts';

const CLONE = 'core:shadow_clone';
const SCROLL = 'core:scroll_shadow_clone';
const HOUR = 3_600_000;

/** A genin at level 50 in the skills the tests use, who knows the clone technique (the second slot is open). */
function cloner(seed = 1, extra: Record<string, number> = {}): GameState {
  const state = player({
    seed,
    natures: ['katon'],
    levels: { nin: 50, med: 40, cc: 40, herb: 20, alch: 20, prov: 20, katon: 20 },
    known: [CLONE],
    bank: { 'core:mint': 5000, 'core:water': 5000, 'core:rice': 5000, 'core:salt': 5000, ...extra },
  });
  growSlots(state, content);
  state.events = [];
  return state;
}

const drill = (): string => content.exercises.find((e) => e.level <= 30)?.id ?? '';
/** A second exercise, a different action of the same kind. */
const drill2 = (): string => content.exercises.filter((e) => e.level <= 30)[1]?.id ?? '';
const start = (state: GameState, slot: number, kind: string, id: string) =>
  dispatch(state, { type: 'action.start', slot, kind, id }, content);
const xpSum = (state: GameState): number =>
  Object.values(state.skills).reduce((sum, s) => sum + s.xp, 0);

/** Every XP point gained over `ms` by running `a` in slot 0 and `b` in slot 1 (either may be null). */
function gained(
  a: [string, string] | null,
  b: [string, string] | null,
  ms: number,
  c: ContentDb = content,
): number {
  const state = cloner();
  const before = xpSum(state);
  if (a)
    expect(dispatch(state, { type: 'action.start', slot: 0, kind: a[0], id: a[1] }, c).ok).toBe(
      true,
    );
  if (b)
    expect(dispatch(state, { type: 'action.start', slot: 1, kind: b[0], id: b[1] }, c).ok).toBe(
      true,
    );
  advance(state, ms, c);
  return xpSum(state) - before;
}

/** An action of a skill from the content: the first available one at or below `level`. */
function actionOf(skill: string, level = 1): [string, string] {
  const found = content.techniques.find((t) => t.skill === skill && t.level === level);
  if (!found) throw new Error();
  return ['practice', found.id];
}

describe('the clone slot', () => {
  it('opens when the player learns the technique, by the data of the technique', () => {
    const state = player({ seed: 3, base: 50, natures: ['katon'], known: [] });
    delete state.known[CLONE];
    state.bank[SCROLL] = 1;
    expect(state.slots.length).toBe(1);
    expect(slotCount(state, content)).toBe(1);
    expect(dispatch(state, { type: 'item.use', id: SCROLL }, content)).toEqual({ ok: true });
    expect(state.known[CLONE]).toBe(true);
    expect(state.slots.length).toBe(2);
    expect(cloneSlots(state, content)).toEqual([{ slot: 1, technique: CLONE }]);
    expect(isCloneSlot(state, content, 1)).toBe(true);
    expect(isCloneSlot(state, content, 0)).toBe(false);
  });

  it('stays shut where the data does not open it', () => {
    // The same content without the data on the technique: knowing it opens nothing.
    const shut: ContentDb = {
      ...content,
      techniques: content.techniques.map((t) => {
        const { opensSlot: _unused, ...rest } = t;
        void _unused;
        return rest;
      }),
    };
    const state = player({ seed: 3, base: 50, natures: ['katon'], known: [CLONE] });
    expect(slotCount(state, shut)).toBe(1);
    expect(
      dispatch(state, { type: 'action.start', slot: 1, kind: 'drill', id: drill() }, shut),
    ).toEqual({
      ok: false,
      reason: 'error.invalidSlot',
    });
    expect(state.slots.length).toBe(1);
    // With the data, the same state opens the slot on the first start there.
    expect(start(state, 1, 'drill', drill())).toEqual({ ok: true });
    expect(state.slots.length).toBe(2);
  });

  it('shares speed 50/50 between two running actions and gives it all back on dispel', () => {
    const state = cloner();
    start(state, 0, 'drill', drill());
    expect(state.slots.map((s) => s.share)).toEqual([1000, 0]);
    start(state, 1, 'drill', drill2());
    expect(state.slots.map((s) => s.share)).toEqual([500, 500]);
    expect(dispatch(state, { type: 'clone.dispel' }, content)).toEqual({ ok: true });
    expect(state.slots.map((s) => s.share)).toEqual([1000, 0]);
    expect(state.slots[1]?.action).toBeNull();
    expect(state.events.some((e) => e.type === 'actionStopped' && e.reason === 'dispelled')).toBe(
      true,
    );
    // Nothing left to dispel.
    expect(dispatch(state, { type: 'clone.dispel' }, content)).toEqual({
      ok: false,
      reason: 'error.noAction',
    });
  });

  it('gives the whole speed to a clone that works alone', () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    expect(state.slots.map((s) => s.share)).toEqual([0, 1000]);
  });

  it('takes the pool from the balance (the spare lever: 110%)', () => {
    const lever: ContentDb = {
      ...content,
      balance: {
        ...content.balance,
        K: { ...content.balance.K, clone: { ...content.balance.K.clone, pool: 1.1 } },
      },
    };
    const state = cloner();
    expect(
      dispatch(state, { type: 'action.start', slot: 0, kind: 'drill', id: drill() }, lever).ok,
    ).toBe(true);
    expect(
      dispatch(state, { type: 'action.start', slot: 1, kind: 'drill', id: drill2() }, lever).ok,
    ).toBe(true);
    expect(state.slots.map((s) => s.share)).toEqual([550, 550]);
  });
});

describe('XP per hour with a clone', () => {
  const drillAction: [string, string] = ['drill', drill()];
  const katonPractice = actionOf('katon', 1);
  const ninPractice = actionOf('nin', 10);
  const pairs: [string, [string, string], [string, string]][] = [
    ['two different drills', drillAction, ['drill', drill2()]],
    ['two different techniques of one skill', actionOf('katon', 1), actionOf('katon', 10)],
    ['a drill and a katon technique', drillAction, katonPractice],
    ['a katon and a ninjutsu technique', katonPractice, ninPractice],
  ];

  for (const [name, a, b] of pairs) {
    it(`without a link, two actions at half speed earn what half of each alone earns: ${name}`, () => {
      expect(
        linked({ kind: a[0], id: a[1] }, { kind: b[0], id: b[1] }, content, defaultRules),
      ).toBe(false);
      const soloA = gained(a, null, 2 * HOUR);
      const soloB = gained(b, null, 2 * HOUR);
      const both = gained(a, b, 2 * HOUR);
      expect(both).toBeGreaterThan(0);
      // Mastery shortens a cast and the XP of a cycle is fixed, so the split run (slower mastery) may differ a little.
      expect(Math.abs(both - (soloA + soloB) / 2) / ((soloA + soloB) / 2)).toBeLessThan(0.03);
    });
  }

  it('refuses the same action in a second slot, in either order, and leaves the first running', () => {
    const state = cloner();
    expect(start(state, 0, 'drill', drill())).toEqual({ ok: true });
    expect(start(state, 1, 'drill', drill())).toEqual({
      ok: false,
      reason: 'error.sameActionElsewhere',
    });
    expect(state.slots[1]?.action).toBeNull();
    // The same action in its own slot restarts it, and a different action runs beside it.
    expect(start(state, 0, 'drill', drill())).toEqual({ ok: true });
    expect(start(state, 1, 'drill', drill2())).toEqual({ ok: true });
    expect(start(state, 0, 'drill', drill2())).toEqual({
      ok: false,
      reason: 'error.sameActionElsewhere',
    });
  });

  it('runs two different techniques of one skill together at half speed each', () => {
    const [kind, a] = actionOf('katon', 1);
    const [, b] = actionOf('katon', 10);
    const state = cloner();
    expect(start(state, 0, kind, a)).toEqual({ ok: true });
    expect(start(state, 1, kind, b)).toEqual({ ok: true });
    expect(state.slots.map((s) => s.share)).toEqual([500, 500]);
    advance(state, HOUR, content);
    expect(state.slots.every((s) => s.action !== null)).toBe(true);
  });

  it('is the same for a clone working alone while the player is idle', () => {
    const player0 = gained(drillAction, null, 2 * HOUR);
    const clone = gained(null, drillAction, 2 * HOUR);
    expect(clone).toBe(player0);
    const technique = gained(null, katonPractice, 2 * HOUR);
    expect(technique).toBe(gained(katonPractice, null, 2 * HOUR));
  });
});

describe('the link bonus', () => {
  const gather: [string, string] = ['gather', 'core:mint'];
  const feeds: [string, string] = ['craft', 'core:antidote'];
  const apart: [string, string] = ['craft', 'core:onihiri'];
  const feedsTonic: [string, string] = ['craft', 'core:tonik_iasnoho_rozumu'];
  const act = (x: [string, string]) => ({ kind: x[0], id: x[1] });

  it('links an action that makes an item to the one that uses it: the feeder is the herb, the fed is the craft', () => {
    expect(feedsLink(act(gather), act(feeds), content, defaultRules)).toBe(true);
    expect(feedsLink(act(feeds), act(gather), content, defaultRules)).toBe(false);
    expect(feedsLink(act(gather), act(feedsTonic), content, defaultRules)).toBe(true);
    expect(feedsLink(act(gather), act(apart), content, defaultRules)).toBe(false);
    expect(feedsLink(act(gather), act(gather), content, defaultRules)).toBe(false);
    expect(linked(act(gather), act(feeds), content, defaultRules)).toBe(true);
    expect(linked(act(feeds), act(gather), content, defaultRules)).toBe(true);
    expect(linked(act(gather), { kind: 'drill', id: drill() }, content, defaultRules)).toBe(false);
  });

  it('adds K.clone.link to the fed action only, shown in the breakdown with the technique as its source', () => {
    const state = cloner();
    start(state, 0, gather[0], gather[1]);
    expect(getMod(state, 'speed.skill.alch', content).total).toBe(1);
    start(state, 1, feeds[0], feeds[1]);
    const link = content.balance.K.clone.link;
    const mod = getMod(state, 'speed.skill.alch', content);
    expect(mod.total).toBeCloseTo(1 + link, 9);
    expect(mod.parts).toContainEqual({
      key: 'speed.skill.alch',
      op: 'add',
      value: link,
      group: 'character',
      source: { kind: 'technique', id: CLONE },
    });
    // The herb feeds and is not sped up.
    expect(getMod(state, 'speed.skill.herb', content).total).toBe(1);
    // The same craft in the player's slot and the herb in the clone's: the craft is fed all the same.
    const swapped = cloner();
    start(swapped, 1, gather[0], gather[1]);
    start(swapped, 0, feeds[0], feeds[1]);
    expect(getMod(swapped, 'speed.skill.alch', content).total).toBeCloseTo(1 + link, 9);
    // Dispelling the clone ends the bonus.
    dispatch(state, { type: 'clone.dispel' }, content);
    expect(getMod(state, 'speed.skill.alch', content).total).toBe(1);
  });

  it('shortens the cycle of the fed action in its forecast', () => {
    const state = cloner();
    start(state, 0, gather[0], gather[1]);
    const alone = actionInfo(state, act(feeds), content);
    start(state, 1, feeds[0], feeds[1]);
    const fed = actionInfo(state, act(feeds), content);
    expect(alone && fed).toBeTruthy();
    const link = content.balance.K.clone.link;
    expect((fed?.intervalMs ?? 0) * (1 + link)).toBeCloseTo(alone?.intervalMs ?? 0, -1);
  });

  it('gives no bonus to an unlinked pair', () => {
    const state = cloner();
    start(state, 0, gather[0], gather[1]);
    start(state, 1, apart[0], apart[1]);
    expect(getMod(state, 'speed.skill.herb', content).total).toBe(1);
    expect(getMod(state, 'speed.skill.prov', content).total).toBe(1);
  });

  it('is data: without the links on the technique there is none', () => {
    const bare: ContentDb = {
      ...content,
      techniques: content.techniques.map((t) => {
        const { slotLinks: _unused, ...rest } = t;
        void _unused;
        return rest;
      }),
    };
    const state = cloner();
    start(state, 0, gather[0], gather[1]);
    start(state, 1, feeds[0], feeds[1]);
    expect(getMod(state, 'speed.skill.alch', bare).total).toBe(1);
    expect(linked(act(gather), act(feeds), bare, defaultRules)).toBe(false);
  });

  it('makes the fed craft earn 10% more, and leaves the gathering at its half', () => {
    const run = (b: [string, string] | null, a: [string, string] | null = gather) => {
      const state = cloner();
      if (a) start(state, 0, a[0], a[1]);
      if (b) start(state, 1, b[0], b[1]);
      const before = Object.fromEntries(Object.entries(state.skills).map(([k, v]) => [k, v.xp]));
      advance(state, HOUR, content);
      return (skill: string): number => (state.skills[skill]?.xp ?? 0) - (before[skill] ?? 0);
    };
    const together = run(feeds);
    const craftAlone = run(feeds, null);
    const gatherAlone = run(null);
    const link = content.balance.K.clone.link;
    const craft = together('alch') / (craftAlone('alch') / 2);
    expect(craft).toBeGreaterThan(1 + link - 0.04);
    expect(craft).toBeLessThan(1 + link + 0.04);
    const herb = together('herb') / (gatherAlone('herb') / 2);
    expect(herb).toBeGreaterThan(0.94);
    expect(herb).toBeLessThan(1.06);
  });
});

describe('what a clone may do', () => {
  it('takes missions without a combat stage, village missions among them', () => {
    const state = cloner();
    for (const m of content.missions) {
      if (m.stages.some((s) => s.t === 'combat') || m.rank === 'OP') continue;
      const result = start(state, 1, 'mission', m.id);
      if (!result.ok) expect(result.reason).not.toBe('error.fightBusy');
    }
    expect(start(state, 1, 'mission', 'core:v_clones')).toEqual({ ok: true });
  });

  it('no longer refuses a fight to the clone (the fight rules of the clone are in clone-fights.test.ts)', () => {
    const state = cloner();
    openWorld(state);
    expect(start(state, 1, 'fight', 'core:bandit').ok).toBe(true);
    // One fight at a time: the player's own slot is refused while the clone fights.
    expect(start(state, 0, 'fight', 'core:bandit')).toEqual({
      ok: false,
      reason: 'error.fightBusy',
    });
  });

  it('runs a village mission to its end in the clone slot and pays the Workforce', () => {
    const state = cloner();
    const before = state.village?.workforce ?? 0;
    expect(start(state, 1, 'mission', 'core:v_clones')).toEqual({ ok: true });
    advance(state, 40 * 60_000, content);
    expect(state.counters['missions.done.core:v_clones'] ?? 0).toBeGreaterThan(0);
    expect(
      (state.village?.workforce ?? 0) + (state.missions.pending['robocha_syla'] ?? 0),
    ).toBeGreaterThan(before);
  });

  it('lets the player and a clone work on a mission each', () => {
    const state = cloner();
    const own = content.missions.find(
      (m) =>
        m.board &&
        m.id !== 'core:v_clones' &&
        !m.stages.some((st) => st.t === 'combat') &&
        start(state, 0, 'mission', m.id).ok,
    );
    expect(own).toBeDefined();
    expect(start(state, 1, 'mission', 'core:v_clones')).toEqual({ ok: true });
    expect(state.slots.map((s) => s.share)).toEqual([500, 500]);
    advance(state, 30 * 60_000, content);
    expect(state.counters[`missions.done.${own?.id}`] ?? 0).toBeGreaterThan(0);
  });
});

describe('time with two slots', () => {
  const setup = (): GameState => {
    const state = cloner(5);
    start(state, 0, 'gather', 'core:mint');
    start(state, 1, 'craft', 'core:antidote');
    return state;
  };

  it('repeats exactly for the same seed and commands', () => {
    const a = setup();
    const b = setup();
    advance(a, 3 * HOUR, content);
    advance(b, 3 * HOUR, content);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gives the same state however the time is cut', () => {
    const whole = setup();
    advance(whole, 2 * HOUR, content);
    for (const chunks of [[1], [999, 5003], [60_000, 1, 33_333]]) {
      const cut = setup();
      let left = 2 * HOUR;
      for (let i = 0; left > 0; i++) {
        const step = Math.min(left, chunks[i % chunks.length] ?? 1);
        advance(cut, step, content);
        left -= step;
        // The first chunk list steps by 1 ms: only enough of it to keep the test quick.
        if (chunks.length === 1 && i > 20_000) {
          advance(cut, left, content);
          left = 0;
        }
      }
      expect(JSON.stringify(cut.slots)).toBe(JSON.stringify(whole.slots));
      expect(cut.counters).toEqual(whole.counters);
      expect(cut.bank).toEqual(whole.bank);
      expect(cut.now).toBe(whole.now);
    }
  });

  it('keeps its work across a save with a clone running', () => {
    const state = setup();
    advance(state, 30 * 60_000 + 123, content);
    const loaded = deserialize(serialize(state, 7), content);
    expect(loaded.slots.map((s) => s.action)).toEqual(state.slots.map((s) => s.action));
    expect(loaded.slots.map((s) => s.share)).toEqual([500, 500]);
    expect(isCloneSlot(loaded, content, 1)).toBe(true);
    advance(state, HOUR, content);
    advance(loaded, HOUR, content);
    expect(loaded.skills).toEqual(state.skills);
    expect(loaded.counters).toEqual(state.counters);
  });
});

describe('clone telemetry', () => {
  it('counts the time a clone runs and the pairs that ran together', () => {
    const state = cloner();
    expect(cloneTelemetry(state, content, defaultRules)).toEqual({
      openMs: 0,
      runMs: 0,
      share: 0,
      pairs: [],
    });
    start(state, 0, 'gather', 'core:mint');
    advance(state, 600_000, content);
    expect(cloneTelemetry(state, content, defaultRules).share).toBe(0);
    start(state, 1, 'craft', 'core:antidote');
    advance(state, 600_000, content);
    dispatch(state, { type: 'clone.dispel' }, content);
    advance(state, 600_000, content);
    const t = cloneTelemetry(state, content, defaultRules);
    expect(t.openMs).toBe(1_800_000);
    expect(t.runMs).toBe(600_000);
    expect(t.share).toBeCloseTo(1 / 3, 9);
    expect(t.pairs.length).toBe(1);
    expect(t.pairs[0]).toMatchObject({ ms: 600_000, linked: true });
    expect([t.pairs[0]?.a.kind, t.pairs[0]?.b.kind].sort()).toEqual(['craft', 'gather']);
  });

  it('counts nothing for a player without a clone', () => {
    const state = createState(1, content);
    state.skills.nin!.xp = xpAt(5);
    advance(state, 10_000, content);
    expect(cloneTelemetry(state, content, defaultRules).openMs).toBe(0);
  });
});

describe('the chain «Тіньові клони»', () => {
  it('runs its five steps, hands the scroll at the last one and ends with a clone', () => {
    const state = player({ seed: 9, natures: ['katon'], base: 1 });
    delete state.known[CLONE];
    state.loadouts.active = state.loadouts.active.filter((id) => id !== CLONE);
    const quest = (): { step: number; done: boolean } | undefined =>
      state.quests['core:shadow_clones'];
    const tick = () => advance(state, 1, content);
    tick();
    expect(quest()?.step).toBe(0);
    state.skills.nin!.xp = xpAt(30);
    state.skills.med!.xp = xpAt(20);
    tick();
    expect(quest()?.step).toBe(1);
    // Ten village missions count from the moment the step began.
    state.counters['missions.rank.V'] = (state.counters['missions.rank.V'] ?? 0) + 10;
    tick();
    expect(quest()?.step).toBe(2);
    state.skills.med!.xp = xpAt(40);
    tick();
    expect(quest()?.step).toBe(3);
    expect(state.bank[SCROLL] ?? 0).toBe(0);
    state.skills.nin!.xp = xpAt(50);
    tick();
    expect(quest()?.step).toBe(4);
    expect(state.bank[SCROLL]).toBe(1);
    expect(dispatch(state, { type: 'item.use', id: SCROLL }, content)).toEqual({ ok: true });
    tick();
    expect(quest()).toMatchObject({ step: 5, done: true });
    expect(state.slots.length).toBe(2);
    expect(start(state, 1, 'mission', 'core:v_clones')).toEqual({ ok: true });
  });
});

describe('fight analysis with a clone', () => {
  it('gives a forecast when the player is busy and the clone slot is free, and never uses the clone slot', () => {
    const state = build(zone(false), 31);
    state.known[CLONE] = true;
    growSlots(state, content);
    const drillId = content.exercises[0]?.id ?? '';
    expect(start(state, 0, 'drill', drillId)).toEqual({ ok: true });
    expect(isCloneSlot(state, content, 1)).toBe(true);
    const a = analyze(state, zone(false).target, { maxSessions: 1 });
    expect(a.sessionBlocked).toBeNull();
    expect(a.session).not.toBeNull();
  });
});

describe('the link is open to packs: the flow belongs to the action kind', () => {
  const FEEDER = 'x:pick';
  /** The clone technique also links the pack's kind to crafting; the pack kind is gathering with its own name. */
  const linkedContent: ContentDb = {
    ...content,
    techniques: content.techniques.map((t) =>
      t.id === CLONE
        ? { ...t, slotLinks: [...(t.slotLinks ?? []), { from: FEEDER, to: 'craft' }] }
        : t,
    ),
  };
  const gatherKind = defaultRules.actionKinds.gather;
  if (!gatherKind) throw new Error('gather');
  const rulesWith = (flow: boolean) =>
    addRule(defaultRules, 'actionKinds', FEEDER, {
      ...gatherKind,
      ...(flow ? {} : { flow: undefined }),
    });
  const antidoteUsesMint = (): boolean =>
    content.recipes
      .find((r) => r.id === 'core:antidote')
      ?.ingredients.some((i) => i.item === 'core:mint') ?? false;

  const alchemySpeed = (rules: ReturnType<typeof rulesWith>): number => {
    const state = cloner();
    expect(
      dispatch(
        state,
        { type: 'action.start', slot: 0, kind: FEEDER, id: 'core:mint' },
        linkedContent,
        rules,
      ).ok,
    ).toBe(true);
    expect(
      dispatch(
        state,
        { type: 'action.start', slot: 1, kind: 'craft', id: 'core:antidote' },
        linkedContent,
        rules,
      ).ok,
    ).toBe(true);
    return getMod(state, 'speed.skill.alch', linkedContent, rules).total;
  };

  it('gives the fed craft the bonus when the pack kind has a flow that makes what the craft uses', () => {
    expect(antidoteUsesMint()).toBe(true);
    const link = content.balance.K.clone.link;
    expect(alchemySpeed(rulesWith(true))).toBeCloseTo(1 + link, 9);
  });

  it('gives nothing when the kind has no flow, or when the kind is not linked by the data', () => {
    expect(alchemySpeed(rulesWith(false))).toBe(1);
    const state = cloner();
    const rules = rulesWith(true);
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: FEEDER, id: 'core:mint' },
      content,
      rules,
    );
    dispatch(
      state,
      { type: 'action.start', slot: 1, kind: 'craft', id: 'core:antidote' },
      content,
      rules,
    );
    expect(getMod(state, 'speed.skill.alch', content, rules).total).toBe(1);
  });
});

describe('the chakra drill of the clone chain', () => {
  const DRILL = 'core:chakra_halving_drill';
  const DRILL_SCROLL = 'core:scroll_chakra_halving_drill';

  it('is handed over after step 1 of the chain and learned from its scroll at Ninjutsu 40', () => {
    const state = player({ seed: 4, natures: ['katon'], levels: { nin: 29, med: 20 }, known: [] });
    delete state.known[CLONE];
    const quest = (): { step: number; done: boolean } | undefined =>
      state.quests['core:shadow_clones'];
    advance(state, 1, content);
    expect(quest()?.step).toBe(0);
    expect(state.bank[DRILL_SCROLL] ?? 0).toBe(0);
    expect(state.known[DRILL]).toBeUndefined();
    state.skills.nin!.xp = xpAt(30);
    advance(state, 1, content);
    expect(quest()?.step).toBe(1);
    expect(state.bank[DRILL_SCROLL]).toBe(1);
    // The scroll waits for the level the drill needs.
    expect(dispatch(state, { type: 'item.use', id: DRILL_SCROLL }, content).ok).toBe(false);
    state.skills.nin!.xp = xpAt(40);
    expect(dispatch(state, { type: 'item.use', id: DRILL_SCROLL }, content)).toEqual({ ok: true });
    expect(state.known[DRILL]).toBe(true);
    expect(start(state, 0, 'drill', DRILL).ok || start(state, 0, 'practice', DRILL).ok).toBe(true);
  });
});
