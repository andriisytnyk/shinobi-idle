/**
 * Missions behave exactly as before the forecast API: for every board mission in six prepared
 * states a full run through `dispatch` + `advance` (time, rewards, XP by skill, performer per
 * stage, events, a digest of the whole state) is compared with a fixture recorded before the
 * API was added. Record anew with `RECORD_MISSIONS=1 pnpm --filter @shinobi/core test missions-behaviour`.
 * The recorder keeps the records of the cases that are now refused for a missing team (they describe the
 * behaviour before the API, which a re-record cannot reproduce) and re-records the rest.
 * The only allowed difference is the refusal of a team mission when the player has no team.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { content, type Mission } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, dispatch, readRun, type GameEvent, type GameState } from '../src/index.ts';
import { BOARD, STATES } from './missions-states.ts';

const FIXTURE = new URL('./fixtures/missions-behaviour.json', import.meta.url);
const LIMIT_MS = 3 * 3_600_000;
const round = (x: number): number => Math.round(x * 1e6) / 1e6;
const digest = (x: unknown): string =>
  createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

function normalise(event: GameEvent): unknown {
  switch (event.type) {
    case 'missionDone':
      return ['done', event.at, event.mission, event.ryo, event.rep];
    case 'missionStage':
      return ['stage', event.at, event.mission, event.stage, event.ok];
    case 'itemGained':
      return ['item', event.at, event.id, event.n];
    case 'actionStopped':
      return ['stopped', event.at, event.reason, event.cause ?? ''];
    default:
      return null;
  }
}

export interface Recorded {
  start: string;
  timeMs: number;
  finished: boolean;
  stopped: boolean;
  stages: unknown[];
  bank: Record<string, number>;
  currencies: Record<string, number>;
  xp: Record<string, number>;
  village: unknown;
  events: unknown[];
  digest: string;
}

function recordRun(state: GameState, m: Mission): Recorded {
  const result = dispatch(
    state,
    { type: 'action.start', slot: 0, kind: 'mission', id: m.id },
    content,
  );
  const base: Recorded = {
    start: result.ok ? 'ok' : result.reason,
    timeMs: 0,
    finished: false,
    stopped: false,
    stages: [],
    bank: {},
    currencies: {},
    xp: {},
    village: null,
    events: [],
    digest: '',
  };
  if (!result.ok) return base;
  const t0 = state.now;
  const key = `missions.done.${m.id}`;
  let last = -1;
  while ((state.counters[key] ?? 0) < 1 && state.slots[0]?.action && state.now - t0 < LIMIT_MS) {
    const run = readRun(state.slots[0]?.data ?? null, m, content);
    if (run && run.s !== last) {
      last = run.s;
      const p = run.p;
      base.stages.push([
        run.s,
        p.who,
        p.skill,
        p.tech,
        p.level,
        p.min,
        p.mastery,
        p.slow,
        p.intel,
        p.ms,
        round(p.chance),
      ]);
    }
    advance(state, 1000, content);
  }
  base.timeMs = state.now - t0;
  base.finished = (state.counters[key] ?? 0) >= 1;
  base.stopped = state.slots[0]?.action === null;
  base.bank = { ...state.bank };
  base.currencies = { ...state.currencies };
  for (const [id, s] of Object.entries(state.skills)) if (s.xp > 0) base.xp[id] = round(s.xp);
  base.village = state.village
    ? {
        power: state.village.power,
        workforce: state.village.workforce,
        shinobi: state.village.shinobi,
      }
    : state.missions.pending;
  base.events = state.events.map(normalise).filter((e) => e !== null);
  base.digest = digest({
    skills: state.skills,
    mastery: state.mastery,
    bank: state.bank,
    currencies: state.currencies,
    buffs: state.buffs,
    village: state.village,
    missions: state.missions,
    counters: state.counters,
    rng: state.rng,
    wounds: state.wounds,
    stats: state.stats,
  });
  return base;
}

/** The refusal core gives a team mission when the player has no team. */
const NO_TEAM = 'error.missionNeedsTeam';

function recordAll(): Record<string, Recorded> {
  const out: Record<string, Recorded> = {};
  const old: Record<string, Recorded> = existsSync(FIXTURE)
    ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Recorded>)
    : {};
  for (const m of BOARD) {
    for (const [name, build] of Object.entries(STATES)) {
      const key = `${m.id}@${name}`;
      const state = build(m);
      state.events = [];
      const now = recordRun(state, m);
      // Keep the pre-API record of a case that is refused for a missing team.
      out[key] = now.start === NO_TEAM && old[key] ? old[key] : now;
    }
  }
  return out;
}

describe('missions behave as before the forecast API', () => {
  if (process.env.RECORD_MISSIONS === '1') {
    it('records the fixture', () => {
      writeFileSync(FIXTURE, JSON.stringify(recordAll()));
    });
  } else {
    const fixture: Record<string, Recorded> = existsSync(FIXTURE)
      ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Recorded>)
      : {};
    const affected: string[] = [];
    for (const m of BOARD) {
      for (const [name, build] of Object.entries(STATES)) {
        const key = `${m.id}@${name}`;
        it(key, () => {
          const state = build(m);
          state.events = [];
          const now = recordRun(state, m);
          const was = fixture[key];
          expect(was).toBeDefined();
          if (now.start === NO_TEAM) {
            // The one allowed difference: a team mission with no team is refused now.
            expect(m.team).toBe(true);
            expect(state.team).toBeNull();
            // It either started before (behaviour changed), or was refused for another reason (only the reason changed).
            expect(['ok', 'error.requirementsNotMet', 'error.missingIngredient']).toContain(
              was?.start,
            );
            affected.push(key);
            return;
          }
          expect(now).toEqual(was);
        });
      }
    }
    it('the refused cases are exactly the team missions in the states with no team', () => {
      const expected = BOARD.filter((m) => m.team).flatMap((m) =>
        Object.entries(STATES)
          .filter(([, build]) => build(m).team === null)
          .map(([name]) => `${m.id}@${name}`),
      );
      expect([...affected].sort()).toEqual(expected.sort());
      // Those that started before: the cases where behaviour changed.
      const started = affected.filter((key) => fixture[key]?.start === 'ok');
      expect(started.length).toBeGreaterThan(0);
    });
  }
});
