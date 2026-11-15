import { content as builtIn, type NatureId } from '@shinobi/content';
import type { Rank } from '@shinobi/core';
import { parseArgs, wholeValue } from './args.ts';
import type { CliResult } from './commands.ts';
import type { FoodMode, PouchMode } from './character.ts';
import { ranksOf, REPORT } from './constants.ts';
import type { Environment } from './env.ts';
import { craftsReport } from './craftsReport.ts';
import { fighterReport } from './fighterReport.ts';
import { allEntries, fightReport, rowJson, type FightRow, type Reason } from './fightReport.ts';
import { MODEL_IGNORES } from './model.ts';

const YARDSTICK =
  'Гравець — мірило, а не досяжний стан: усі навички на одному рівні, майстерність технік 20, село з будівлями, яких потребує магазин, безкоштовний підсумок.';

export const FIGHT_HELP = [
  'pnpm sim fight --enemy <id> | --zone <id> | --all [--level N] [--natures a,b,c] [--rank student|genin|chunin] [--pouch none|shop] [--food model|none] [--runs K] [--seed S] [--json]',
  '  --enemy <id>   ворог або бос за ідентифікатором',
  '  --zone <id>    зона за ідентифікатором (її ворог)',
  '  --all          усі записи ворогів і босів з контенту на рекомендованому рівні',
  '  --level N      рівень усіх навичок мірила (типово — бойовий рівень ворога; вище за стелю навичок обрізається)',
  '  --natures      природи мірила через кому (типово — перша з контенту)',
  '  --rank         ранг мірила (типово — за рівнем)',
  '  --pouch        none (типово): без інструментів у підсумку; shop: усе, що продає магазин. Відношення до моделі рахується на цьому режимі',
  '  --food         model: страви, що їх дає модель балансу (типово для босів); none: без страв (типово для звичайних ворогів)',
  '  --runs K       боїв на запис (типово 200), --seed S — сід (типово 1)',
  '  --json         вивід у JSON (поле reasons каже, чому рядок позначено)',
  YARDSTICK,
  'Мірило будується засобами рушія: навички, природи, автонабір, покупки через shop.buy.',
  'У таблиці --all поруч — очікування спрощеної моделі балансу (час убивства) для того самого мірила і відношення рушій/модель.',
  `Позначка «!»: відношення поза ${REPORT.ratioBand[0]}–${REPORT.ratioBand[1]}, перемог менше ${REPORT.enemyMinWin * 100}% (звичайний ворог) або поза ${REPORT.bossWinBand[0] * 100}–${REPORT.bossWinBand[1] * 100}% (бос), або відношення спирається на менш ніж ${REPORT.minWinsForRatio} виграних боїв (тоді воно в дужках). Пороги звітні, не баланс.`,
  `Модель не враховує: ${MODEL_IGNORES.join('; ')}.`,
];

export const CRAFTS_HELP = [
  'pnpm sim crafts [--seed S] [--hours H] [--json]',
  '  --hours H   ігрових годин мирної гри (типово 6), --seed S — сід (типово 1)',
  'Бот збирає трави, варить, продає вироби; починає свіжим Геніном із невеликою сумою рьо і селом з будівлями, яких потребує магазин.',
  'По годинах: рівні ремісничих навичок, рьо з продажу, витрати на товари, чистий прибуток, виготовлено, збирань, простій.',
];

export const FIGHTER_HELP = [
  'pnpm sim fighter [--seed S] [--hours H] [--json]',
  '  --hours H   ігрових годин (типово 3), --seed S — сід (типово 1)',
  'Бот-боєць із стану свіжого Геніна б’ється в найвищій безпечній зоні (оцінка перемог ≥ 0,9), між боями тренується, поповнює підсумок.',
  'По годинах: зона, перемоги, поразки, досвід бою за навичками, рьо, Рани, витрати на підсумок.',
];

/** The Ukrainian strings of the content of the command being run (the CLI runs one command at a time). */
let ukLocale: Readonly<Record<string, string>> = builtIn.locales.uk;

