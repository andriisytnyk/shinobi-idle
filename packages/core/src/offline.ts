import type { ContentDb } from '@shinobi/content';
import type { CloneDispelledEvent, GameEvent, RuleDisabledEvent } from './events.ts';
import { skillEntry } from './vocab.ts';
import { mergeReports, type TargetReport } from './combat/report.ts';
import { currentHp } from './combat/vitality.ts';
import { advance } from './engine.ts';
import type { ActionStoppedEvent } from './events.ts';
import { MS_PER_HOUR, masteryLevel } from './formulas.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { levelAt } from './xp.ts';

/** A raid met while away: it arrived, or it ended with these counts and this pay. */
export interface RaidAway {
  raid: string;
  over: boolean;
  repelled: number;
  byVillage: number;
  breached: number;
  ryo: number;
  rep: number;
}

export interface OfflineSummary {
  /** Time the caller reported, and the time actually simulated after the cap. */
  requestedMs: number;
  simulatedMs: number;
  capped: boolean;
  /** XP gained per skill, as it landed after modifiers, slowdown and the level cap. */
  skillXp: Partial<Record<string, number>>;
  levelsGained: Partial<Record<string, number>>;
  /** Mastery levels gained per mastery key. */
  masteryLevelsGained: Record<string, number>;
  /** Techniques learned and actions stopped while away, so the UI can explain what changed. */
  techniquesLearned: string[];
  actionsStopped: ActionStoppedEvent[];
  /** Rules of packs that failed and were switched off during the time away. */
  rulesDisabled?: RuleDisabledEvent[];
  /** The clones that were dispelled while away, with the XP each handed over (the XP is already in `skillXp`). */
  clonesDispelled?: CloneDispelledEvent[];
  /** Raids that arrived or ended while away, one row per raid (the village page has the detail). */
  raids?: RaidAway[];
  /** Items that reached the Bank while away: the net gain per item (what crafts and sales used up is netted off). Not saved. */
  itemsGained?: Record<string, number>;
  /** Currency that reached the Bank while away: the net gain per currency. Not saved. */
  currencyGained?: Record<string, number>;
  /** The character's health when the time away began and when it ended, and the most it can be. */
  hp?: { before: number; after: number; max: number };
  /** The battle report of the time away, by target. */
  reports: Record<string, TargetReport>;
}

/** The positive differences of two balances, per key. */
function gainOf(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(after)) {
    const n = (after[key] ?? 0) - (before[key] ?? 0);
    if (n > 0) out[key] = n;
  }
  return out;
}

/** Folds a raid event of the time away into the rows: one row per raid, its end replacing its arrival. */
function noteRaid(
  rows: RaidAway[],
  e: Extract<GameEvent, { type: 'raidArrived' | 'raidOver' }>,
): void {
  const row: RaidAway =
    e.type === 'raidOver'
      ? {
          raid: e.raid,
          over: true,
          repelled: e.repelled,
          byVillage: e.byVillage,
          breached: e.breached,
          ryo: e.ryo,
          rep: e.rep,
        }
      : { raid: e.raid, over: false, repelled: 0, byVillage: 0, breached: 0, ryo: 0, rep: 0 };
  const at = rows.findIndex((r) => r.raid === e.raid);
  if (at >= 0) rows[at] = row;
  else rows.push(row);
}

/**
 * Catches the game up after the app was closed. Simulates at most `offlineCapHours` of the
 * elapsed time, then reports what changed. The events of the catch-up are not queued.
 */
export function advanceOffline(
  state: GameState,
  elapsedMs: number,
  content: ContentDb,
  rules: Rules = defaultRules,
): OfflineSummary {
  const K = content.balance.K;
  const requestedMs = Math.max(0, Math.floor(elapsedMs));
  const simulatedMs = Math.min(requestedMs, K.offlineCapHours * MS_PER_HOUR);

  const skills = Object.keys(state.skills) as string[];
  const xpBefore = new Map(skills.map((s) => [s, skillEntry(state, s)?.xp ?? 0]));
  const levelBefore = new Map(
    skills.map((s) => [s, levelAt(skillEntry(state, s)?.xp ?? 0, K.cap)]),
  );
  const masteryBefore = new Map(
    Object.keys(state.mastery).map((key) => [key, masteryLevel(state, key, content)]),
  );

  const hpBefore = currentHp(state, 0, content).hp;
  const bankBefore = { ...state.bank };
  const currenciesBefore = { ...state.currencies };

  const queued = state.events;
  state.events = [];
  // The time away gets a report of its own; afterwards it is folded into the running one.
  const before = state.report;
  state.report = {};
  advance(state, simulatedMs, content, rules);
  const away = state.events;
  state.events = queued;
  const reports = state.report;
  state.report = before;
  mergeReports(state.report, reports, content);

  const now = currentHp(state, 0, content);
  const hpAfter = { after: now.hp, max: now.max };
  const summary: OfflineSummary = {
    requestedMs,
    simulatedMs,
    capped: simulatedMs < requestedMs,
    skillXp: {},
    levelsGained: {},
    masteryLevelsGained: {},
    techniquesLearned: [],
    actionsStopped: [],
    rulesDisabled: [],
    raids: [],
    clonesDispelled: [],
    itemsGained: gainOf(bankBefore, state.bank),
    currencyGained: gainOf(currenciesBefore, state.currencies),
    hp: { before: hpBefore, ...hpAfter },
    reports,
  };
  for (const e of away) {
    if (e.type === 'techniqueLearned') summary.techniquesLearned.push(e.id);
    else if (e.type === 'actionStopped') summary.actionsStopped.push(e);
    else if (e.type === 'cloneDispelled') summary.clonesDispelled?.push(e);
    else if (e.type === 'ruleDisabled') summary.rulesDisabled?.push(e);
    else if (e.type === 'raidArrived' || e.type === 'raidOver') noteRaid(summary.raids ?? [], e);
  }
  for (const skill of skills) {
    const xp = (skillEntry(state, skill)?.xp ?? 0) - (xpBefore.get(skill) ?? 0);
    if (xp > 0) summary.skillXp[skill] = xp;
    const levels =
      levelAt(skillEntry(state, skill)?.xp ?? 0, K.cap) - (levelBefore.get(skill) ?? 1);
    if (levels > 0) summary.levelsGained[skill] = levels;
  }
  for (const key of Object.keys(state.mastery)) {
    const levels = masteryLevel(state, key, content) - (masteryBefore.get(key) ?? 1);
    if (levels > 0) summary.masteryLevelsGained[key] = levels;
  }
  return summary;
}
