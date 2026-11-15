/** Missions: trios (A3), durations (A4), rewards (A5), XP (A6) and failures (A7). */
import { content, NATURE_IDS, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultRules,
  dispatch,
  gainMasteryXp,
  getMod,
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
import { genin, plainRules } from './helpers.ts';
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
  for (const n of NATURE_IDS) state.skills[n].xp = xpAt(natures.includes(n) ? 50 : 1);
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
    expect(getMod(state, 'mission.duration', content).total).toBeCloseTo(0.95, 12);
    expect(stageMs(state, 'core:weed')).toBe(Math.round(base * 0.95));
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
      payMission(state, m, false, content, defaultRules);
      expect(state.currencies.ryo, m.id).toBe(m.ryo);
      expect(state.currencies.rep, m.id).toBe(m.team ? m.rep : 0);
      expect(state.bank, m.id).toMatchObject(expected[m.id] ?? {});
      expect(state.currencies.intel, m.id).toBe(m.id === 'core:mail' ? 2 : 0);
      expect(state.missions.pending[m.resource ?? ''] ?? 0, m.id).toBe(m.resource ? 3 : 0);
    }
    expect(mission('core:cat').rep).toBe(K.repPerMission.D);
    expect(mission('core:caravan').rep).toBe(K.repPerMission.C);
    expect(mission('core:v_spar').rep).toBe(K.repPerMission.V);
  });

  it('pays the scroll part of the dig with the chance of the balance, within 3 standard errors', () => {
    const state = genin(5);
    const n = 20_000;
    const dig = mission('core:dig');
    for (let i = 0; i < n; i++) payMission(state, dig, false, content, defaultRules);
    const parts = state.bank['core:scrollpart_fire_dragon_flame_bullet'] ?? 0;
    const p = K.partDrop.mission;
    expect(Math.abs(parts - n * p)).toBeLessThanOrEqual(3 * Math.sqrt(n * p * (1 - p)));
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
    payMission(state, mission('core:cat'), false, content, defaultRules);
    payMission(state, mission('core:fire'), false, content, defaultRules);
    payMission(state, mission('core:v_water'), true, content, defaultRules);
    expect(state.counters).toMatchObject({
      'missions.total': 3,
      'missions.done.core:cat': 1,
      'missions.rank.D': 2,
      'missions.rank.V': 1,
      'missions.village.elemental': 1,
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
      const cap = K.missionRateCap[m.rank as 'D' | 'C' | 'V'];
      const shares: number[] = [];
      let seen = 0;
      let startedAt = 0;
      const total = () => content.skills.reduce((sum, s) => sum + state.skills[s.id].xp, 0);
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
    expect(state.skills.doton.xp).toBeGreaterThan(xpAt(30));
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

  it('a lost combat stage costs a Wound and restarts that stage; the stages before it stand', () => {
    // A player who cannot win: Scouting passes the first stage, the thief wins the second.
    const state = player({ natures: ['katon'], levels: { scout: 30, vit: 1, eva: 1, tai: 1 } });
    startMission(state, 'core:thief');
    advance(state, 40 * MIN, content);
    const events = state.events;
    expect(events.filter((e) => e.type === 'playerDefeated').length).toBeGreaterThan(0);
    expect(state.wounds.stacks).toBeGreaterThan(0);
    // The scouting stage was passed once and never repeated after the first fight started.
    const stages = events.flatMap((e) => (e.type === 'missionStage' ? [e] : []));
    const lastScout =
      stages
        .map((e, i) => (e.stage === 0 ? i : -1))
        .filter((i) => i >= 0)
        .at(-1) ?? -1;
    const firstCombat = stages.findIndex((e) => e.stage === 1);
    expect(firstCombat).toBeGreaterThan(lastScout);
    expect(state.slots[0]?.action?.kind).toBe('mission');
    expect(state.slots[0]?.data).toMatchObject({ s: 1 });
    expect((state.slots[0]?.data as { a: number }).a).toBeGreaterThan(0);
    expect(state.combat).not.toBeNull();
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

  it('keeps one fight at a time: a fight in another slot gives way to a combat stage, and the other way round', () => {
    const state = ableFor(mission('core:thief'));
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
    startMission(state, 'core:thief');
    advance(state, (state.slots[0]?.data as { p: { ms: number } }).p.ms + 2000, content);
    expect(state.combat?.enemy).toBe('core:thief');
    // A zone fight started in the second slot stops the mission's fight and the mission with it.
    expect(
      dispatch(state, { type: 'action.start', slot: 1, kind: 'fight', id: 'core:bandit' }, content)
        .ok,
    ).toBe(true);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.combat?.enemy).toBe('core:bandit');
    // A mission that reaches its combat stage stops the zone fight instead.
    const other = ableFor(mission('core:thief'));
    other.slots.push({ action: null, progress: 0, share: 0, data: null });
    dispatch(other, { type: 'action.start', slot: 1, kind: 'fight', id: 'core:bandit' }, content);
    startMission(other, 'core:thief');
    advance(other, 7 * 60_000, content);
    expect(other.slots[1]?.action).toBeNull();
    expect(other.slots[0]?.action?.kind).toBe('mission');
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

  it('rolls on the world stream and leaves the loot stream alone', () => {
    const a = player({ levels: { herb: 5 } });
    const loot = [...(a.rng.loot ?? [])];
    const world = [...(a.rng.world ?? [])];
    startMission(a, 'core:weed');
    advance(a, 30 * MIN, content);
    expect(a.rng.loot).toEqual(loot);
    expect(a.rng.world).not.toEqual(world);
  });
});
