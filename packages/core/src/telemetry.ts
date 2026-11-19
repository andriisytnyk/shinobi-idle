import type { ContentDb } from '@shinobi/content';
import { z } from 'zod';
import { defeatsKey, killsKey } from './counters.ts';
import type { GameEvent } from './events.ts';
import { missionDoneKey } from './missions/run.ts';
import type { GameState } from './state.ts';
import { moneyOf, skillEntry } from './vocab.ts';
import { levelAt } from './xp.ts';

/**
 * Local telemetry: a small record of how a game went (pace, milestones, where time went). The core
 * only folds events and states into it; it never reads a clock. Real time comes in as a number from
 * the web layer, which also stores and exports the record. Nothing here leaves the device.
 */

export const TELEMETRY_VERSION = 1;

/** Levels of a skill whose first arrival is a milestone. */
export const TELEMETRY_SKILL_LEVELS: readonly number[] = [10, 20, 30, 40, 50];

/** How many entries each list of the record keeps (the newest win). */
export const TELEMETRY_SESSIONS_CAP = 30;
export const TELEMETRY_OFFLINE_CAP = 30;
/** Hard bound for the milestone list; a game has far fewer distinct milestones. */
export const TELEMETRY_MILESTONES_CAP = 400;

export interface TelemetrySession {
  /** Real time (ms since the epoch) the session began and was last seen. */
  start: number;
  end: number;
  /** Game time at those moments. */
  gameStart: number;
  gameEnd: number;
}

export interface TelemetryOffline {
  /** Real time at which the catch-up was applied. */
  real: number;
  requestedMs: number;
  simulatedMs: number;
}

export interface TelemetryMilestone {
  /** Unique key: `rank:genin`, `skill:<id>:10`, `quest:<id>:2` ... */
  key: string;
  /** Game time and real time of the first time. */
  game: number;
  real: number;
}

export interface TelemetryRecord {
  v: number;
  /** Real time the record was created. */
  created: number;
  sessions: { count: number; realMs: number; last: TelemetrySession[] };
  offline: { count: number; requestedMs: number; simulatedMs: number; last: TelemetryOffline[] };
  milestones: TelemetryMilestone[];
  /** Game time per action kind, and per skill that gained XP in the interval. Approximate across a catch-up. */
  timeByKind: Record<string, number>;
  timeBySkill: Record<string, number>;
  /** Fights by enemy or boss id. */
  fights: Record<string, { won: number; lost: number }>;
  missions: Record<string, number>;
  /** Money by source earned, and spent in total. `expected` is the balance the folded events explain, null until the first observation (`unbased` holds what was earned before it). */
  ryo: { earned: Record<string, number>; spent: number; expected: number | null; unbased: number };
  /** The longest stretch of game time without a milestone, and the game time it began at. */
  dry: { ms: number; from: number };
  /** Game time of the last milestone (0 before the first). */
  lastMilestone: number;
  /** Game time of the last observation. */
  game: number;
}

export function newTelemetry(real: number): TelemetryRecord {
  return {
    v: TELEMETRY_VERSION,
    created: real,
    sessions: { count: 0, realMs: 0, last: [] },
    offline: { count: 0, requestedMs: 0, simulatedMs: 0, last: [] },
    milestones: [],
    timeByKind: {},
    timeBySkill: {},
    fights: {},
    missions: {},
    ryo: { earned: {}, spent: 0, expected: null, unbased: 0 },
    dry: { ms: 0, from: 0 },
    lastMilestone: 0,
    game: 0,
  };
}

const num = z.number();
const numMap = z.record(z.string(), num);

