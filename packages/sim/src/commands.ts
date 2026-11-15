import { ukLocale } from '@shinobi/content';
import { runBench } from './bench.ts';
import type { Bot } from './bot.ts';
import { bots } from './bots/index.ts';
import { runCraftsCli, runFightCli } from './cliSim.ts';
import { buildReport, type Report } from './report.ts';
import type { Milestone } from './runner.ts';

const HOUR_MS = 3_600_000;
/** Longest game time a bot run may take before it is cut off. */
const LIMIT_MS = 6 * HOUR_MS;

export interface CliResult {
  code: number;
  out: string[];
  err: string[];
}

const t = (key: string): string => ukLocale[key] ?? key;

const clock = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  return `${String(m).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const minutes = (n: number): string => `${n.toFixed(1)} хв`;

function describe(m: Milestone): string {
  switch (m.type) {
    case 'skill':
      return `${t(`skill.${m.id}.name`)} ${m.level}`;
    case 'questStep':
      return `Квест «${t(`quest.${m.id}.name`)}»: крок ${m.step}`;
    case 'questDone':
      return `Квест «${t(`quest.${m.id}.name`)}» завершено`;
    case 'rank':
      return `Ранг: ${t(`rank.${m.id}`)}`;
  }
}

function formatReport(report: Report): string[] {
  const out = [`Бот: ${report.bot}, сіди: ${report.seeds.join(', ')}`];
  if (report.minutes) {
    const { min, median, max } = report.minutes;
    out.push(
      `Час до цілі «${report.goal}»: мін ${minutes(min)}, медіана ${minutes(median)}, макс ${minutes(max)}`,
    );
  } else {
    out.push(`Ціль «${report.goal}» досягнута не в усіх прогонах у межах ліміту`);
  }
  const run = report.median;
  out.push(`\nХронологія медіанного прогону (сід ${run.seed}):`);
  for (const m of run.timeline) out.push(`  ${clock(m.at)}  ${describe(m)}`);
  out.push('\nXP за годину за навичками:');
  const rows = Object.entries(run.xpPerHour).sort((a, b) => b[1] - a[1]);
  for (const [skill, perHour] of rows) {
    out.push(`  ${t(`skill.${skill}.name`)}: ${perHour} XP/год (усього ${run.xp[skill] ?? 0})`);
  }
  const kills = Object.entries(run.kills).map(([id, n]) => `${id} ${n}`);
  if (kills.length > 0) out.push(`\nПоразки ворогів: ${kills.join(', ')}`);
  const actions = Object.entries(run.actions).map(([kind, n]) => `${kind} ${n}`);
  if (actions.length > 0) out.push(`Дії за видами: ${actions.join(', ')}`);
  return out;
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** A whole number of at least 1, or null when the option is malformed. */
function wholeOption(args: string[], name: string, fallback: number): number | null {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Runs one CLI invocation and returns what it would print and its exit code. */
export function runCli(args: string[], registry: Readonly<Record<string, Bot>> = bots): CliResult {
  const [command] = args;
  if (!command) {
    return {
      code: 0,
      err: [],
      out: [
        'Доступні команди:',
        ...Object.values(registry).map((bot) => `  ${bot.name}: ${bot.description}`),
        '  bench: вимір швидкості advance на 12 ігрових годин',
        '  fight: бої з ворогом чи босом для типового гравця (pnpm sim fight --help)',
        '  crafts: мирний бот збирає, варить, продає (pnpm sim crafts --help)',
        '\nПриклад: pnpm sim academy --seed 1 --runs 5 [--json]',
      ],
    };
  }
  if (command === 'fight') return runFightCli(args.slice(1));
  if (command === 'crafts') return runCraftsCli(args.slice(1));
  if (command === 'bench') {
    return {
      code: 0,
      err: [],
      out: runBench().map(
        (r) =>
          `${r.label}: ${r.gameHours} ігрових годин за ${r.ms.toFixed(0)} мс ` +
          `(${r.hoursPerSecond.toFixed(0)} ігрових годин/с)`,
      ),
    };
  }
  const bot = registry[command];
  if (!bot) {
    return {
      code: 1,
      out: [],
      err: [`Невідомий бот «${command}». Запустіть «pnpm sim», щоб побачити список.`],
    };
  }
  const seed = wholeOption(args, 'seed', 1);
  const runs = wholeOption(args, 'runs', 1);
  if (seed === null || runs === null) {
    return { code: 1, out: [], err: ['--seed і --runs мають бути цілими числами від 1.'] };
  }
  const report = buildReport(bot, { seed, runs, limitMs: LIMIT_MS });
  const out = args.includes('--json') ? [JSON.stringify(report, null, 2)] : formatReport(report);
  const err = report.failed
    ? [
        `Збій: бот надсилав відхилені команди (перша причина: ${report.runs.find((r) => r.ended === 'failed')?.firstRejection ?? '?'}).`,
      ]
    : [];
  return { code: report.failed ? 1 : 0, out, err };
}