const nameOf = (id: string): string =>
  ukLocale[`enemy.${id}.name`] ?? ukLocale[`boss.${id}.name`] ?? id;
const skillName = (id: string): string => ukLocale[`skill.${id}.name`] ?? id;

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const padL = (s: string | number, n: number): string => String(s).padStart(n);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const sec = (n: number | undefined): string => (n === undefined ? '—' : n.toFixed(1));

const REASON_TEXT: Record<Reason, string> = {
  ratio: 'відн.',
  win: 'перемоги',
  fewWins: `<${REPORT.minWinsForRatio} виграних`,
  noWins: 'без перемог',
};

function topDamage(stats: FightRow['stats'], count: number): string {
  return Object.entries(stats.damageShare)
    .slice(0, count)
    .map(([id, share]) => `${id.replace(/^core:/, '')} ${pct(share)}`)
    .join(', ');
}

/** The ratio as text: in brackets when it rests on too few wins, a dash when there is none. */
function ratioText(r: FightRow): string {
  if (r.ratio === null) return '—';
  const text = r.ratio.toFixed(2);
  return r.wins < REPORT.minWinsForRatio ? `(${text})` : text;
}

function fightTable(rows: FightRow[]): string[] {
  const head =
    `${pad('', 1)} ${pad('ворог', 22)} ${padL('cl', 3)} ${padL('їжа', 4)} ${padL('перем.', 6)} ${padL('сер.с', 6)} ` +
    `${padL('p10', 5)} ${padL('p90', 5)} ${padL('HP%', 4)}  ${pad('перем/пор/втеча/ліміт', 21)} ` +
    `${padL('мод.с', 6)} ${padL('відн.', 7)} ${padL('сер.с+підс.', 11)} ${padL('перем.+підс.', 12)}  ${pad('причина', 18)} шкода`;
  const out = [head];
  for (const r of rows) {
    const o = r.stats.outcomes;
    const w = r.withPouch;
    out.push(
      `${r.flagged ? '!' : ' '} ${pad(r.enemy.replace(/^core:/, ''), 22)} ${padL(r.cl, 3)} ${padL(r.food === 'model' ? 'так' : 'ні', 4)} ` +
        `${padL(pct(r.stats.winRate), 6)} ${padL(sec(r.stats.timeSec?.mean), 6)} ` +
        `${padL(sec(r.stats.timeSec?.p10), 5)} ${padL(sec(r.stats.timeSec?.p90), 5)} ` +
        `${padL(r.stats.hpLeft ? Math.round(r.stats.hpLeft.share * 100) : '—', 4)}  ` +
        `${pad(`${o.victory}/${o.defeat}/${o.fled}/${o.timeout}`, 21)} ` +
        `${padL(r.model ? r.model.ttkSec.toFixed(1) : '—', 6)} ${padL(ratioText(r), 7)} ` +
        `${padL(sec(w?.timeSec?.mean), 11)} ${padL(w ? pct(w.winRate) : '—', 12)}  ` +
        `${pad(r.reasons.map((x) => REASON_TEXT[x]).join(', '), 18)} ${topDamage(r.stats, 3)}`,
    );
  }
  return out;
}