/** The whole shape of a stored record. A record that does not fit is dropped, never half-used. */
const telemetrySchema = z.object({
  v: z.literal(TELEMETRY_VERSION),
  created: num,
  sessions: z.object({
    count: num,
    realMs: num,
    last: z
      .array(z.object({ start: num, end: num, gameStart: num, gameEnd: num }))
      .max(TELEMETRY_SESSIONS_CAP),
  }),
  offline: z.object({
    count: num,
    requestedMs: num,
    simulatedMs: num,
    last: z
      .array(z.object({ real: num, requestedMs: num, simulatedMs: num }))
      .max(TELEMETRY_OFFLINE_CAP),
  }),
  milestones: z
    .array(z.object({ key: z.string(), game: num, real: num }))
    .max(TELEMETRY_MILESTONES_CAP),
  timeByKind: numMap,
  timeBySkill: numMap,
  fights: z.record(z.string(), z.object({ won: num, lost: num })),
  missions: numMap,
  ryo: z.object({
    earned: numMap,
    spent: num,
    expected: num.nullable(),
    unbased: num,
  }),
  dry: z.object({ ms: num, from: num }),
  lastMilestone: num,
  game: num,
});

/**
 * Reads a stored record. A text that is not a complete record of the known version gives null (the
 * caller starts a new one). This is where future versions get their migrations.
 */
export function parseTelemetry(text: string): TelemetryRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const result = telemetrySchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** The record as the text that is stored and exported. */
export function serializeTelemetry(rec: TelemetryRecord): string {
  return JSON.stringify(rec);
}

function capLast<T>(list: T[], cap: number): void {
  if (list.length > cap) list.splice(0, list.length - cap);
}

// ---------- sessions and offline catch-ups (real time comes from the caller) ----------

/** A session begins: the app was opened at real time `real` with the game at `game`. */
export function sessionStart(rec: TelemetryRecord, real: number, game: number): void {
  rec.sessions.count++;
  rec.sessions.last.push({ start: real, end: real, gameStart: game, gameEnd: game });
  capLast(rec.sessions.last, TELEMETRY_SESSIONS_CAP);
  rec.ryo.expected = null;
}

/** The session is still going: moves its end and the total of real time. */
export function sessionBeat(rec: TelemetryRecord, real: number, game: number): void {
  const last = rec.sessions.last[rec.sessions.last.length - 1];
  if (!last) return;
  const end = Math.max(last.end, real);
  rec.sessions.realMs += end - last.end;
  last.end = end;
  last.gameEnd = Math.max(last.gameEnd, game);
}

/** The session slept and a catch-up covered the gap: moves its end without counting the gap as open time. */
export function sessionResume(rec: TelemetryRecord, real: number, game: number): void {
  const last = rec.sessions.last[rec.sessions.last.length - 1];
  if (!last) return;
  last.end = Math.max(last.end, real);
  last.gameEnd = Math.max(last.gameEnd, game);
}

/**
 * The record goes on after a break in what it watches (a state swap such as a restore, or a
 * switch-off): the next observation compares with nothing before it, and the stretch without
 * milestones counts from `game`.
 */
export function rebaseTelemetry(rec: TelemetryRecord, game: number): void {
  rec.ryo.expected = null;
  rec.ryo.unbased = 0;
  rec.lastMilestone = game;
  rec.game = game;
}

/** A catch-up after the app was closed or asleep was applied. */
export function noteOffline(
  rec: TelemetryRecord,
  real: number,
  requestedMs: number,
  simulatedMs: number,
): void {
  rec.offline.count++;
  rec.offline.requestedMs += requestedMs;
  rec.offline.simulatedMs += simulatedMs;
  rec.offline.last.push({ real, requestedMs, simulatedMs });
  capLast(rec.offline.last, TELEMETRY_OFFLINE_CAP);
}

// ---------- milestones ----------

/** Records a milestone the first time its key is seen; also moves the longest dry stretch. */
export function addMilestone(rec: TelemetryRecord, key: string, game: number, real: number): void {
  if (rec.milestones.length >= TELEMETRY_MILESTONES_CAP) return;
  if (rec.milestones.some((m) => m.key === key)) return;
  closeDry(rec, game);
  rec.milestones.push({ key, game, real });
  rec.lastMilestone = game;
}

