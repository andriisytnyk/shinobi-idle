/**
 * The forecast API of the missions: what the interface shows is what core computed. Every board
 * mission is run through the prepared states of `missions-states.ts`.
 */
import { content, type Mission } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addRule,
  advance,
  armedRation,
  currencyOf,
  defaultRules,
  dispatch,
  evalReq,
  fightXpShares,
  getMod,
  missionBoard,
  missionForecast,
  missionGoalReq,
  missionStageWays,
  missionStatus,
  payMission,
  planStage,
  rationItems,
  readRun,
  stageXp,
  xpGain,
  type GameEvent,
  type GameState,
  type MissionDoneEvent,
  type Rules,
} from '../src/index.ts';
import { ableFor, player } from './missions-helpers.ts';
import { BOARD, STATES, STATUS_STATES } from './missions-states.ts';

const K = content.balance.K;
const STUDY = currencyOf(content, 'study') ?? '';

/** Every board mission in every prepared state. */
function eachCase(run: (m: Mission, name: string, state: GameState) => void): void {
  for (const m of BOARD) for (const [name, build] of Object.entries(STATES)) run(m, name, build(m));
}

/** States besides the six: the player alone with Athletics but no nature technique for the stage (the slow fallback), and with a team too. */
const EXTRA: Record<string, (m: Mission) => GameState> = {
  slowAlone: () => {
    const state = player({
      seed: 21,
      natures: ['katon'],
      levels: { ath: 30, scout: 20, herb: 5, tai: 20 },
    });
    state.team = null;
    return state;
  },
  slowWithTeam: () =>
    player({ seed: 22, natures: ['doton'], levels: { ath: 30, scout: 20, herb: 5, tai: 20 } }),
};

// ---------- the parts of a duration ----------

describe('the forecast of a stage says how its length is made', () => {
  const check = (state: GameState, m: Mission, rules: Rules, label: string): number => {
    let floored = 0;
    for (const stage of missionForecast(state, m, content, rules).stages) {
      if (!stage.path) {
        expect(stage.duration, label).toBeNull();
        continue;
      }
      const d = stage.duration;
      expect(d, label).not.toBeNull();
      if (!d) continue;
      // The factors multiply out to the stage time exactly, as the planner rounds it.
      expect(
        Math.max(1, Math.round(d.baseMs * d.level * d.mastery * d.slow * d.factor)),
        label,
      ).toBe(stage.ms);
      expect(d.ms, label).toBe(stage.ms);
      let total = d.modifiers[0]?.total ?? 1;
      for (const own of d.modifiers.slice(1)) total *= own.total;
      expect(d.modifiersTotal, label).toBe(total);
      expect(d.factor, label).toBe(Math.max(d.floor, d.modifiersTotal * d.ration));
      expect(d.floored, label).toBe(d.floor > d.modifiersTotal * d.ration);
      expect(d.floor, label).toBe(K.mission.minFactor);
      expect(d.slow, label).toBe(stage.path.slow ? K.mission.slowAlt : 1);
      expect(d.ration, label).toBe(1 + armedRation(state, content));
      if (d.floored) floored++;
    }
    return floored;
  };

  it('for every mission in the six states', () => {
    eachCase((m, name, state) => check(state, m, defaultRules, `${m.id}@${name}`));
  });

  it('also when the floor binds, and with modifiers from a source', () => {
    const fast = addRule(defaultRules, 'modifierProviders', () => [
      { key: 'mission.duration', op: 'mul', value: 0.05, group: 'items', source: 'test' },
    ]);
    let bound = 0;
    for (const m of BOARD) {
      const state = STATES.rationed?.(m);
      if (state) bound += check(state, m, fast, `${m.id}@fast`);
    }
    expect(bound).toBeGreaterThan(0);
    const sample = missionForecast(
      ableFor(BOARD[0] as Mission),
      BOARD[0] as Mission,
      content,
      fast,
    );
    const parts = sample.stages[0]?.duration?.modifiers[0]?.parts ?? [];
    expect(parts.some((p) => p.source === 'test')).toBe(true);
  });

  it('shows the chosen way with its requirement, level and Mastery', () => {
    eachCase((m, name, state) => {
      for (const stage of missionForecast(state, m, content, defaultRules).stages) {
        if (!stage.path) continue;
        const plan = planStage(
          state,
          m,
          stage.index,
          content,
          defaultRules,
          armedRation(state, content),
        );
        expect(stage.path, `${m.id}@${name}`).toMatchObject({
          level: plan?.level,
          min: plan?.min,
          mastery: plan?.mastery,
        });
      }
    });
  });
});

