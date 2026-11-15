/** Missions: trios (A3), durations (A4), rewards (A5), XP (A6) and failures (A7). */
import { content, NATURE_IDS, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  dispatch,
  gainMasteryXp,
  newCombat,
  rebalanceShares,
  stopSlot,
  deserialize,
  serialize,
  masteryLevel,
  missionBoard,
  missionForecast,
  openCrate,
  payMission,
  planStage,
  rate,
  skillLevel,
  xpAt,
  type GameState,
  type Rules,
} from '../src/index.ts';
import { genin, openWorld, plainRules } from './helpers.ts';
import {
  BOARD,
  DC,
  VILLAGE,
  ableFor,
  natureFor,
  mission,
  player,
  runUntilDone,
  startMission,
  villageUnits,
} from './missions-helpers.ts';

const MIN = 60_000;
const K = content.balance.K;

// ---------- A3 ----------

/** The doable village missions per trio, from the fixes document (section 4). */
const TRIOS: Record<string, number> = {
  'katon+futon+raiton': 7,
  'katon+futon+doton': 7,
  'katon+futon+suiton': 7,
  'katon+raiton+doton': 8,
  'katon+raiton+suiton': 8,
  'katon+doton+suiton': 8,
  'futon+raiton+doton': 7,
  'futon+raiton+suiton': 7,
  'futon+doton+suiton': 7,
  'raiton+doton+suiton': 8,
};

/** Everything but the natures is in place: levels high, the scroll techniques known, the items in the bank. */
function maxed(natures: NatureId[], team: boolean): GameState {
  const state = ableFor(mission('core:weed'), natures);
  for (const n of NATURE_IDS) state.skills[n]!.xp = xpAt(natures.includes(n) ? 50 : 1);
  // The scroll technique of Futon is known to whoever has the nature.
  if (natures.includes('futon')) state.known['core:vacuum_wave'] = true;
  if (!team) state.team = null;
  return state;
}

describe('A3: the trios and a player with no nature', () => {
  for (const [label, villageDoable] of Object.entries(TRIOS)) {
    it(`${label}: all 12 D/C missions and ${villageDoable} village missions`, () => {
      const natures = label.split('+') as NatureId[];
      for (const team of [false, true]) {
        const state = maxed(natures, team);
        const board = missionBoard(state, content, defaultRules);
        const startable = (id: string) => board.find((e) => e.id === id)?.startable ?? false;
        expect(DC.filter((m) => startable(m.id)).length, `${label} team=${team}`).toBe(12);
        // The table counts what the player's own natures open; a teammate can open more.
        if (!team) {
          expect(VILLAGE.filter((m) => startable(m.id)).length, label).toBe(villageDoable);
        } else {
          expect(VILLAGE.filter((m) => startable(m.id)).length).toBeGreaterThanOrEqual(
            villageDoable,
          );
        }
      }
    });
  }

  it('with no nature at all the 12 D/C missions are startable', () => {
    const state = maxed([], false);
    const board = missionBoard(state, content, defaultRules);
    expect(DC.filter((m) => board.find((e) => e.id === m.id)?.startable).length).toBe(12);
    // Some village missions need no nature: Sparring, Fence needs Raiton, Rubble goes by Taijutsu, Clones, Seal.
    const open = VILLAGE.filter((m) => board.find((e) => e.id === m.id)?.startable).map(
      (m) => m.id,
    );
    expect(open).toEqual(
      expect.arrayContaining(['core:v_spar', 'core:v_rubble', 'core:v_clones', 'core:v_seal']),
    );
  });
});

// ---------- A4 ----------

const stageMs = (state: GameState, id: string, index = 0, rules: Rules = defaultRules): number =>
  planStage(state, mission(id), index, content, rules)?.ms ?? 0;

