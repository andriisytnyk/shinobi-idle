import type { ContentDb } from '@shinobi/content';
import type { GameState } from '../state.ts';
import { fightTimeMs, habituation } from './fight.ts';
import type { FightState } from './fight-types.ts';

/** Why a fight was lost: when, to whom, and what the player had left. */
export interface DefeatCause {
  /** Game time of the defeat. */
  at: number;
  enemy: string;
  /** Fight time in ms. */
  tMs: number;
  /** Chakra and stamina left, in percent of the pools. */
  chakra: number;
  stamina: number;
}

/**
 * The battle report of one target (a zone, an enemy or an operation): what the fights against it
 * have added up to. Plain JSON, bounded: every map is keyed by content ids and the list of
 * defeats keeps only the latest few.
 */
export interface TargetReport {
  fights: number;
  wins: number;
  losses: number;
  timeouts: number;
  /** Fight time in ms: of the won fights, and of all of them. */
  winMs: number;
  allMs: number;
  /** Damage dealt, finished casts, statuses applied and combos fired, by id. */
  damage: Record<string, number>;
  uses: Record<string, number>;
  statuses: Record<string, number>;
  combos: Record<string, number>;
  basic: number;
  interrupts: number;
  /** Damage the player took. */
  taken: number;
  /** The lowest damage multiplier habituation brought each technique to (1: none). */
  habLow: Record<string, number>;
  /** Pouch units used, by item id. */
  items: Record<string, number>;
  /** What the wins paid: ryo, bounty, and items (trophies and scroll parts). */
  loot: { ryo: number; bounty: number; items: Record<string, number> };
  wounds: number;
  /** The latest defeats, oldest first. */
  defeats: DefeatCause[];
}

export const blankReport = (): TargetReport => ({
  fights: 0,
  wins: 0,
  losses: 0,
  timeouts: 0,
  winMs: 0,
  allMs: 0,
  damage: {},
  uses: {},
  statuses: {},
  combos: {},
  basic: 0,
  interrupts: 0,
  taken: 0,
  habLow: {},
  items: {},
  loot: { ryo: 0, bounty: 0, items: {} },
  wounds: 0,
  defeats: [],
});

const MAX_COUNTED = 1e12;

/** Rounds the floating figures of a tally so a report stays a short, exact JSON. */
const round = (x: number): number => Math.min(MAX_COUNTED, Math.round(x));

function add(into: Record<string, number>, from: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + round(value);
}

/** The report of `key`, created when it is new. */
function reportOf(state: GameState, key: string): TargetReport {
  return (state.report[key] ??= blankReport());
}

/** Adds one finished fight to the report of `key`. */
export function recordFight(
  state: GameState,
  key: string,
  fight: FightState,
  result: 'win' | 'loss' | 'timeout',
  content: ContentDb,
): void {
  const r = reportOf(state, key);
  const t = fight.tally;
  const ms = fightTimeMs(fight);
  r.fights++;
  r.allMs += ms;
  if (result === 'win') {
    r.wins++;
    r.winMs += ms;
  } else if (result === 'loss') r.losses++;
  else r.timeouts++;
  add(r.damage, t.damage);
  add(r.uses, t.uses);
  add(r.statuses, t.statuses);
  add(r.combos, t.combos);
  r.basic += round(t.basic);
  r.interrupts += round(t.interrupts);
  r.taken += round(t.taken);
  for (const tech of fight.kit.techniques) {
    const n = fight.uses[tech.id] ?? 0;
    if (n === 0) continue;
    const mult = Math.round(habituation(n, tech.habituationMult, content) * 1000) / 1000;
    const low = r.habLow[tech.id];
    if (low === undefined || mult < low) r.habLow[tech.id] = mult;
  }
  if (result === 'loss') {
    const p = fight.player;
    r.defeats.push({
      at: 0,
      enemy: fight.enemy,
      tMs: ms,
      chakra: p.maxChakra > 0 ? Math.round((100 * p.chakra) / p.maxChakra) : 0,
      stamina: p.maxStamina > 0 ? Math.round((100 * p.stamina) / p.maxStamina) : 0,
    });
    const keep = content.balance.K.report.defeats;
    if (r.defeats.length > keep) r.defeats.splice(0, r.defeats.length - keep);
  }
}

/** Stamps the latest defeat with the game time (the fight itself knows only its own clock). */
export function stampDefeat(state: GameState, key: string): void {
  const last = state.report[key]?.defeats.at(-1);
  if (last && last.at === 0) last.at = state.now;
}

/** Notes pouch units used. */
export function recordItems(
  state: GameState,
  key: string,
  used: Readonly<Record<string, number>>,
): void {
  if (Object.keys(used).length > 0) add(reportOf(state, key).items, used);
}

