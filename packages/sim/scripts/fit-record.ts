/**
 * Records the three yardstick tables the fit test holds the game to (`docs/balance-evidence/fit-after-{A,B,C}.json`)
 * and which target each row meets (`fit-status.json`): a row that meets a target must keep meeting it.
 * Run it on purpose, when a change to the fights is meant: `pnpm --filter @shinobi/sim exec tsx scripts/fit-record.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { allEntries, fightRow, rowJson } from '../src/fightReport.ts';

const DIR = new URL('../../../docs/balance-evidence/', import.meta.url);
export const YARDSTICKS: [string, Record<string, unknown>][] = [
  ['A', {}],
  ['B', { natures: ['katon', 'futon', 'raiton', 'doton', 'suiton'] }],
  ['C', { rank: 'chunin', pouch: 'shop', food: 'model' }],
  ['D', { rank: 'genin' }],
];

interface Row {
  enemy: string;
  loadout: string[];
  winRate: number;
  timeSec: { mean: number } | null;
  damageShare: Record<string, number>;
}

/** The targets a row meets against the baseline: fight time within 10%, win rate within 3 points, the plain strike at most 40% of a full hand's damage. */
export function targetsMet(base: Row, row: Row): { time: boolean; win: boolean; basic: boolean } {
  const time =
    base.timeSec && row.timeSec
      ? Math.abs(row.timeSec.mean / base.timeSec.mean - 1) <= 0.1
      : Boolean(base.timeSec) === Boolean(row.timeSec);
  return {
    time,
    win: Math.abs(row.winRate - base.winRate) <= 0.03,
    basic: row.loadout.length < 4 || (row.damageShare.basic ?? 0) <= 0.4,
  };
}

if (process.argv[1]?.endsWith('fit-record.ts')) {
  const status: Record<
    string,
    Record<string, { time: boolean; win: boolean; basic: boolean }>
  > = {};
  for (const [name, options] of YARDSTICKS) {
    const rows = allEntries(content).map(
      (e) => rowJson(fightRow(e, { entries: [], runs: 200, seed: 1, ...options } as never)) as Row,
    );
    writeFileSync(new URL(`fit-after-${name}.json`, DIR), JSON.stringify(rows, null, 2) + '\n');
    const base = JSON.parse(
      readFileSync(new URL(`baseline-dev-3f559af-${name}.json`, DIR), 'utf8'),
    ) as Row[];
    status[name] = Object.fromEntries(
      rows.map((r) => [r.enemy, targetsMet(base.find((b) => b.enemy === r.enemy) as Row, r)]),
    );
  }
  writeFileSync(new URL('fit-status.json', DIR), JSON.stringify(status, null, 2) + '\n');
}
