import { content, NATURE_IDS, ukLocale, type NatureId } from '@shinobi/content';
import type { Rank } from '@shinobi/core';
import { parseArgs, wholeValue } from './args.ts';
import type { CliResult } from './commands.ts';
import { craftsReport } from './craftsReport.ts';
import { allEntries, fightReport, rowJson, RATIO_BAND, type FightRow } from './fightReport.ts';

const RANKS: readonly Rank[] = ['student', 'genin', 'chunin'];

export const FIGHT_HELP = [
  'pnpm sim fight --enemy <id> | --zone <id> | --all [--level N] [--natures a,b,c] [--rank student|genin|chunin] [--runs K] [--seed S] [--json]',
  '  --enemy <id>   ворог або бос за ідентифікатором',
  '  --zone <id>    зона за ідентифікатором (її ворог)',
  '  --all          усі записи ворогів і босів з контенту на рекомендованому рівні',
  '  --level N      рівень усіх навичок гравця (типово — бойовий рівень ворога)',
  '  --natures      природи гравця через кому (типово — перша з контенту)',
  '  --rank         ранг гравця (типово — за рівнем)',
  '  --runs K       боїв на запис (типово 200), --seed S — сід (типово 1)',
  '  --json         вивід у JSON',
  'Типовий гравець будується засобами рушія: навички, природи, майстерність 20, магазин, автонабір.',
  'У таблиці --all поруч — очікування спрощеної моделі балансу (час убивства) і відношення рушій/модель;',
  `рядки поза ${RATIO_BAND[0]}–${RATIO_BAND[1]} позначені «!».`,
];

export const CRAFTS_HELP = [
  'pnpm sim crafts [--seed S] [--hours H] [--json]',
  '  --hours H   ігрових годин мирної гри (типово 6), --seed S — сід (типово 1)',
  'Бот збирає трави, варить, продає вироби. По годинах: рівні ремісничих навичок, рьо з продажу,',
  'витрати на товари, виготовлено, збирань, простій (частка години без дії).',
];

const nameOf = (id: string): string =>
  ukLocale[`enemy.${id}.name`] ?? ukLocale[`boss.${id}.name`] ?? id;

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const padL = (s: string | number, n: number): string => String(s).padStart(n);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const sec = (n: number | undefined): string => (n === undefined ? '—' : n.toFixed(1));

function topDamage(row: FightRow, count: number): string {
  return Object.entries(row.stats.damageShare)
    .slice(0, count)
    .map(([id, share]) => `${id.replace(/^core:/, '')} ${pct(share)}`)
    .join(', ');
}

function fightTable(rows: FightRow[]): string[] {
  const head =
    `${pad('', 1)} ${pad('ворог', 28)} ${padL('cl', 3)} ${padL('перем.', 6)} ${padL('сер.с', 6)} ` +
    `${padL('p10', 5)} ${padL('p90', 5)} ${padL('HP%', 4)}  ${pad('перем/пор/втеча/ліміт', 22)} ` +
    `${padL('мод.с', 6)} ${padL('відн.', 5)}  шкода`;
  const out = [head];
  for (const r of rows) {
    const o = r.stats.outcomes;
    out.push(
      `${r.flagged ? '!' : ' '} ${pad(r.enemy.replace(/^core:/, ''), 28)} ${padL(r.cl, 3)} ` +
        `${padL(pct(r.stats.winRate), 6)} ${padL(sec(r.stats.timeSec?.mean), 6)} ` +
        `${padL(sec(r.stats.timeSec?.p10), 5)} ${padL(sec(r.stats.timeSec?.p90), 5)} ` +
        `${padL(r.stats.hpLeft ? Math.round(r.stats.hpLeft.share * 100) : '—', 4)}  ` +
        `${pad(`${o.victory}/${o.defeat}/${o.fled}/${o.timeout}`, 22)} ` +
        `${padL(r.model ? r.model.ttkSec.toFixed(1) : '—', 6)} ` +
        `${padL(r.ratio === null ? '—' : r.ratio.toFixed(2), 5)}  ${topDamage(r, 3)}`,
    );
  }
  return out;
}

function fightDetail(r: FightRow): string[] {
  const s = r.stats;
  const o = s.outcomes;
  return [
    `${nameOf(r.enemy)} (${r.enemy}), бойовий рівень ${r.cl}`,
    `Гравець: рівень ${r.level}, ранг ${r.rank}, природи ${r.natures.join(', ') || '—'}, HP ${s.maxHp.toFixed(0)}`,
    `Набір: ${r.loadout.join(', ') || '—'}`,
    `Перемог: ${pct(s.winRate)} з ${s.runs} (перемога ${o.victory}, поразка ${o.defeat}, втеча ${o.fled}, ліміт часу ${o.timeout})`,
    s.timeSec
      ? `Тривалість виграних боїв, с: середня ${sec(s.timeSec.mean)}, p10 ${sec(s.timeSec.p10)}, p90 ${sec(s.timeSec.p90)}`
      : 'Тривалість: жодного виграного бою',
    s.hpLeft
      ? `HP наприкінці: середнє ${s.hpLeft.mean.toFixed(0)} (${pct(s.hpLeft.share)})`
      : 'HP наприкінці: —',
    `Шкода за джерелами: ${topDamage(r, 12) || '—'}`,
    r.model
      ? `Модель: час убивства ${r.model.ttkSec.toFixed(1)} с, втрата HP ${pct(r.model.hpLossShare)}; відношення рушій/модель ${r.ratio === null ? '—' : r.ratio.toFixed(2)}${r.flagged ? ' !' : ''}`
      : 'Модель: —',
  ];
}

