import { content as defaultContent, type ContentDb } from '@shinobi/content';
import { defaultRules, listSkillActions, type Rules } from '@shinobi/core';
import { createCraftsBot } from './bots/crafts.ts';
import { buildGeninStart } from './character.ts';
import { HOUR_MS, runHourly, type HourRow } from './hourly.ts';

/** Ryo a fresh Genin starts the crafts run with, so that the first goods can be bought. */
export const CRAFTS_START_RYO = 100;

export interface CraftsHour {
  hour: number;
  /** Levels of the trade skills at the end of the hour. */
  levels: Record<string, number>;
  ryoSold: number;
  ryoSpent: number;
  crafted: number;
  gathered: number;
  /** Share of the hour with nothing running because the bot found nothing to start, 0 to 1. */
  idle: number;
}

export interface CraftsReport {
  seed: number;
  hours: number;
  skills: string[];
  rows: CraftsHour[];
  /** Totals over the run. */
  totals: { ryoSold: number; ryoSpent: number; crafted: number; gathered: number; idle: number };
  rejected: number;
  firstRejection: string | null;
}

const round = (n: number, d = 4): number => Math.round(n * 10 ** d) / 10 ** d;

/** The skills that train through gather or craft actions, found from the content. */
export function tradeSkills(
  content: ContentDb,
  rules: Rules,
  state: Parameters<typeof listSkillActions>[0],
): string[] {
  return content.skills
    .filter((s) =>
      listSkillActions(state, s.id, content, rules).some(
        (a) => a.kind === 'gather' || a.kind === 'craft',
      ),
    )
    .map((s) => s.id);
}

export function craftsReport(o: {
  seed: number;
  hours: number;
  content?: ContentDb;
  rules?: Rules;
}): CraftsReport {
  const content = o.content ?? defaultContent;
  const rules = o.rules ?? defaultRules;
  const start = buildGeninStart(content, o.seed, CRAFTS_START_RYO);
  const skills = tradeSkills(content, rules, start);
  const run = runHourly(createCraftsBot(), {
    seed: o.seed,
    hours: o.hours,
    initialState: start,
    content,
    rules,
  });
  const rows = run.rows.map((r: HourRow): CraftsHour => ({
    hour: r.hour,
    levels: Object.fromEntries(skills.map((id) => [id, r.levels[id] ?? 1])),
    ryoSold: r.ryoSold,
    ryoSpent: r.ryoSpent,
    crafted: r.crafted,
    gathered: r.gathered,
    idle: round(r.idleMs / HOUR_MS),
  }));
  const total = (pick: (r: CraftsHour) => number) => rows.reduce((s, r) => s + pick(r), 0);
  return {
    seed: o.seed,
    hours: o.hours,
    skills,
    rows,
    totals: {
      ryoSold: total((r) => r.ryoSold),
      ryoSpent: total((r) => r.ryoSpent),
      crafted: total((r) => r.crafted),
      gathered: total((r) => r.gathered),
      idle: round(total((r) => r.idle) / Math.max(1, rows.length)),
    },
    rejected: run.rejected,
    firstRejection: run.firstRejection,
  };
}