function fightDetail(r: FightRow): string[] {
  const s = r.stats;
  const o = s.outcomes;
  const lines = [
    `${nameOf(r.enemy)} (${r.enemy}), бойовий рівень ${r.cl}`,
    `Мірило: рівень ${r.level}, ранг ${r.rank}, природи ${r.natures.join(', ') || '—'}, HP ${s.maxHp.toFixed(0)}; підсумок: ${r.pouch}, страви: ${r.food}`,
    YARDSTICK,
    `Набір: ${r.loadout.join(', ') || '—'}`,
    `Перемог: ${pct(s.winRate)} з ${s.runs} (перемога ${o.victory}, поразка ${o.defeat}, втеча ${o.fled}, ліміт часу ${o.timeout})`,
    s.timeSec
      ? `Тривалість виграних боїв, с: середня ${sec(s.timeSec.mean)}, p10 ${sec(s.timeSec.p10)}, p90 ${sec(s.timeSec.p90)}`
      : 'Тривалість: жодного виграного бою',
    s.hpLeft
      ? `HP наприкінці: середнє ${s.hpLeft.mean.toFixed(0)} (${pct(s.hpLeft.share)})`
      : 'HP наприкінці: —',
    `Шкода за джерелами: ${topDamage(s, 12) || '—'}`,
  ];
  if (r.withPouch && r.pouch !== 'shop') {
    lines.push(
      `З інструментами магазину в підсумку: перемог ${pct(r.withPouch.winRate)}, середній час ${sec(r.withPouch.timeSec?.mean)} с`,
    );
  }
  lines.push(
    r.model
      ? `Модель: час убивства ${r.model.ttkSec.toFixed(1)} с, втрата HP ${pct(r.model.hpLossShare)}; відношення рушій/модель ${ratioText(r)}${r.flagged ? ` ! (${r.reasons.map((x) => REASON_TEXT[x]).join(', ')})` : ''}`
      : 'Модель: —',
  );
  return lines;
}

/** `pnpm sim fight`: how fights against an enemy go for a yardstick character of a given level. */
export function runFightCli(args: string[], env: Environment): CliResult {
  const { content } = env;
  ukLocale = content.locales.uk;
  const RANKS = ranksOf(content);
  const parsed = parseArgs(
    args,
    ['enemy', 'zone', 'level', 'natures', 'rank', 'runs', 'seed', 'pouch', 'food'],
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
  const pouch = parsed.values.pouch as PouchMode | undefined;
  if (pouch !== undefined && pouch !== 'none' && pouch !== 'shop')
    return fail('--pouch: none або shop.');
  const food = parsed.values.food as FoodMode | undefined;
  if (food !== undefined && food !== 'none' && food !== 'model')
    return fail('--food: model або none.');
  const natures = parsed.values.natures?.split(',').filter((n) => n !== '') as
    NatureId[] | undefined;
  const natureIds = content.natures.map((n) => n.id);
  if (natures?.some((n) => !natureIds.includes(n))) {
    return fail(`--natures: природи з ${natureIds.join(', ')}.`);
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
    content,
    rules: env.rules,
    entries,
    runs,
    seed,
    ...(level === undefined ? {} : { level }),
    ...(natures ? { natures } : {}),
    ...(rank ? { rank } : {}),
    ...(pouch ? { pouch } : {}),
    ...(food ? { food } : {}),
  });
  const clamped = rows.find((r) => r.requestedLevel !== r.level);
  const err = clamped
    ? [`Рівень ${clamped.requestedLevel} обрізано до стелі навичок: ${clamped.level}.`]
    : [];
  if (parsed.flags.has('json')) {
    return { code: 0, err, out: [JSON.stringify(rows.map(rowJson), null, 2)] };
  }
  if (parsed.flags.has('all')) {
    const bad = rows.filter((r) => r.flagged).length;
    return {
      code: 0,
      err,
      out: [
        `Мірило на рекомендованому рівні кожного запису; боїв на рядок: ${runs}, сід ${seed}. ${YARDSTICK}`,
        `Підсумок: ${pouch ?? 'none'} (відношення до моделі рахується на ньому); колонки «+підс.» — ті самі бої з інструментами магазину. Страви: ${food ?? 'model для босів, none для звичайних ворогів'} (колонка «їжа»).`,
        'Перем. — частка перемог і втеч; HP% — середній залишок HP у виграних боях; «мод.с» — час убивства за спрощеною моделлю для того самого мірила; «відн.» — середній час виграних боїв рушія / модель (в дужках, коли виграних менше п’яти).',
        `Модель не враховує: ${MODEL_IGNORES.join('; ')}.`,
        ...fightTable(rows),
        `Позначено «!»: ${bad} з ${rows.length}. Пороги: відношення ${REPORT.ratioBand[0]}–${REPORT.ratioBand[1]}; перемоги ≥ ${REPORT.enemyMinWin * 100}% для ворога, ${REPORT.bossWinBand[0] * 100}–${REPORT.bossWinBand[1] * 100}% для боса (звітні, не баланс).`,
      ],
    };
  }
  return { code: 0, err, out: rows.flatMap(fightDetail) };
}