describe('A4: durations', () => {
  it('takes its minutes at the requirement, within 1%', () => {
    // A player who can do every stage of a mission with no fallback is never slower than the mission's minutes.
    for (const m of BOARD.filter((x) => x.slow.every((s) => s.length === 0))) {
      const forecast = missionForecast(ableFor(m), m, content, defaultRules);
      expect(forecast.doable, m.id).toBe(true);
      expect(forecast.nominalMs, m.id).toBeLessThanOrEqual(m.minutes * MIN * 1.01);
    }
    // A player exactly at each requirement: weed (Herbalism 1), the mail (Athletics 40).
    expect(stageMs(player({ levels: { herb: 1 } }), 'core:weed')).toBe(2 * MIN);
    expect(stageMs(player({ levels: { ath: 40 } }), 'core:mail')).toBe(20 * MIN);
    expect(
      stageMs(player({ natures: ['doton'], levels: { doton: 30 }, team: false }), 'core:rockfall'),
    ).toBe(6 * MIN);
  });

  it('is shortened by each level above the requirement, by exactly the share', () => {
    const state = player({ levels: { herb: 11 } });
    expect(stageMs(state, 'core:weed')).toBe(Math.round(2 * MIN * (1 - K.mission.perLevel * 10)));
    const high = player({ levels: { herb: 50 } });
    expect(stageMs(high, 'core:weed')).toBe(
      Math.round(2 * MIN * Math.max(K.mission.floor, 1 - K.mission.perLevel * 49)),
    );
  });

  it('is shortened by the Mastery of the technique used', () => {
    const state = player({ natures: ['doton'], levels: { doton: 30 }, team: false });
    const base = stageMs(state, 'core:rockfall');
    const tech = planStage(state, mission('core:rockfall'), 0, content, defaultRules)?.tech ?? '';
    expect(tech).not.toBe('');
    gainMasteryXp(state, tech, xpAt(21) - (state.mastery[tech]?.xp ?? 0), content);
    expect(masteryLevel(state, tech, content)).toBe(21);
    expect(stageMs(state, 'core:rockfall')).toBe(
      Math.round(base * (1 - K.mission.masteryTime * 20)),
    );
  });

  it('is shortened by the ration, the mission modifier and the Ninjutsu modifier', () => {
    const state = player({ levels: { herb: 1 } });
    const base = stageMs(state, 'core:weed');
    const ration = 'core:sushenyi_paiok';
    state.bank[ration] = 2;
    expect(dispatch(state, { type: 'item.use', id: ration }, content)).toEqual({ ok: true });
    expect(missionForecast(state, mission('core:weed'), content, defaultRules).stages[0]?.ms).toBe(
      Math.round(base * 0.95),
    );
    // The run takes the ration: afterwards no ration is armed and the next run is not shortened.
    startMission(state, 'core:weed');
    expect(state.buffs[ration]).toBeUndefined();
    expect(state.slots[0]?.data).toMatchObject({ r: -0.05 });
    const shortened = (state.slots[0]?.data as { p: { ms: number } }).p.ms;
    expect(shortened).toBe(Math.round(base * 0.95));
    runUntilDone(state, 'core:weed', 10 * MIN, 2);
    expect(state.slots[0]?.data).toMatchObject({ r: 0 });
    expect(
      planStage(player({ levels: { herb: 1 } }), mission('core:weed'), 0, content, defaultRules)
        ?.ms,
    ).toBe(base);
    // A modifier of the rules.
    const rules: Rules = {
      ...defaultRules,
      modifierProviders: [
        () => [{ key: 'mission.duration', op: 'add', value: -0.05, group: 'items', source: 't' }],
      ],
    };
    expect(stageMs(player({ levels: { herb: 1 } }), 'core:weed', 0, rules)).toBe(
      Math.round(base * 0.95),
    );
  });

  it('has the ration enter a duration exactly once: the forecast equals the run, for one and three stages', () => {
    const ration = 'core:sushenyi_paiok';
    for (const id of ['core:weed', 'core:fire']) {
      const state = ableFor(mission(id));
      state.bank[ration] = 1;
      expect(dispatch(state, { type: 'item.use', id: ration }, content).ok).toBe(true);
      const forecast = missionForecast(state, mission(id), content, defaultRules);
      expect(forecast.ration).toBe(-0.05);
      const plain = missionForecast(ableFor(mission(id)), mission(id), content, defaultRules);
      expect(forecast.nominalMs).toBeLessThan(plain.nominalMs);
      expect(Math.abs(forecast.nominalMs - plain.nominalMs * 0.95)).toBeLessThanOrEqual(
        mission(id).stages.length,
      );
      startMission(state, id);
      expect(state.buffs[ration]).toBeUndefined();
      // Every attempt of every stage lasts what the forecast said.
      const gaps: number[] = [];
      let last = 0;
      for (let i = 0; i < 3600 && (state.counters[`missions.done.${id}`] ?? 0) < 1; i++) {
        advance(state, 1000, content);
      }
      for (const e of state.events) {
        if (e.type !== 'missionStage') continue;
        gaps.push(e.at - last);
        last = e.at;
        expect(e.at - (gaps.length > 1 ? 0 : 0)).toBeGreaterThan(0);
      }
      const stages = state.events.flatMap((e) => (e.type === 'missionStage' ? [e] : []));
      stages.forEach((e, i) => {
        expect(gaps[i], `${id} stage ${e.stage}`).toBe(forecast.stages[e.stage]?.ms);
      });
      expect(stages.length).toBeGreaterThanOrEqual(mission(id).stages.length);
    }
  });

  it('takes twice the time for the fallback, and a stage with a teammate follows the best of the team', () => {
    const buckets = player({ natures: ['katon'], levels: { ath: 25 }, team: false });
    const water = player({ natures: ['suiton'], levels: { ath: 25, suiton: 20 }, team: false });
    expect(stageMs(buckets, 'core:fire', 1)).toBe(2 * stageMs(water, 'core:fire', 1));
  });

  it('runs a stage for exactly its time: the first attempt ends then', () => {
    const state = player({ levels: { herb: 1 } });
    startMission(state, 'core:weed');
    advance(state, 2 * MIN - 1, content);
    expect(state.events.filter((e) => e.type === 'missionStage')).toHaveLength(0);
    advance(state, 1, content);
    expect(state.events.filter((e) => e.type === 'missionStage')).toHaveLength(1);
  });
});