// ---------- the ways of a stage ----------

type Way = ReturnType<typeof missionStageWays>['ways'][number];

describe('missionStageWays', () => {
  const seen = new Set<string>();

  it('agrees with planStage for every mission in the six states and two more', () => {
    const each = (run: (m: Mission, name: string, state: GameState) => void): void => {
      eachCase(run);
      for (const m of BOARD)
        for (const [name, build] of Object.entries(EXTRA)) run(m, name, build(m));
    };
    each((m, name, state) => {
      const ration = armedRation(state, content);
      m.stages.forEach((_, i) => {
        const label = `${m.id}@${name}#${i}`;
        const { ways, used } = missionStageWays(state, m.id, i, content, defaultRules);
        const plan = planStage(state, m, i, content, defaultRules, ration);
        expect(ways.filter((w) => w.used).length <= 1, label).toBe(true);
        if (!plan) {
          expect(used, label).toBe(-1);
          expect(
            ways.some((w) => w.met && w.kind !== 'free'),
            label,
          ).toBe(false);
          return;
        }
        const way = ways[used] as Way;
        expect(way.used, label).toBe(true);
        expect(way.met, label).toBe(true);
        expect(
          [way.who, way.skill, way.tech, way.slow, way.intel, way.level, way.min, way.mastery],
          label,
        ).toEqual([
          plan.who,
          plan.skill,
          plan.tech,
          plan.slow,
          plan.intel,
          plan.level,
          plan.min,
          plan.mastery,
        ]);
        for (const w of ways) {
          if (w.req) {
            // The tree the player is shown says what the planner decided, known-technique condition included.
            expect(w.result?.met, `${label} ${w.skill}${w.tech}`).toBe(w.met);
          } else {
            expect(w.result, label).toBeNull();
          }
          if (w.kind === 'skip') expect(w.met, label).toBe(w.have >= w.intel);
          if (w.kind === 'skip') expect(w.have, label).toBe(state.currencies[STUDY] ?? 0);
          if (w.kind === 'mate') expect(w.result, label).toBeNull();
          if (w.used) {
            if (w.kind === 'mate') seen.add('mate');
            if (w.kind === 'skip') seen.add('intel');
            if (w.slow && w.kind === 'self') seen.add('slow');
            if (w.kind === 'self' && !w.slow) seen.add('self');
          }
        }
        // The tiers: a normal way of the player beats everything, a slow one or a teammate beats Intel.
        const normal = ways.some((w) => w.met && w.kind !== 'skip' && w.kind !== 'mate' && !w.slow);
        if (normal) expect(way.kind === 'self' || way.kind === 'free', label).toBe(true);
        if (way.kind === 'skip') {
          expect(
            ways.filter((w) => w.met && w.kind !== 'skip'),
            label,
          ).toEqual([]);
        }
      });
    });
  });

  it('covers a teammate, a slow fallback and the Intel skip being used', () => {
    for (const kind of ['mate', 'slow', 'intel', 'self']) {
      expect(seen.has(kind), kind).toBe(true);
    }
  });

  it('lists two alternatives that are both met, and uses exactly one of them', () => {
    let found = 0;
    for (const m of BOARD) {
      m.stages.forEach((stage, i) => {
        if (stage.t !== 'tech' || stage.any.length < 2) return;
        const state = ableFor(m, ['katon', 'suiton', 'doton'], 1, 50);
        const { ways } = missionStageWays(state, m.id, i, content, defaultRules);
        const normal = ways.filter((w) => w.kind === 'self' && w.met && !w.slow);
        if (normal.length < 2) return;
        found++;
        const used = ways.filter((w) => w.used);
        expect(used).toHaveLength(1);
        expect(used[0]).toMatchObject({ kind: 'self', met: true, slow: false });
        // The one used is the quickest of the normal ways the player meets.
        const plan = planStage(state, m, i, content, defaultRules);
        expect(plan).toMatchObject({ skill: used[0]?.skill, tech: used[0]?.tech });
      });
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a Suiton level with no Suiton technique does not meet a Suiton way', () => {
    let checked = 0;
    for (const m of BOARD) {
      m.stages.forEach((stage, i) => {
        const wants = stage.t === 'tech' ? stage.any.filter((a) => a.skill === 'suiton') : [];
        if (wants.length === 0) return;
        const state = player({
          natures: ['suiton'],
          levels: { suiton: 50, ath: 1, scout: 1, herb: 1 },
        });
        for (const t of content.techniques) if (t.skill === 'suiton') delete state.known[t.id];
        const { ways } = missionStageWays(state, m.id, i, content, defaultRules);
        const water = ways.find((w) => w.kind === 'self' && w.skill === 'suiton');
        expect(water?.met).toBe(false);
        expect(water?.level).toBeGreaterThanOrEqual(water?.min ?? 99);
        expect(water?.result?.met).toBe(false);
        // The tree names the condition: a known technique of the skill, at the level.
        expect(JSON.stringify(water?.req)).toContain('"technique"');
        // With a technique known the same way is met.
        const tech = content.techniques.find(
          (t) => t.skill === 'suiton' && t.level >= (water?.min ?? 0),
        );
        if (tech) {
          state.known[tech.id] = true;
          const again = missionStageWays(state, m.id, i, content, defaultRules);
          expect(again.ways.find((w) => w.kind === 'self' && w.skill === 'suiton')?.met).toBe(true);
        }
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the Intel skip is met only with the Intel to pay', () => {
    let checked = 0;
    for (const m of BOARD) {
      m.stages.forEach((_, i) => {
        const price = m.skip[i] ?? 0;
        if (price === 0) return;
        const poor = player({ seed: 5 });
        const rich = player({ seed: 5 });
        poor.currencies[STUDY] = price - 1;
        rich.currencies[STUDY] = price;
        const wayOf = (state: GameState): Way | undefined =>
          missionStageWays(state, m.id, i, content, defaultRules).ways.find(
            (w) => w.kind === 'skip',
          );
        expect(wayOf(poor)).toMatchObject({
          intel: price,
          met: false,
          have: price - 1,
          used: false,
        });
        expect(wayOf(rich)).toMatchObject({ intel: price, met: true, have: price });
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('agrees with a real run: the way each stage is done by', () => {
    let compared = 0;
    for (const m of BOARD) {
      for (const [name, build] of Object.entries(STATES)) {
        const state = build(m);
        const first = missionStageWays(state, m.id, 0, content, defaultRules);
        const started = dispatch(
          state,
          { type: 'action.start', slot: 0, kind: 'mission', id: m.id },
          content,
        );
        if (!started.ok) continue;
        let last = -1;
        for (let t = 0; t < 4000 && state.slots[0]?.action; t++) {
          const run = readRun(state.slots[0]?.data ?? null, m, content);
          if (run && run.s !== last) {
            const jump = run.s - last;
            last = run.s;
            const ways =
              run.s === 0 ? first : missionStageWays(state, m.id, run.s, content, defaultRules);
            if (jump === 1 || run.s === 0) {
              const used = ways.ways[ways.used];
              expect(
                [used?.who, used?.skill, used?.tech, used?.slow, used?.intel],
                `${m.id}@${name}#${run.s}`,
              ).toEqual([run.p.who, run.p.skill, run.p.tech, run.p.slow, run.p.intel]);
              compared++;
            }
          }
          if ((state.counters[`missions.done.${m.id}`] ?? 0) >= 1) break;
          advance(state, 1000, content);
        }
      }
    }
    expect(compared).toBeGreaterThan(50);
  });

  it('names the items an items stage takes', () => {
    for (const m of BOARD) {
      m.stages.forEach((stage, i) => {
        const state = ableFor(m);
        const { takes } = missionStageWays(state, m.id, i, content, defaultRules);
        if (stage.t !== 'items') expect(takes).toBeNull();
        else
          expect(takes).toEqual({
            item: stage.item,
            need: stage.n,
            have: state.bank[stage.item] ?? 0,
          });
      });
    }
  });
});

// ---------- can it be started ----------

describe('missionStatus', () => {
  it('gives the answer dispatch gives, for every mission in eleven states', () => {
    const reasons = new Set<string>();
    for (const m of BOARD) {
      for (const [name, build] of Object.entries(STATUS_STATES)) {
        const { state, slot } = build(m);
        const label = `${m.id}@${name}`;
        const status = missionStatus(state, m.id, slot, content, defaultRules);
        const coarse = missionStatus(state, m.id, slot, content, defaultRules, undefined);
        expect(coarse, label).toEqual(status);
        const result = dispatch(
          state,
          { type: 'action.start', slot, kind: 'mission', id: m.id },
          content,
        );
        expect(status.startable, label).toBe(result.ok);
        expect(status.slot, label).toBe(slot);
        if (result.ok) {
          expect(status.refusal, label).toBeNull();
          reasons.add('ok');
          continue;
        }
        reasons.add(result.reason);
        expect(status.refusal?.reason, label).toBe(result.reason);
      }
    }
    for (const reason of [
      'ok',
      'error.missionRunning',
      'error.missionNeedsTeam',
      'error.missingIngredient',
      'error.requirementsNotMet',
    ]) {
      expect(reasons.has(reason), reason).toBe(true);
    }
  });

  it('does not refuse a mission with a combat stage for a fight in another slot: every performer has its own', () => {
    const combat = BOARD.find((m) => m.stages.some((st) => st.t === 'combat')) as Mission;
    const zone = STATUS_STATES.zoneFightRuns?.(combat) as { state: GameState; slot: number };
    expect(zone.state.slots[0]?.action?.kind).toBe('fight');
    const status = missionStatus(zone.state, combat.id, 1, content, defaultRules);
    expect(status.refusal?.reason).not.toBe('error.fightBusy');
  });

  it('names the action that holds the fight or runs the mission, and the missing items', () => {
    const thief = BOARD.find((m) => m.stages.some((s) => s.t === 'combat')) as Mission;
    const other = BOARD.find(
      (m) => m.id !== thief.id && m.stages.some((s) => s.t === 'combat'),
    ) as Mission;
    const state = STATUS_STATES.combatMissionRuns?.(thief) as { state: GameState; slot: number };
    const beside = missionStatus(state.state, thief.id, 1, content, defaultRules).refusal;
    expect(beside?.reason).not.toBe('error.fightBusy');
    void other;

    const again = STATUS_STATES.runsInOtherSlot?.(thief) as { state: GameState; slot: number };
    const running = missionStatus(again.state, thief.id, 1, content, defaultRules);
    expect(running.runningAt).toBe(0);
    expect(running.refusal).toMatchObject({
      reason: 'error.missionRunning',
      by: { slot: 0, kind: 'mission', id: thief.id },
    });

    const withItems = BOARD.find((m) => m.stages.some((s) => s.t === 'items')) as Mission;
    const bare = ableFor(withItems);
    const need = withItems.stages.find((s) => s.t === 'items');
    if (need?.t === 'items') delete bare.bank[need.item];
    const missing = missionStatus(bare, withItems.id, 0, content, defaultRules).refusal;
    expect(missing?.reason).toBe('error.missingIngredient');
    expect(missing?.missing).toEqual([
      {
        item: need?.t === 'items' ? need.item : '',
        have: 0,
        need: need?.t === 'items' ? need.n : 0,
      },
    ]);
    expect(missing?.blocker?.first).not.toBeNull();
  });

  it('refuses a team mission with no team, with its own reason', () => {
    const team = BOARD.filter((m) => m.team);
    expect(team.length).toBeGreaterThan(0);
    for (const m of team) {
      const state = ableFor(m);
      state.team = null;
      const status = missionStatus(state, m.id, 0, content, defaultRules);
      expect(status.refusal?.reason, m.id).toBe('error.missionNeedsTeam');
      expect(
        dispatch(state, { type: 'action.start', slot: 0, kind: 'mission', id: m.id }, content),
        m.id,
      ).toEqual({ ok: false, reason: 'error.missionNeedsTeam' });
    }
    // The team is only the first thing dispatch names: what else blocks the mission is reported with it.
    const fresh = missionStatus(player({ seed: 4 }), 'core:fire', 0, content, defaultRules);
    expect(fresh.refusal?.reason).toBe('error.missionNeedsTeam');
    expect(fresh.refusal?.blocker?.first).not.toBeNull();
    // A mission with no team in it does not ask for one.
    const solo = BOARD.find((m) => !m.team) as Mission;
    const state = ableFor(solo);
    state.team = null;
    expect(missionStatus(state, solo.id, 0, content, defaultRules).startable).toBe(true);
  });

  it('shows a closed rank with its requirement', () => {
    const gated = BOARD.find((m) => m.unlock !== null) as Mission;
    const state = player({ seed: 3 });
    state.flags = {};
    const entry = missionBoard(state, content, defaultRules).find((e) => e.id === gated.id);
    expect(entry?.unlock).not.toBeNull();
    if (entry && !entry.open) {
      expect(entry.unlock?.met).toBe(false);
      const refusal = entry.status.refusal;
      expect(refusal?.unlock?.met).toBe(false);
      expect(refusal?.blocker?.stage).toBeNull();
    }
    // Every mission carries its own unlock as data, as the content defines it.
    for (const e of missionBoard(ableFor(gated), content, defaultRules)) {
      const m = BOARD.find((x) => x.id === e.id) as Mission;
      expect(e.unlock === null).toBe(m.unlock === null);
      if (m.unlock && e.unlock)
        expect(e.unlock.met).toBe(evalReq(ableFor(gated), m.unlock, content).met);
    }
  });

  it('the board says what dispatch says', () => {
    for (const [name, build] of Object.entries(STATES)) {
      const state = build(BOARD[0] as Mission);
      for (const entry of missionBoard(state, content, defaultRules)) {
        const copy = structuredClone(state);
        const result = dispatch(
          copy,
          { type: 'action.start', slot: entry.status.slot, kind: 'mission', id: entry.id },
          content,
        );
        expect(entry.startable, `${entry.id}@${name}`).toBe(result.ok);
      }
    }
  });
});

// ---------- rewards ----------

describe('the forecast lists everything a mission can give', () => {
  it('currencies by role, items with chances, the resource, and the ration', () => {
    eachCase((m, name, state) => {
      const f = missionForecast(state, m, content, defaultRules);
      const label = `${m.id}@${name}`;
      const money = f.rewards.currencies.find((c) => c.role === 'money');
      expect(money?.n ?? 0, label).toBe(
        f.ryo +
          m.pay.reduce(
            (s, p) => s + (p.kind === 'currency' && p.currency === money?.currency ? p.n : 0),
            0,
          ),
      );
      const renown = f.rewards.currencies.find((c) => c.role === 'renown');
      if (m.team) expect(renown, label).toMatchObject({ n: f.rep, rule: 'team' });
      else expect(renown, label).toBeUndefined();
      const intel = m.pay.reduce((s, p) => s + (p.kind === 'intel' ? p.n : 0), 0);
      expect(f.rewards.currencies.find((c) => c.role === 'study')?.n ?? 0, label).toBe(intel);
      for (const pay of m.pay) {
        if (pay.kind === 'item') {
          expect(f.rewards.items, label).toContainEqual({ item: pay.item, n: pay.n, chance: 1 });
        } else if (pay.kind === 'scrollPart') {
          const part = f.rewards.items.find(
            (i) => i.chance === (K.partDrop[pay.chance] ?? 0) && i.n === 1,
          );
          expect(part, label).toBeDefined();
        }
      }
      expect(f.rewards.resource, label).toEqual(f.resource);
      expect(f.rewards.ration.share, label).toBe(armedRation(state, content));
      expect(f.rewards.ration.items, label).toEqual(rationItems(state, content));
    });
  });

  it('the XP of a stage: certain skills by skill, and a fight as what is certain and the style share', () => {
    let fights = 0;
    eachCase((m, name, state) => {
      const f = missionForecast(state, m, content, defaultRules);
      for (const stage of f.stages) {
        const label = `${m.id}@${name}#${stage.index}`;
        if (!stage.path) {
          expect(stage.xp.lines, label).toEqual([]);
          continue;
        }
        const plan = planStage(
          state,
          m,
          stage.index,
          content,
          defaultRules,
          armedRation(state, content),
        );
        if (!plan) continue;
        const shares = fightXpShares(m, stage.index, plan, content);
        if (m.stages[stage.index]?.t === 'combat' && plan.who === 'self') {
          fights++;
          expect(shares, label).not.toBeNull();
          const style = stage.xp.lines.filter((l) => !l.certain);
          const common = getMod(state, 'xp.all', content, defaultRules).total;
          expect(style, label).toEqual([
            { skill: null, amount: (shares?.style ?? 0) * common, certain: false },
          ]);
          const sure = stage.xp.lines.filter((l) => l.certain).map((l) => l.skill);
          expect(sure, label).toEqual(shares?.others.map(([skill]) => skill));
          expect(stage.xp.fight?.total, label).toBeCloseTo(
            stage.xp.lines.reduce((s, l) => s + l.amount, 0),
            9,
          );
          expect(stage.xp.fight?.skills, label).toEqual(sure);
          // What a run pays to the fixed skills is what is forecast.
          for (const line of stage.xp.lines.filter((l) => l.certain)) {
            const raw = shares?.others.find(([skill]) => skill === line.skill)?.[1] ?? 0;
            expect(line.amount, label).toBe(
              xpGain(state, line.skill ?? '', raw, content, defaultRules),
            );
          }
        } else {
          expect(stage.xp.fight, label).toBeNull();
          expect(
            stage.xp.lines.every((l) => l.certain && l.skill !== null),
            label,
          ).toBe(true);
          const expected = stageXp(state, m, stage.index, plan, '', content);
          expect(
            stage.xp.lines.map((l) => l.skill),
            label,
          ).toEqual(expected.xp.map(([s]) => s));
          expect(stage.xp.mastery, label).toBe(expected.mastery?.id ?? null);
        }
      }
      // Per hour: only what is certain is added up by skill; the fights' whole XP apart.
      const combat = f.stages.some((s) => s.xp.fight !== null);
      expect(f.fightXpPerHour > 0, `${m.id}@${name}`).toBe(combat);
    });
    expect(fights).toBeGreaterThan(0);
  });
});

// ---------- the completion event ----------

describe('the completion event says what was granted', () => {
  const doneOf = (state: GameState): MissionDoneEvent => {
    const found = state.events.filter((e): e is MissionDoneEvent => e.type === 'missionDone');
    expect(found).toHaveLength(1);
    return found[0] as MissionDoneEvent;
  };

  const delta = (
    before: Record<string, number>,
    after: Record<string, number>,
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const d = (after[key] ?? 0) - (before[key] ?? 0);
      if (d !== 0) out[key] = d;
    }
    return out;
  };

  const sum = <T extends { n: number }>(
    list: T[],
    key: (x: T) => string,
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + x.n;
    return out;
  };

  it('equals the state difference for every mission: currencies, items, village resources', () => {
    let drops = 0;
    for (const m of BOARD) {
      for (let seed = 1; seed <= 12; seed++) {
        const state = ableFor(m, undefined, seed);
        state.events = [];
        const before = structuredClone(state);
        payMission(state, m, [], content, defaultRules);
        const done = doneOf(state);
        const label = `${m.id} seed ${seed}`;
        expect(delta(before.currencies, state.currencies), label).toEqual(
          sum(done.currencies, (c) => c.currency),
        );
        expect(done.ryo, label).toBe(
          done.currencies.find((c) => c.currency === currencyOf(content, 'money'))?.n ?? 0,
        );
        expect(done.rep, label).toBe(
          done.currencies.find((c) => c.currency === currencyOf(content, 'renown'))?.n ?? 0,
        );
        expect(delta(before.bank, state.bank), label).toEqual(sum(done.items, (i) => i.id));
        if (
          m.pay.some((p) => p.kind === 'scrollPart') &&
          done.items.length > m.pay.filter((p) => p.kind === 'item').length
        )
          drops++;
        const gained = state.events.filter(
          (e): e is Extract<GameEvent, { type: 'itemGained' }> => e.type === 'itemGained',
        );
        expect(
          sum(
            gained.map((g) => ({ ...g, n: g.n })),
            (g) => g.id,
          ),
          label,
        ).toEqual(sum(done.items, (i) => i.id));
        if (!m.resource) {
          expect(done.resource, label).toBeNull();
          continue;
        }
        const village = state.village;
        expect(village, label).not.toBeNull();
        const have = (s: GameState): number => {
          const kind = content.resources.find((r) => r.id === m.resource)?.kind;
          if (kind === 'power') return s.village?.power ?? 0;
          if (kind === 'workforce') return s.village?.workforce ?? 0;
          return s.village?.shinobi[m.resource ?? ''] ?? 0;
        };
        const gain = have(state) - have(before);
        expect(done.resource, label).toMatchObject({ slug: m.resource, added: gain, waiting: 0 });
        expect(done.resource?.units, label).toBe(gain + (done.resource?.lost ?? 0));
        expect(done.resource?.units, label).toBe(
          missionForecast(before, m, content, defaultRules).resource?.units,
        );
      }
    }
    expect(drops).toBeGreaterThan(0);
  });

  it('counts the units lost to a full store, and the units that wait when there is no village', () => {
    const m = BOARD.find(
      (x) => x.resource && content.resources.find((r) => r.id === x.resource)?.kind === 'shinobi',
    ) as Mission;
    const state = ableFor(m);
    let lost = 0;
    for (let i = 0; i < 300 && lost === 0; i++) {
      state.events = [];
      payMission(state, m, [], content, defaultRules);
      const done = doneOf(state);
      lost = done.resource?.lost ?? 0;
      expect(done.resource?.units).toBe((done.resource?.added ?? 0) + lost);
    }
    expect(lost).toBeGreaterThan(0);

    const none = ableFor(m);
    none.village = null;
    none.events = [];
    payMission(none, m, [], content, defaultRules);
    const done = doneOf(none);
    expect(done.resource).toMatchObject({ slug: m.resource, added: 0, lost: 0 });
    expect(done.resource?.waiting).toBe(done.resource?.units);
    expect(none.missions.pending[m.resource ?? '']).toBe(done.resource?.units);
  });

  it('comes out of a real run too', () => {
    for (const m of BOARD) {
      const state = ableFor(m);
      state.events = [];
      dispatch(state, { type: 'action.start', slot: 0, kind: 'mission', id: m.id }, content);
      for (let t = 0; t < 10_800 && (state.counters[`missions.done.${m.id}`] ?? 0) < 1; t++) {
        advance(state, 1000, content);
      }
      const done = state.events.find((e): e is MissionDoneEvent => e.type === 'missionDone');
      expect(done, m.id).toBeDefined();
      const forecast = missionForecast(ableFor(m), m, content, defaultRules);
      expect(done?.ryo, m.id).toBe(forecast.ryo);
    }
  });
});

// ---------- the goal ----------

describe('a mission as the pinned goal', () => {
  it('is accepted for a board mission only', () => {
    const state = ableFor(BOARD[0] as Mission);
    const board = BOARD[0] as Mission;
    expect(
      dispatch(state, { type: 'goal.set', ref: { kind: 'mission', id: board.id } }, content),
    ).toEqual({ ok: true });
    expect(state.goal).toEqual({ kind: 'mission', id: board.id });
    const operation = content.missions.find((m) => !m.board);
    if (operation) {
      expect(
        dispatch(state, { type: 'goal.set', ref: { kind: 'mission', id: operation.id } }, content),
      ).toEqual({ ok: false, reason: 'error.invalidGoal' });
    }
    expect(
      dispatch(state, { type: 'goal.set', ref: { kind: 'mission', id: 'core:nope' } }, content),
    ).toEqual({ ok: false, reason: 'error.invalidGoal' });
  });

  it('has the unlock and the first stage that has no way yet', () => {
    for (const m of BOARD) {
      const state = player({ seed: 9 });
      state.flags = {};
      const req = missionGoalReq(state, m, content, defaultRules);
      expect(req.t).toBe('all');
      const kids = req.t === 'all' ? req.of : [];
      expect(kids.length, m.id).toBeLessThanOrEqual((m.unlock ? 1 : 0) + 1);
      if (m.unlock) expect(kids[0], m.id).toEqual(m.unlock);
      const result = evalReq(state, req, content);
      const first = m.stages.findIndex((_, i) => !planStage(state, m, i, content, defaultRules));
      // Met exactly when nothing blocks it.
      const open = m.unlock === null || evalReq(state, m.unlock, content).met;
      expect(result.met, m.id).toBe(open && first < 0);
      // Able for it: nothing left to do.
      const able = ableFor(m);
      expect(evalReq(able, missionGoalReq(able, m, content, defaultRules), content).met, m.id).toBe(
        true,
      );
    }
  });
});
