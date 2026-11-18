import { readFileSync } from 'node:fs';
import { runBench } from './bench.ts';
import type { Bot } from './bot.ts';
import { bots } from './bots/index.ts';
import { runCraftsCli, runFightCli, runFighterCli } from './cliSim.ts';
import { buildEnvironment, parsePacks } from './env.ts';
import { buildReport, type Report } from './report.ts';
import { runTelemetryReportCli } from './telemetryReport.ts';
import type { Milestone } from './runner.ts';

const HOUR_MS = 3_600_000;
/** Longest game time a bot run may take before it is cut off. */
const LIMIT_MS = 6 * HOUR_MS;

export interface CliResult {
  code: number;
  out: string[];
  err: string[];
}

const clock = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  return `${String(m).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const minutes = (n: number): string => `${n.toFixed(1)} хв`;

function describe(m: Milestone, t: (key: string) => string): string {
  switch (m.type) {
    case 'skill':
      return `${t(`skill.${m.id}.name`)} ${m.level}`;
    case 'questStep':
      return `Квест «${t(`quest.${m.id}.name`)}»: крок ${m.step}`;
    case 'questDone':
      return `Квест «${t(`quest.${m.id}.name`)}» завершено`;
    case 'rank':
      return `Ранг: ${t(`rank.${m.id}`)}`;
    case 'renownRank':
      return `Ранг Репутації: ${t(`renownRank.${m.id}.name`)}`;
  }
}

function formatReport(report: Report, t: (key: string) => string): string[] {
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
  for (const m of run.timeline) out.push(`  ${clock(m.at)}  ${describe(m, t)}`);
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
export function runCli(argv: string[], registry: Readonly<Record<string, Bot>> = bots): CliResult {
  // `--packs core,testmod` picks the packs the run is played on; every command takes it.
  const at = argv.indexOf('--packs');
  const args = at < 0 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];
  const parsed = parsePacks(at < 0 ? undefined : argv[at + 1]);
  if (typeof parsed === 'string') return { code: 1, out: [], err: [parsed] };
  const env = buildEnvironment(parsed);
  const t = (key: string): string => env.content.locales.uk[key] ?? key;
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
        '  telemetry-report <файл>: Markdown-звіт із файлу телеметрії, експортованого з налаштувань',
        '  crafts: мирний бот збирає, варить, продає (pnpm sim crafts --help)',
        '  strategies: боти за стратегіями й звіт балансу (pnpm sim strategies --help)',
        '\nПриклад: pnpm sim academy --seed 1 --runs 5 [--json]',
      ],
    };
  }
  if (command === 'telemetry-report') {
    return runTelemetryReportCli(args.slice(1), env, (path) => readFileSync(path, 'utf8'));
  }
  if (command === 'fight') return runFightCli(args.slice(1), env);
  if (command === 'fighter') return runFighterCli(args.slice(1), env);
  if (command === 'crafts') return runCraftsCli(args.slice(1), env);
  if (command === 'bench') {
    return {
      code: 0,
      err: [],
      out: runBench(env).map(
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
  const report = buildReport(bot, {
    seed,
    runs,
    limitMs: bot.limitMs ?? LIMIT_MS,
    content: env.content,
    rules: env.rules,
  });
  const out = args.includes('--json') ? [JSON.stringify(report, null, 2)] : formatReport(report, t);
  const err = report.failed
    ? [
        `Збій: бот надсилав відхилені команди (перша причина: ${report.runs.find((r) => r.ended === 'failed')?.firstRejection ?? '?'}).`,
      ]
    : [];
  return { code: report.failed ? 1 : 0, out, err };
}
