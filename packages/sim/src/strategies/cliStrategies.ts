import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { content as builtIn } from '@shinobi/content';
import { parseArgs, wholeValue } from '../args.ts';
import type { CliResult } from '../commands.ts';
import { naturesTriples } from './matrix.ts';
import { runMatrix, type MatrixResult } from './runMatrix.ts';
import { STRATEGY_IDS, type StrategyId } from './strategies.ts';
import { strategyReportJson, strategyReportMarkdown } from './strategyReport.ts';

/** Where the report is written unless `--out` says otherwise: the repository's `docs/balance-evidence`. */
const DEFAULT_OUT = fileURLToPath(new URL('../../../../docs/balance-evidence/', import.meta.url));
const REPORT = 'strategy-bots';

const USAGE = [
  'pnpm sim strategies [--seeds N] [--hours H] [--out папка] [--workers K] [--strategies a,b] [--triples N]',
  `  стратегії: ${STRATEGY_IDS.join(', ')}`,
  '  --seeds N      сіди 1..N (3 за замовчуванням)',
  '  --hours H      ігрових годин на прогін (48 за замовчуванням)',
  `  --out папка    куди писати ${REPORT}.md і ${REPORT}.json (docs/balance-evidence)`,
  '  --workers K    потоків (за замовчуванням за кількістю ядер; 1 — в одному потоці); результат не залежить від K',
  '  --strategies   лише ці стратегії; --triples N — лише перші N трійок природ',
];

/** `pnpm sim strategies`: plays the strategy bots on every triple of natures and writes the balance report. */
export async function runStrategiesCli(args: string[]): Promise<CliResult> {
  const parsed = parseArgs(
    args,
    ['seeds', 'hours', 'out', 'workers', 'strategies', 'triples'],
    ['help'],
  );
  if (parsed.flags.has('help')) return { code: 0, out: USAGE, err: [] };
  const seeds = wholeValue(parsed, 'seeds', 3);
  const hours = wholeValue(parsed, 'hours', 48);
  const workers = wholeValue(
    parsed,
    'workers',
    Math.max(1, Math.min(22, availableParallelism() - 2)),
  );
  const tripleCount = wholeValue(parsed, 'triples', Infinity);
  const picked = (parsed.values.strategies ?? '').split(',').filter((s) => s !== '');
  const unknown = picked.filter((s) => !STRATEGY_IDS.includes(s as StrategyId));
  if (
    parsed.errors.length > 0 ||
    seeds === null ||
    hours === null ||
    workers === null ||
    tripleCount === null ||
    unknown.length > 0
  ) {
    return {
      code: 1,
      out: [],
      err: [...parsed.errors, ...unknown.map((s) => `Невідома стратегія «${s}».`), ...USAGE],
    };
  }
  const started = Date.now();
  const triples = naturesTriples(builtIn).slice(0, tripleCount);
  const result: MatrixResult = await runMatrix({
    seeds,
    hours,
    workers,
    triples,
    ...(picked.length > 0 ? { strategies: picked as StrategyId[] } : {}),
  });
  const dir = parsed.values.out ?? DEFAULT_OUT;
  mkdirSync(dir, { recursive: true });
  const md = `${dir.replace(/[\\/]+$/, '')}/${REPORT}.md`;
  const json = `${dir.replace(/[\\/]+$/, '')}/${REPORT}.json`;
  // A note of what changed and why, kept beside the report, goes on top of it.
  const notesFile = `${dir.replace(/[\\/]+$/, '')}/${REPORT}-notes.md`;
  const notes = existsSync(notesFile) ? `${readFileSync(notesFile, 'utf8').trimEnd()}\n\n` : '';
  writeFileSync(md, `${notes}${strategyReportMarkdown(result, builtIn)}\n`);
  writeFileSync(json, `${strategyReportJson(result)}\n`);
  const runs = result.rows.reduce((n, r) => n + r.runs.length, 0);
  return {
    code: 0,
    out: [`Прогонів: ${runs} по ${hours} ігрових годин.`, `Звіт: ${md}`, `Дані: ${json}`],
    err: [`Час виконання: ${((Date.now() - started) / 1000).toFixed(1)} с на ${workers} потоках.`],
  };
}