// ---------- A5 ----------

describe('A5: rewards', () => {
  it('pay ryo, Reputation, payment in kind, Intel and village units exactly per the data', () => {
    const expected: Record<string, Record<string, number>> = {
      'core:weed': { 'core:rice': 6 },
      'core:fire': { 'core:rice': 6 },
      'core:drought': { 'core:rice': 6, 'core:spice': 2 },
      'core:rockfall': { 'core:salt': 6 },
      'core:thief': { 'core:note': 1 },
      'core:caravan': { 'core:crate': 1 },
    };
    for (const m of BOARD) {
      const state = genin();
      // Without the village's bonuses: exactly the data.
      payMission(state, m, [], content, plainRules);
      expect(state.currencies.ryo, m.id).toBe(m.ryo);
      expect(state.currencies.rep, m.id).toBe(m.team ? m.rep : 0);
      expect(state.bank, m.id).toMatchObject(expected[m.id] ?? {});
      expect(state.currencies.intel, m.id).toBe(m.id === 'core:mail' ? 2 : 0);
      expect(villageUnits(state, m.resource ?? ''), m.id).toBe(m.resource ? 3 : 0);
    }
    expect(mission('core:cat').rep).toBe(K.repPerMission.D);
    expect(mission('core:caravan').rep).toBe(K.repPerMission.C);
    expect(mission('core:v_spar').rep).toBe(K.repPerMission.V);
  });

  it('pays the scroll part of the dig with the chance of the balance, within 3 standard errors', () => {
    const state = genin(5);
    const n = 20_000;
    const dig = mission('core:dig');
    for (let i = 0; i < n; i++) payMission(state, dig, [], content, defaultRules);
    const parts = state.bank['core:scrollpart_fire_dragon_flame_bullet'] ?? 0;
    const p = K.partDrop.mission;
    expect(Math.abs(parts - n * p!)).toBeLessThanOrEqual(3 * Math.sqrt(n * p! * (1 - p!)));
  });

  it('opens a merchant crate into oil, salt, spices and now and then a gem', () => {
    const state = genin(6);
    const n = 20_000;
    state.bank['core:crate'] = n;
    for (let i = 0; i < n; i++) expect(openCrate(state, 'core:crate', content).ok).toBe(true);
    expect(state.bank['core:crate']).toBeUndefined();
    const { goods, gem } = K.crate;
    for (const [item, [min, max]] of Object.entries(goods)) {
      const have = state.bank[item] ?? 0;
      expect(have).toBeGreaterThanOrEqual(min * n);
      expect(have).toBeLessThanOrEqual(max * n);
      // The mean of a uniform whole number between the bounds, within 3 standard errors.
      const span = max - min + 1;
      const sd = Math.sqrt((span * span - 1) / 12);
      expect(Math.abs(have - (n * (min + max)) / 2)).toBeLessThanOrEqual(3 * sd * Math.sqrt(n));
    }
    const gems = state.bank[gem.item] ?? 0;
    expect(Math.abs(gems - n * gem.chance)).toBeLessThanOrEqual(
      3 * Math.sqrt(n * gem.chance * (1 - gem.chance)),
    );
  });

  it('refuses a crate that is not in the bank', () => {
    expect(dispatch(genin(), { type: 'item.use', id: 'core:crate' }, content)).toEqual({
      ok: false,
      reason: 'error.noItem',
    });
  });

  it('keeps the notes as an item with data and no command', () => {
    const note = content.items.find((i) => i.id === 'core:note');
    expect(note?.fx).toEqual({ kind: 'bingoNote', levels: 1 });
    const state = genin();
    state.bank['core:note'] = 1;
    expect(dispatch(state, { type: 'item.use', id: 'core:note' }, content).ok).toBe(false);
    expect(state.bank['core:note']).toBe(1);
  });

  it('counts the missions finished for the quests', () => {
    const state = genin();
    payMission(state, mission('core:cat'), [], content, defaultRules);
    payMission(state, mission('core:fire'), [], content, defaultRules);
    payMission(state, mission('core:v_water'), ['suiton'], content, defaultRules);
    expect(state.counters).toMatchObject({
      'missions.total': 3,
      'missions.done.core:cat': 1,
      'missions.rank.D': 2,
      'missions.rank.V': 1,
      'missions.elemental.V': 1,
      'missions.elemental': 1,
    });
  });
});

