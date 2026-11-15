import { ukLocale } from '@shinobi/content';
import { runBench } from './bench.ts';
import { bots } from './bots/index.ts';
import { buildReport, type Report } from './report.ts';
import type { Milestone } from './runner.ts';

const HOUR_MS = 3_600_000;
/** Longest game time a bot run may take before it is cut off. */
const LIMIT_MS = 6 * HOUR_MS;

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

function printReport(report: Report): void {
  console.log(`Бот: ${report.bot}, сіди: ${report.seeds.join(', ')}`);
  if (report.minutes) {
    const { min, median, max } = report.minutes;
    console.log(
      `Час до Геніна: мін ${minutes(min)}, медіана ${minutes(median)}, макс ${minutes(max)}`,
    );
  } else {
    console.log('Час до Геніна: не в усіх прогонах досягнуто в межах ліміту');
  }
  const run = report.median;
  console.log(`\nХронологія медіанного прогону (сід ${run.seed}):`);
  for (const m of run.timeline) console.log(`  ${clock(m.at)}  ${describe(m)}`);
  console.log('\nXP за годину за навичками:');
  const rows = Object.entries(run.xpPerHour).sort((a, b) => b[1] - a[1]);
  for (const [skill, perHour] of rows) {
    console.log(`  ${t(`skill.${skill}.name`)}: ${perHour} XP/год (усього ${run.xp[skill] ?? 0})`);
  }
  const kills = Object.entries(run.kills).map(([id, n]) => `${id} ${n}`);
  if (kills.length > 0) console.log(`\nПоразки ворогів: ${kills.join(', ')}`);
  const actions = Object.entries(run.actions).map(([kind, n]) => `${kind} ${n}`);
  if (actions.length > 0) console.log(`Дії за видами: ${actions.join(', ')}`);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function wholeOption(args: string[], name: string, fallback: number): number {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--${name} має бути цілим числом від 1, а не «${raw}»`);
    process.exit(1);
  }
  return n;
}

function main(args: string[]): void {
  const [command] = args;
  if (!command) {
    console.log('Доступні команди:');
    for (const bot of Object.values(bots)) console.log(`  ${bot.name}: ${bot.description}`);
    console.log('  bench: вимір швидкості advance на 12 ігрових годин');
    console.log('\nПриклад: pnpm sim academy --seed 1 --runs 5 [--json]');
    return;
  }
  if (command === 'bench') {
    for (const r of runBench()) {
      console.log(
        `${r.label}: ${r.gameHours} ігрових годин за ${r.ms.toFixed(0)} мс ` +
          `(${r.hoursPerSecond.toFixed(0)} ігрових годин/с)`,
      );
    }
    return;
  }
  const bot = bots[command];
  if (!bot) {
    console.error(`Невідомий бот «${command}». Запустіть «pnpm sim», щоб побачити список.`);
    process.exit(1);
  }
  const report = buildReport(
    bot,
    wholeOption(args, 'seed', 1),
    wholeOption(args, 'runs', 1),
    LIMIT_MS,
  );
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}

main(process.argv.slice(2));