/** Notes the Wounds a fight cost. */
export function recordWounds(state: GameState, key: string, n: number): void {
  if (n > 0) reportOf(state, key).wounds += n;
}

/** Notes what a win paid. */
export function recordLoot(
  state: GameState,
  key: string,
  loot: { ryo: number; bounty: number; items: Readonly<Record<string, number>> },
): void {
  const r = reportOf(state, key);
  r.loot.ryo += loot.ryo;
  r.loot.bounty += loot.bounty;
  add(r.loot.items, loot.items);
}

/** The battle report of a target (zone, enemy or operation id); an empty one when there is none. */
export function battleReport(state: GameState, target: string): TargetReport {
  const r = state.report[target];
  return r ? (JSON.parse(JSON.stringify(r)) as TargetReport) : blankReport();
}

function addMin(into: Record<string, number>, from: Readonly<Record<string, number>>): void {
  for (const [key, value] of Object.entries(from)) {
    into[key] = Math.min(into[key] ?? 1, value);
  }
}

/** Folds report `from` into `into`; the defeats stay the latest `keep`. */
export function mergeReport(into: TargetReport, from: TargetReport, keep: number): void {
  into.fights += from.fights;
  into.wins += from.wins;
  into.losses += from.losses;
  into.timeouts += from.timeouts;
  into.winMs += from.winMs;
  into.allMs += from.allMs;
  add(into.damage, from.damage);
  add(into.uses, from.uses);
  add(into.statuses, from.statuses);
  add(into.combos, from.combos);
  into.basic += from.basic;
  into.interrupts += from.interrupts;
  into.taken += from.taken;
  addMin(into.habLow, from.habLow);
  add(into.items, from.items);
  into.loot.ryo += from.loot.ryo;
  into.loot.bounty += from.loot.bounty;
  add(into.loot.items, from.loot.items);
  into.wounds += from.wounds;
  into.defeats.push(...from.defeats);
  if (into.defeats.length > keep) into.defeats.splice(0, into.defeats.length - keep);
}

/** Folds every report of `from` into `into`. */
export function mergeReports(
  into: Record<string, TargetReport>,
  from: Readonly<Record<string, TargetReport>>,
  content: ContentDb,
): void {
  const keep = content.balance.K.report.defeats;
  for (const [key, r] of Object.entries(from)) mergeReport((into[key] ??= blankReport()), r, keep);
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const count = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(MAX_COUNTED, Math.round(x)) : 0;

/** A record of non-negative whole numbers whose keys pass `allowed`; anything else is dropped. */
function counts(raw: unknown, allowed: (key: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (allowed(key) && typeof value === 'number') out[key] = count(value);
  }
  return out;
}

/** A saved report read back: unknown shapes become zeros, ids of other kinds are dropped. */
export function parseReport(raw: unknown, content: ContentDb): TargetReport | null {
  if (!isRecord(raw)) return null;
  const r = blankReport();
  const anyKey = (key: string): boolean => key.length > 0 && key.length <= 64;
  r.fights = count(raw.fights);
  r.wins = count(raw.wins);
  r.losses = count(raw.losses);
  r.timeouts = count(raw.timeouts);
  r.winMs = count(raw.winMs);
  r.allMs = count(raw.allMs);
  r.damage = counts(raw.damage, anyKey);
  r.uses = counts(raw.uses, anyKey);
  r.statuses = counts(raw.statuses, anyKey);
  r.combos = counts(raw.combos, anyKey);
  r.basic = count(raw.basic);
  r.interrupts = count(raw.interrupts);
  r.taken = count(raw.taken);
  if (isRecord(raw.habLow)) {
    for (const [key, v] of Object.entries(raw.habLow)) {
      if (anyKey(key) && typeof v === 'number' && Number.isFinite(v)) {
        r.habLow[key] = Math.min(1, Math.max(0, v));
      }
    }
  }
  r.items = counts(raw.items, anyKey);
  if (isRecord(raw.loot)) {
    r.loot = {
      ryo: count(raw.loot.ryo),
      bounty: count(raw.loot.bounty),
      items: counts(raw.loot.items, anyKey),
    };
  }
  r.wounds = count(raw.wounds);
  if (Array.isArray(raw.defeats)) {
    for (const d of raw.defeats.slice(-content.balance.K.report.defeats)) {
      if (!isRecord(d) || typeof d.enemy !== 'string') continue;
      r.defeats.push({
        at: count(d.at),
        enemy: d.enemy.slice(0, 64),
        tMs: count(d.tMs),
        chakra: Math.min(100, count(d.chakra)),
        stamina: Math.min(100, count(d.stamina)),
      });
    }
  }
  return r;
}
