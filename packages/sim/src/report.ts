import type { Bot } from './bot.ts';
import { runBot, type Milestone, type RunResult } from './runner.ts';

const HOUR_MS = 3_600_000;

export interface RunSummary {
  seed: number;
  ended: 'done' | 'limit';
  /** Game minutes until the bot's goal held; null when the limit came first. */
  minutes: number | null;
  timeline: Milestone[];
  xp: Record<string, number>;
  /** XP per game hour over the whole run, by skill. */
  xpPerHour: Record<string, number>;
  kills: Record<string, number>;
  actions: Record<string, number>;
  rejected: number;
}

export interface Report {
  bot: string;
  seeds: number[];
  minutes: { min: number; median: number; max: number } | null;
  /** The run in the middle when sorted by time. */
  median: RunSummary;
  runs: RunSummary[];
}

function summarize(run: RunResult): RunSummary {
  const hours = run.endedAt / HOUR_MS;
  return {
    seed: run.seed,
    ended: run.ended,
    minutes: run.ended === 'done' ? run.endedAt / 60_000 : null,
    timeline: run.timeline,
    xp: run.xp,
    xpPerHour: Object.fromEntries(
      Object.entries(run.xp).map(([skill, xp]) => [skill, Math.round(xp / hours)]),
    ),
    kills: run.kills,
    actions: run.actions,
    rejected: run.rejected,
  };
}

/** Time of the goal in a run: the moment of its last rank-up, so a step coarser than 1 ms cannot skew it. */
function goalMinutes(run: RunResult): number | null {
  if (run.ended !== 'done') return null;
  const ranks = run.timeline.filter((m) => m.type === 'rank');
  const last = ranks[ranks.length - 1];
  return (last ? last.at : run.endedAt) / 60_000;
}

/** Runs `bot` on seeds `seed .. seed + runs - 1` and condenses the results. */
export function buildReport(bot: Bot, seed: number, runs: number, limitMs: number): Report {
  const results = Array.from({ length: runs }, (_, i) => runBot(bot, { seed: seed + i, limitMs }));
  const summaries = results.map((run) => {
    const summary = summarize(run);
    return { ...summary, minutes: goalMinutes(run) };
  });
  const sorted = [...summaries].sort(
    (a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity) || a.seed - b.seed,
  );
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  if (!median) throw new RangeError('runs must be at least 1');
  const times = summaries.map((s) => s.minutes);
  const reached = times.filter((t): t is number => t !== null);
  return {
    bot: bot.name,
    seeds: summaries.map((s) => s.seed),
    minutes:
      reached.length === times.length
        ? {
            min: Math.min(...reached),
            median: median.minutes ?? 0,
            max: Math.max(...reached),
          }
        : null,
    median,
    runs: summaries,
  };
}