// ---------- A6 ----------

describe('A6: experience', () => {
  it('pays 70% to 100% of the practice rate at the level of each stage, and prints the table', () => {
    const rows: string[] = [];
    for (const m of BOARD) {
      const state = ableFor(m, [natureFor(m)], 1, 40);
      state.team = null;
      startMission(state, m.id);
      const cap = K.missionRateCap[m.rank as 'D' | 'C' | 'V']!;
      const shares: number[] = [];
      let seen = 0;
      let startedAt = 0;
      const total = () => content.skills.reduce((sum, s) => sum + state.skills[s.id]!.xp, 0);
      let before = total();
      let guard = 0;
      while (shares.length < m.stages.length && guard++ < 100_000) {
        const levels = Object.fromEntries(
          content.skills.map((s) => [s.id, skillLevel(state, s.id, content)]),
        );
        const planned = (state.slots[0]?.data as { p?: { skill?: string } } | null)?.p?.skill ?? '';
        advance(state, 1000, content, plainRules);
        const stages = state.events.filter((e) => e.type === 'missionStage');
        if (stages.length === seen) continue;
        const event = stages[stages.length - 1];
        if (event?.type !== 'missionStage') continue;
        seen = stages.length;
        const stage = m.stages[event.stage];
        const hours = (event.at - startedAt) / (60 * MIN);
        startedAt = event.at;
        const gained = total() - before;
        before = total();
        // The level the rate is taken at: that of the skill of the stage, the enemy's in a fight.
        const level =
          stage?.t === 'combat'
            ? (content.enemies.find((e) => e.id === stage.enemy)?.cl ?? 1)
            : planned
              ? (levels[planned] ?? 1)
              : null;
        if (level === null || hours <= 0) continue;
        shares.push(gained / hours / rate(Math.min(level, cap), content));
      }
      for (const share of shares) {
        expect(share, m.id).toBeGreaterThanOrEqual(0.7);
        expect(share, m.id).toBeLessThanOrEqual(1.0);
      }
      const mean = shares.reduce((a, b) => a + b, 0) / Math.max(1, shares.length);
      rows.push(
        `${m.id.padEnd(18)} ${(mean * 100).toFixed(0)}% over ${shares.length} stage attempts`,
      );
    }
    console.log(
      `\nXP of the skill and combat stages as a share of the practice rate\n${rows.join('\n')}`,
    );
  });

  it('gives Mastery to the technique a stage used', () => {
    const state = player({
      natures: ['doton'],
      levels: { doton: 30, ath: 25, scout: 1 },
      team: false,
    });
    const tech = planStage(state, mission('core:rockfall'), 0, content, defaultRules)?.tech ?? '';
    expect(state.mastery[tech]?.xp ?? 0).toBe(0);
    startMission(state, 'core:rockfall');
    runUntilDone(state, 'core:rockfall', 30 * MIN, 1);
    expect(state.mastery[tech]?.xp ?? 0).toBeGreaterThan(0);
    expect(state.skills.doton!.xp).toBeGreaterThan(xpAt(30));
  });
});