function closeDry(rec: TelemetryRecord, game: number): void {
  const gap = game - rec.lastMilestone;
  if (gap > rec.dry.ms) rec.dry = { ms: gap, from: rec.lastMilestone };
}

// ---------- the reducer over events ----------

const bumpMap = (map: Record<string, number>, key: string, n: number): void => {
  if (n !== 0) map[key] = (map[key] ?? 0) + n;
};

function earn(rec: TelemetryRecord, source: string, n: number): void {
  if (n <= 0) return;
  bumpMap(rec.ryo.earned, source, n);
  if (rec.ryo.expected !== null) rec.ryo.expected += n;
  else rec.ryo.unbased += n;
}

/**
 * Folds the events of the game into the record. Pure: the same record and events give the same
 * result. `real` is the real time of the fold, for the milestones.
 */
export function foldEvents(rec: TelemetryRecord, events: readonly GameEvent[], real: number): void {
  for (const e of events) {
    switch (e.type) {
      case 'levelUp':
        if (TELEMETRY_SKILL_LEVELS.includes(e.level)) {
          addMilestone(rec, `skill:${e.skill}:${e.level}`, e.at, real);
        }
        break;
      case 'rankUp':
        addMilestone(rec, `rank:${e.rank}`, e.at, real);
        break;
      case 'techniqueLearned':
        addMilestone(rec, `technique:${e.id}`, e.at, real);
        break;
      case 'questStep':
        addMilestone(rec, `quest:${e.quest}:${e.step}`, e.at, real);
        break;
      case 'questDone':
        addMilestone(rec, `quest:${e.quest}:done`, e.at, real);
        break;
      case 'examPassed':
        addMilestone(rec, `exam:${e.exam}`, e.at, real);
        break;
      case 'villageStage':
        addMilestone(rec, `village:${e.stage}`, e.at, real);
        break;
      case 'enemyDefeated':
        (rec.fights[e.enemy] ??= { won: 0, lost: 0 }).won++;
        break;
      case 'playerDefeated':
        // A clone losing is no defeat of the player.
        if (e.clone !== true) (rec.fights[e.enemy] ??= { won: 0, lost: 0 }).lost++;
        break;
      case 'missionDone':
        bumpMap(rec.missions, e.mission, 1);
        earn(rec, 'mission', e.ryo);
        break;
      case 'loot':
        earn(rec, 'loot', e.ryo);
        earn(rec, 'bounty', e.bounty);
        break;
      case 'operationPaid':
        earn(rec, 'operation', e.ryo);
        break;
      case 'pointFound':
        earn(rec, 'point', e.reward.ryo);
        break;
      default:
        break;
    }
  }
}

// ---------- the observer over states ----------

/** What is read from the state before `advance`, to be compared after it. */
export interface TelemetrySnapshot {
  game: number;
  /** Kinds of the running actions, one per busy slot. */
  kinds: string[];
  xp: Record<string, number>;
  money: number;
  /** What a catch-up reads, only when asked for (its events are not queued). */
  catchUp: {
    counters: Record<string, number>;
    rank: string;
    known: string[];
    quests: Record<string, { step: number; done: boolean }>;
  } | null;
}

export function snapshotForTelemetry(
  state: GameState,
  content: ContentDb,
  catchUp = false,
): TelemetrySnapshot {
  const xp: Record<string, number> = {};
  for (const skill of content.skills) xp[skill.id] = skillEntry(state, skill.id)?.xp ?? 0;
  const kinds: string[] = [];
  for (const slot of state.slots) if (slot.action) kinds.push(slot.action.kind);
  return {
    game: state.now,
    kinds,
    xp,
    money: state.currencies[moneyOf(content)] ?? 0,
    catchUp: catchUp
      ? {
          counters: { ...state.counters },
          rank: state.player.rank,
          known: content.techniques.filter((t) => state.known[t.id] === true).map((t) => t.id),
          quests: Object.fromEntries(
            Object.entries(state.quests).map(([id, q]) => [id, { step: q.step, done: q.done }]),
          ),
        }
      : null,
  };
}