/** `pnpm sim crafts`: how a gathering and crafting player progresses and earns. */
export function runCraftsCli(args: string[], env: Environment): CliResult {
  ukLocale = env.content.locales.uk;
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
  const report = craftsReport({ seed, hours, content: env.content, rules: env.rules });
  if (parsed.flags.has('json')) return { code: 0, err: [], out: [JSON.stringify(report, null, 2)] };
  const out = [
    `Бот: crafts, сід ${seed}, ігрових годин ${hours}`,
    `${pad('год', 4)} ${report.skills.map((s) => padL(skillName(s), 11)).join(' ')} ${padL('продано', 8)} ${padL('витрачено', 10)} ${padL('чисто', 7)} ${padL('зварено', 8)} ${padL('зібрано', 8)} ${padL('простій', 8)}`,
    ...report.rows.map(
      (r) =>
        `${pad(r.hour, 4)} ${report.skills.map((s) => padL(r.levels[s] ?? 1, 11)).join(' ')} ${padL(r.ryoSold, 8)} ${padL(r.ryoSpent, 10)} ${padL(r.ryoNet, 7)} ${padL(r.crafted, 8)} ${padL(r.gathered, 8)} ${padL(pct(r.idle), 8)}`,
    ),
    `Разом: продано на ${report.totals.ryoSold} рьо, витрачено ${report.totals.ryoSpent}, чисто ${report.totals.ryoNet}, зварено ${report.totals.crafted}, зібрано ${report.totals.gathered}, простій ${pct(report.totals.idle)}`,
  ];
  const err =
    report.rejected > 0
      ? [
          `Бот надсилав відхилені команди: ${report.rejected} (перша причина: ${report.firstRejection ?? '?'}).`,
        ]
      : [];
  return { code: 0, out, err };
}

/** `pnpm sim fighter`: how a fighting player progresses over game hours. */
export function runFighterCli(args: string[], env: Environment): CliResult {
  ukLocale = env.content.locales.uk;
  const parsed = parseArgs(args, ['seed', 'hours'], ['json', 'help']);
  if (parsed.flags.has('help')) return { code: 0, out: FIGHTER_HELP, err: [] };
  if (parsed.errors.length > 0) {
    return { code: 1, out: [], err: [...parsed.errors, 'Довідка: pnpm sim fighter --help'] };
  }
  const seed = wholeValue(parsed, 'seed', 1);
  const hours = wholeValue(parsed, 'hours', 3);
  if (seed === null || hours === null) {
    return { code: 1, out: [], err: ['--seed і --hours мають бути цілими числами від 1.'] };
  }
  const report = fighterReport({ seed, hours, content: env.content, rules: env.rules });
  if (parsed.flags.has('json')) return { code: 0, err: [], out: [JSON.stringify(report, null, 2)] };
  const out = [
    `Бот: fighter, сід ${seed}, ігрових годин ${hours}`,
    `${pad('год', 4)} ${pad('зона наприкінці', 24)} ${padL('перемог', 8)} ${padL('поразок', 8)} ${padL('рьо', 7)} ${padL('підсумок', 9)} ${padL('Рани', 5)}  досвід бою`,
    ...report.rows.map(
      (r) =>
        `${pad(r.hour, 4)} ${pad((r.action ?? '—').replace(/^core:/, ''), 24)} ${padL(r.kills, 8)} ${padL(r.defeats, 8)} ${padL(r.ryo, 7)} ${padL(r.ryoSpent, 9)} ${padL(r.wounds, 5)}  ` +
        Object.entries(r.combatXp)
          .sort((a, b) => b[1] - a[1])
          .map(([id, xp]) => `${skillName(id)} ${xp}`)
          .join(', '),
    ),
  ];
  const err =
    report.rejected > 0
      ? [
          `Бот надсилав відхилені команди: ${report.rejected} (перша причина: ${report.firstRejection ?? '?'}).`,
        ]
      : [];
  return { code: 0, out, err };
}