// ---------- A7 ----------

describe('A7: failures', () => {
  it('a failed attempt repeats only its stage, and costs only time', () => {
    const m = mission('core:cat');
    // Find a game in which an attempt fails (one in ten does at the requirement), and read what follows.
    let found = false;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const state = player({ seed, natures: ['katon'], levels: { scout: 1, ath: 5 }, team: false });
      startMission(state, m.id);
      for (let i = 0; i < 1200 && !found; i++) {
        advance(state, 1000, content);
        const stages = state.events.flatMap((e) => (e.type === 'missionStage' ? [e] : []));
        const failed = stages.findIndex((e) => !e.ok);
        if (failed < 0 || stages.length <= failed + 1) continue;
        found = true;
        expect(stages[failed + 1]?.stage, 'the failed stage comes again').toBe(
          stages[failed]?.stage,
        );
        // Nothing was paid for the failed attempt: ryo is paid once per finished mission.
        expect(state.currencies.ryo).toBe(m.ryo * (state.counters['missions.done.core:cat'] ?? 0));
        if (stages[failed]?.stage === 1)
          expect(stages.slice(0, failed + 2).filter((e) => e.stage === 0)).toHaveLength(1);
      }
    }
    expect(found).toBe(true);
  });

  it('an items stage takes its items at its start and blocks the start when they are missing', () => {
    const state = player({
      natures: ['katon'],
      levels: { scout: 15, tai: 36, vit: 36, eva: 36, med: 20, cc: 20, katon: 36 },
      bank: { 'core:antidote': 12 },
    });
    expect(startMission(state, 'core:well')).toEqual({ ok: true });
    advance(state, 20 * MIN, content);
    expect(state.bank['core:antidote'] ?? 0).toBeLessThan(12);
    expect((12 - (state.bank['core:antidote'] ?? 0)) % 5).toBe(0);
    // With fewer than five left the mission stops at its next start and names the antidote.
    state.bank['core:antidote'] = 4;
    advance(state, 4 * 60 * MIN, content);
    expect(state.slots[0]?.action).toBeNull();
    const stopped = state.events.filter((e) => e.type === 'actionStopped').at(-1);
    expect(stopped).toMatchObject({ reason: 'requirements', missing: 'core:antidote' });
  });

  it('a lost combat stage costs a Wound and restarts that stage until it has been lost too often; the stages before it stand', () => {
    // A player who cannot win: Scouting passes the first stage, the thief wins the second.
    const state = player({ natures: ['katon'], levels: { scout: 30, vit: 1, eva: 1, tai: 1 } });
    startMission(state, 'core:thief');
    const lost = (): number => state.events.filter((e) => e.type === 'playerDefeated').length;
    // After the first defeat the stage has started over: the same stage, a new fight, a Wound.
    for (let i = 0; i < 40 * 60 && lost() < 1; i++) advance(state, 1000, content);
    expect(lost()).toBe(1);
    expect(state.wounds.stacks).toBeGreaterThan(0);
    expect(state.slots[0]?.data).toMatchObject({ s: 1, a: 1 });
    expect(state.combat).not.toBeNull();
    // The scouting stage was passed once and never repeated.
    const stages = state.events.flatMap((e) => (e.type === 'missionStage' ? [e] : []));
    expect(stages.filter((e) => e.stage === 0)).toHaveLength(1);
    // After as many lost fights in a row as the balance allows, the mission stops and says why.
    advance(state, 6 * 60 * MIN, content);
    expect(lost()).toBe(content.balance.K.mission.maxDefeats);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.combat).toBeNull();
    const stopped = state.events.filter((e) => e.type === 'actionStopped').at(-1);
    expect(stopped).toMatchObject({ reason: 'requirements', cause: 'error.missionTooHard' });
    expect(state.counters['missions.done.core:thief'] ?? 0).toBe(0);
  });

  it('stopping a mission and starting it again begins from the first stage', () => {
    const state = player({ natures: ['katon'], levels: { scout: 30, ath: 10 }, team: false });
    startMission(state, 'core:cat');
    advance(state, 90_000, content);
    expect(state.slots[0]?.data).toMatchObject({ s: 1 });
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    startMission(state, 'core:cat');
    expect(state.slots[0]?.data).toMatchObject({ s: 0, a: 0 });
    expect(state.slots[0]?.progress).toBe(0);
  });

  describe('one fight-capable action at a time', () => {
    const two = (id: string) => {
      const state = ableFor(mission(id));
      openWorld(state);
      state.slots.push({ action: null, progress: 0, share: 0, data: null });
      return state;
    };
    const busy = { ok: false, reason: 'error.fightBusy' };
    const fightIn = (state: GameState, slot: number) =>
      dispatch(state, { type: 'action.start', slot, kind: 'fight', id: 'core:bandit' }, content);

    it('refuses a fight while a mission with a combat stage runs, even on its skill stage (the reviewer scenario)', () => {
      const state = two('core:thief');
      startMission(state, 'core:thief', 0);
      advance(state, 30_000, content);
      expect(state.slots[0]?.data).toMatchObject({ s: 0 });
      expect(fightIn(state, 1)).toEqual(busy);
      expect(
        dispatch(
          state,
          { type: 'action.start', slot: 1, kind: 'operation', id: 'core:op_hideout' },
          content,
        ),
      ).toEqual(busy);
      // The mission is not touched: it goes on to its combat stage and finishes.
      runUntilDone(state, 'core:thief', 30 * MIN);
      expect(state.counters['missions.done.core:thief']).toBe(1);
      expect(state.events.filter((e) => e.type === 'actionStopped')).toEqual([]);
    });

    it('refuses a second mission with a combat stage, and the caravan in both slots', () => {
      const state = two('core:caravan');
      startMission(state, 'core:caravan', 0);
      expect(startMission(state, 'core:caravan', 1).ok).toBe(false);
      expect(startMission(state, 'core:thief', 1)).toEqual(busy);
      expect(startMission(state, 'core:dig', 1)).toEqual(busy);
      expect(state.slots[0]?.action?.kind).toBe('mission');
    });

    it('refuses a mission with a combat stage, or a fight, while a zone fight runs in the other slot', () => {
      const state = two('core:thief');
      expect(fightIn(state, 1).ok).toBe(true);
      expect(startMission(state, 'core:thief', 0)).toEqual(busy);
      expect(fightIn(state, 0)).toEqual(busy);
      expect(state.combat?.owner).toBe(1);
      // A mission with no fight in it goes beside the fight.
      expect(startMission(state, 'core:weed', 0).ok).toBe(true);
      expect(state.combat?.owner).toBe(1);
      expect(state.slots[1]?.action?.kind).toBe('fight');
    });

    it('lets a fight-free mission run beside a mission with a fight, and the owner start again in its own slot', () => {
      const state = two('core:thief');
      startMission(state, 'core:thief', 0);
      expect(startMission(state, 'core:weed', 1).ok).toBe(true);
      // Replacing the slot that holds the fight is the owner's own business.
      expect(startMission(state, 'core:thief', 0).ok).toBe(true);
      dispatch(state, { type: 'action.stop', slot: 0 }, content);
      expect(fightIn(state, 0).ok).toBe(true);
    });

    it('refuses the same mission in two slots', () => {
      const state = two('core:weed');
      expect(startMission(state, 'core:weed', 0).ok).toBe(true);
      expect(startMission(state, 'core:weed', 1)).toEqual({
        ok: false,
        reason: 'error.missionRunning',
      });
      expect(state.slots[1]?.action).toBeNull();
      // Starting it again in its own slot restarts it.
      expect(startMission(state, 'core:weed', 0).ok).toBe(true);
    });

    it('never aborts a mission whose combat stage finds the fight busy: it waits, and resumes when the fight is free', () => {
      const state = two('core:thief');
      startMission(state, 'core:thief', 0);
      // The first stage ends a little later; meanwhile a fight appears in the other slot (a state an old save can hold).
      advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms - 1000, content);
      const bandit = content.enemies.find((e) => e.id === 'core:bandit');
      if (!bandit) throw new Error('no bandit');
      const other = state.slots[1];
      if (!other) throw new Error('no slot');
      other.action = { kind: 'fight', id: 'core:bandit' };
      state.combat = newCombat(state, bandit, content, defaultRules, 1);
      rebalanceShares(state);
      advance(state, 20_000, content);
      expect(state.slots[0]?.action?.kind).toBe('mission');
      expect(state.slots[0]?.data).toMatchObject({ s: 1, q: 1, f: 0 });
      expect(state.events.filter((e) => e.type === 'actionStopped')).toEqual([]);
      // A save taken while it waits loads as it was, and goes on the same.
      const copy = deserialize(serialize(state), content);
      expect(copy.slots[0]?.data).toMatchObject({ s: 1, q: 1 });
      expect(serialize(copy)).toBe(serialize(state));
      // The fight is freed: the mission starts its fight and finishes.
      stopSlot(state, 1, 'manual', content, defaultRules);
      stopSlot(copy, 1, 'manual', content, defaultRules);
      advance(state, 2500, content);
      advance(copy, 2500, content);
      expect(state.slots[0]?.data).toMatchObject({ s: 1, q: 0 });
      expect(state.combat?.owner).toBe(0);
      expect(serialize(copy)).toBe(serialize(state));
      runUntilDone(state, 'core:thief', 30 * MIN);
      expect(state.counters['missions.done.core:thief']).toBe(1);
    });
  });

  it('refills the pouch from the bank for a combat stage, at its start and after a win', () => {
    const state = ableFor(mission('core:thief'));
    const heal = 'core:bulion_ramenu';
    state.bank[heal] = 40;
    expect(dispatch(state, { type: 'pouch.set', slot: 0, item: heal }, content).ok).toBe(true);
    state.pouch.slots[0] = { id: heal, n: 1 };
    startMission(state, 'core:thief');
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 500, content);
    expect(state.combat).not.toBeNull();
    // Packed to the stack on the way into the fight.
    expect(state.combat?.fight.pouch[0]).toEqual({ id: heal, n: content.balance.K.pouchStack });
    // Used up during the fight, and refilled when it is won.
    if (state.combat) state.combat.fight.pouch[0] = { id: heal, n: 0 };
    advance(state, 5 * 60_000, content);
    expect(state.pouch.slots[0]?.n).toBe(content.balance.K.pouchStack);
  });

  it('has a fight at hand in the combat stage, and drops it when the mission stops', () => {
    const state = ableFor(mission('core:thief'));
    startMission(state, 'core:thief');
    // The scouting stage ends first; the fight begins at once.
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 2000, content);
    expect(state.slots[0]?.data).toMatchObject({ s: 1 });
    expect(state.combat).not.toBeNull();
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    expect(state.combat).toBeNull();
  });

  it('rolls on the action stream and leaves the loot and world streams alone', () => {
    const a = player({ levels: { herb: 5 } });
    const loot = [...(a.rng.loot ?? [])];
    const world = [...(a.rng.world ?? [])];
    const action = [...(a.rng.action ?? [])];
    startMission(a, 'core:weed');
    advance(a, 30 * MIN, content);
    expect(a.rng.loot).toEqual(loot);
    expect(a.rng.world).toEqual(world);
    expect(a.rng.action).not.toEqual(action);
  });
});