/**
 * Compares the state after `advance` with the snapshot from before it: game time per action kind
 * and per skill, money that no event explains (earned elsewhere, or spent), and the milestones that
 * a catch-up reached without events. `offline` marks a catch-up, whose events are not queued: the
 * fights and missions it did are read from the counters.
 */
export function observeState(
  rec: TelemetryRecord,
  before: TelemetrySnapshot,
  state: GameState,
  content: ContentDb,
  real: number,
  offline = false,
): void {
  // The first observation of a fresh record starts its stretch without milestones here, not at game time 0.
  if (rec.game === 0 && rec.lastMilestone === 0 && rec.milestones.length === 0) {
    rec.game = before.game;
    rec.lastMilestone = before.game;
  }
  const dt = Math.max(0, state.now - before.game);
  const cap = content.balance.K.cap;
  if (rec.ryo.expected === null) {
    rec.ryo.expected = before.money + rec.ryo.unbased;
    rec.ryo.unbased = 0;
  }
  if (dt > 0) {
    // One kind counts once per interval however many slots run it: the clone's work is a second slot of the same game time.
    for (const kind of new Set(before.kinds)) bumpMap(rec.timeByKind, kind, dt);
  }
  for (const skill of content.skills) {
    const was = before.xp[skill.id] ?? 0;
    const now = skillEntry(state, skill.id)?.xp ?? 0;
    if (now > was) {
      if (dt > 0) bumpMap(rec.timeBySkill, skill.id, dt);
      // A catch-up queues no events: the levels it passed are read from the XP.
      if (offline) {
        for (const level of TELEMETRY_SKILL_LEVELS) {
          if (levelAt(now, cap) >= level && levelAt(was, cap) < level) {
            addMilestone(rec, `skill:${skill.id}:${level}`, state.now, real);
          }
        }
      }
    }
  }
  const seen = before.catchUp;
  if (offline && seen) {
    // Only what was not true before the catch-up is a milestone of it; what the game already had is the baseline.
    if (state.player.rank !== seen.rank) {
      addMilestone(rec, `rank:${state.player.rank}`, state.now, real);
    }
    for (const [id, q] of Object.entries(state.quests)) {
      const was = seen.quests[id] ?? { step: 0, done: false };
      for (let step = was.step + 1; step <= q.step; step++) {
        addMilestone(rec, `quest:${id}:${step}`, state.now, real);
      }
      if (q.done && !was.done) addMilestone(rec, `quest:${id}:done`, state.now, real);
    }
    for (const t of content.techniques) {
      if (state.known[t.id] === true && !seen.known.includes(t.id)) {
        addMilestone(rec, `technique:${t.id}`, state.now, real);
      }
    }
    const was = seen.counters;
    for (const [key, value] of Object.entries(state.counters)) {
      const gained = value - (was[key] ?? 0);
      if (gained <= 0) continue;
      for (const [prefix, field] of [
        [killsKey(''), 'won'],
        [defeatsKey(''), 'lost'],
      ] as const) {
        if (key.startsWith(prefix)) {
          (rec.fights[key.slice(prefix.length)] ??= { won: 0, lost: 0 })[field] += gained;
        }
      }
      const missionPrefix = missionDoneKey('');
      if (key.startsWith(missionPrefix))
        bumpMap(rec.missions, key.slice(missionPrefix.length), gained);
    }
  }
  const money = state.currencies[moneyOf(content)] ?? 0;
  const diff = money - rec.ryo.expected;
  if (diff > 0) bumpMap(rec.ryo.earned, 'other', diff);
  else if (diff < 0) rec.ryo.spent += -diff;
  rec.ryo.expected = money;
  closeDry(rec, state.now);
  rec.game = state.now;
}