/** `pnpm sim fight`: how fights against an enemy go for a typical character of a given level. */
export function runFightCli(args: string[]): CliResult {
  const parsed = parseArgs(
    args,
    ['enemy', 'zone', 'level', 'natures', 'rank', 'runs', 'seed'],
    ['all', 'json', 'help'],
  );
  const fail = (...err: string[]): CliResult => ({ code: 1, out: [], err });
  if (parsed.flags.has('help')) return { code: 0, out: FIGHT_HELP, err: [] };
  if (parsed.errors.length > 0) return fail(...parsed.errors, 'Довідка: pnpm sim fight --help');
  const runs = wholeValue(parsed, 'runs', 200);
  const seed = wholeValue(parsed, 'seed', 1);
  const level = parsed.values.level === undefined ? undefined : wholeValue(parsed, 'level', 1);
  if (runs === null || seed === null || level === null) {
    return fail('--runs, --seed і --level мають бути цілими числами від 1.');
  }
  const rank = parsed.values.rank as Rank | undefined;
  if (rank !== undefined && !RANKS.includes(rank))
    return fail(`--rank: одне з ${RANKS.join(', ')}.`);
  const natures = parsed.values.natures?.split(',').filter((n) => n !== '') as
    NatureId[] | undefined;
  if (natures?.some((n) => !(NATURE_IDS as readonly string[]).includes(n))) {
    return fail(`--natures: природи з ${NATURE_IDS.join(', ')}.`);
  }

  const picks = [parsed.flags.has('all'), 'enemy' in parsed.values, 'zone' in parsed.values].filter(
    Boolean,
  );
  if (picks.length !== 1)
    return fail('Потрібен рівно один із --enemy, --zone, --all.', ...FIGHT_HELP.slice(0, 1));
  let entries: string[];
  if (parsed.flags.has('all')) entries = allEntries(content).map((e) => e.id);
  else if (parsed.values.zone !== undefined) {
    const zone = content.zones.find((z) => z.id === parsed.values.zone);
    if (!zone) return fail(`Невідома зона «${parsed.values.zone}».`);
    entries = [zone.enemy];
  } else {
    const id = parsed.values.enemy as string;
    if (!allEntries(content).some((e) => e.id === id))
      return fail(`Невідомий ворог або бос «${id}».`);
    entries = [id];
  }

  const rows = fightReport({
    entries,
    runs,
    seed,
    ...(level === undefined ? {} : { level }),
    ...(natures ? { natures } : {}),
    ...(rank ? { rank } : {}),
  });
  if (parsed.flags.has('json')) {
    return { code: 0, err: [], out: [JSON.stringify(rows.map(rowJson), null, 2)] };
  }
  if (parsed.flags.has('all')) {
    const bad = rows.filter((r) => r.flagged).length;
    return {
      code: 0,
      err: [],
      out: [
        `Типовий гравець на рекомендованому рівні кожного запису; боїв на рядок: ${runs}, сід ${seed}.`,
        'Перем. — частка перемог і втеч; HP% — середній залишок HP у виграних боях; «мод.с» — час убивства за спрощеною моделлю; «відн.» — середній бій рушія / модель.',
        ...fightTable(rows),
        `Позначено «!» (відношення поза ${RATIO_BAND[0]}–${RATIO_BAND[1]} або немає даних): ${bad} з ${rows.length}.`,
      ],
    };
  }
  return { code: 0, err: [], out: rows.flatMap(fightDetail) };
}

/** `pnpm sim crafts`: how a gathering and crafting player progresses and earns. */
export function runCraftsCli(args: string[]): CliResult {
  const parsed = parseArgs(args, ['seed', 'hours'], ['json', 'help']);
  if (parsed.flags.has('help')) return { code: 0, out: CRAFTS_HELP, err: [] };
  if (parsed.errors.length > 0) {
    return { code: 1, out: [], err: [...parsed.errors, 'Довідка: pnpm sim crafts --help'] };
  }
  const seed = wholeValue(parsed, 'seed', 1);
  const hours = wholeValue(parsed, 'hours', 6);
  if (seed === null || hours === null) {
    return { code: 1, out: [], err: ['--seed і --hours мають бути цілими числами від 1.'] };
  }
  const report = craftsReport({ seed, hours });
  if (parsed.flags.has('json')) return { code: 0, err: [], out: [JSON.stringify(report, null, 2)] };
  const name = (id: string) => ukLocale[`skill.${id}.name`] ?? id;
  const out = [
    `Бот: crafts, сід ${seed}, ігрових годин ${hours}`,
    `${pad('год', 4)} ${report.skills.map((s) => padL(name(s), 11)).join(' ')} ${padL('продано', 8)} ${padL('витрачено', 10)} ${padL('зварено', 8)} ${padL('зібрано', 8)} ${padL('простій', 8)}`,
    ...report.rows.map(
      (r) =>
        `${pad(r.hour, 4)} ${report.skills.map((s) => padL(r.levels[s] ?? 1, 11)).join(' ')} ${padL(r.ryoSold, 8)} ${padL(r.ryoSpent, 10)} ${padL(r.crafted, 8)} ${padL(r.gathered, 8)} ${padL(pct(r.idle), 8)}`,
    ),
    `Разом: продано на ${report.totals.ryoSold} рьо, витрачено ${report.totals.ryoSpent}, зварено ${report.totals.crafted}, зібрано ${report.totals.gathered}, простій ${pct(report.totals.idle)}`,
  ];
  const err =
    report.rejected > 0
      ? [
          `Бот надсилав відхилені команди: ${report.rejected} (перша причина: ${report.firstRejection ?? '?'}).`,
        ]
      : [];
  return { code: 0, out, err };
}
