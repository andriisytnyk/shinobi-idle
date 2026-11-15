import type { Bot } from './bot.ts';
import { runBot, type Milestone, type RunOptions, type RunResult } from './runner.ts';

const HOUR_MS = 3_600_000;

export interface RunSummary {
  seed: number;
  ended: RunResult['ended'];
  /** Game minutes until the bot's goal held; null when it did not. */
  minutes: number | null;
  timeline: Milestone[];
  xp: Record<string, number>;
  /** XP per game hour over the whole run, by skill. */
  xpPerHour: Record<string, number>;
  kills: Record<string, number>;
  actions: Record<string, number>;
  rejected: number;
  firstRejection: string | null;
}

export interface Report {
  bot: string;
  /** Label of the goal the times refer to. */
  goal: string;
  seeds: number[];
  minutes: { min: number; median: number; max: number } | null;
  /** The run in the middle when sorted by time (the lower middle for an even count). */
  median: RunSummary;
  runs: RunSummary[];
  /** True when some run ended `failed` (too many rejected commands). */
  failed: boolean;
}

export interface ReportOptions extends Omit<RunOptions, 'seed'> {
  /** First seed; run `i` uses `seed + i`. */
  seed: number;
  runs: number;
}

function summarize(run: RunResult): RunSummary {
  const hours = run.endedAt / HOUR_MS;
  return {
    seed: run.seed,
    ended: run.ended,
    minutes: run.goalAt === null ? null : run.goalAt / 60_000,
    timeline: run.timeline,
    xp: run.xp,
    xpPerHour: Object.fromEntries(
      Object.entries(run.xp).map(([skill, xp]) => [skill, Math.round(xp / hours)]),
    ),
    kills: run.kills,
    actions: run.actions,
    rejected: run.rejected,
    firstRejection: run.firstRejection,
  };
}

/** Runs `bot` on seeds `seed .. seed + runs - 1` with the given run options and condenses the results. */
export function buildReport(bot: Bot, options: ReportOptions): Report {
  const { runs, seed, ...rest } = options;
  const summaries = Array.from({ length: runs }, (_, i) =>
    summarize(runBot(bot, { ...rest, seed: seed + i })),
  );
  const sorted = [...summaries].sort(
    (a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity) || a.seed - b.seed,
  );
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  if (!median) throw new RangeError('runs must be at least 1');
  const reached = summaries.flatMap((s) => (s.minutes === null ? [] : [s.minutes]));
  return {
    bot: bot.name,
    goal: bot.goal.label,
    seeds: summaries.map((s) => s.seed),
    minutes:
      reached.length === summaries.length
        ? { min: Math.min(...reached), median: median.minutes ?? 0, max: Math.max(...reached) }
        : null,
    median,
    runs: summaries,
    failed: summaries.some((s) => s.ended === 'failed'),
  };
}
