/**
 * The fit of the fight loop v2 to the balance of dev at 3f559af, kept as a test. The yardstick characters fight every
 * enemy and boss entry (pnpm sim fight --all --seed 1 --runs 200). The result must equal the committed table, and
 * every band a row met when the table was recorded (fit-status.json: fight time within 20% of the baseline (C: 25%),
 * a regular enemy won at least 97% of the time (C: 95%), the plain strike at most 40% of a full hand's damage) must
 * still be met. The hit chances of a typical character against a regular enemy of its level stay within 5 points of the
 * baseline curves at every level. A change that moves the fights re-records the table knowingly (scripts/fit-record.ts, then
 * scripts/fit/table.ts); the rows that miss a band are listed in docs/balance-evidence/fit-table.md.
 */
import { readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { allEntries, fightRow, rowJson } from '../src/fightReport.ts';
import { targetsMet, YARDSTICKS } from '../scripts/fit-record.ts';
import { curves } from '../scripts/hit-curves.ts';

const DIR = new URL('../../../docs/balance-evidence/', import.meta.url);
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T;

interface Row {
  enemy: string;
  loadout: string[];
  winRate: number;
  timeSec: { mean: number } | null;
  damageShare: Record<string, number>;
}
type Status = Record<string, Record<string, { time: boolean; win: boolean; basic: boolean }>>;

const status = read<Status>('fit-status.json');

describe.each(YARDSTICKS)('yardstick %s', (name, options) => {
  const baseline = read<Row[]>(`baseline-dev-3f559af-${name}.json`);
  const recorded = read<Row[]>(`fit-after-${name}.json`);
  const now = allEntries(content).map(
    (e) =>
      rowJson(
        fightRow(e, { entries: [], runs: 200, seed: 1, comparePouch: false, ...options } as never),
      ) as Row,
  );

  it('is the table that was recorded', () => {
    expect(now.map((r) => r.enemy)).toEqual(recorded.map((r) => r.enemy));
    for (const r of recorded) {
      const n = now.find((x) => x.enemy === r.enemy);
      expect(n?.winRate, `${r.enemy} win rate`).toBeCloseTo(r.winRate, 3);
      expect(n?.timeSec?.mean ?? 0, `${r.enemy} time`).toBeCloseTo(r.timeSec?.mean ?? 0, 1);
    }
  });

  it('still meets every target that it met when it was recorded', () => {
    for (const r of recorded) {
      const b = baseline.find((x) => x.enemy === r.enemy) as Row;
      const n = now.find((x) => x.enemy === r.enemy) as Row;
      const met = targetsMet(b, n, name);
      const was = status[name]?.[r.enemy];
      for (const target of ['time', 'win', 'basic'] as const) {
        if (was?.[target]) expect(met[target], `${r.enemy} ${target}`).toBe(true);
      }
    }
  });

  it('keeps the fit it was recorded with: most rows meet the time and win targets', () => {
    const rows = Object.values(status[name] ?? {});
    expect(rows.length).toBe(baseline.length);
    expect(rows.filter((r) => r.win).length).toBeGreaterThan(rows.length * 0.7);
  });
});

describe('hit chances of a typical character against a regular enemy of its level', () => {
  const points = curves();

  it('stay within 5 points of what dev at 3f559af gave, at every level', () => {
    for (const p of points) {
      expect(
        Math.abs(p.enemyHits.typical - p.baseline.enemyHits),
        'enemy, level ' + p.level,
      ).toBeLessThanOrEqual(0.05);
      expect(
        Math.abs(p.playerHits - p.baseline.playerHits),
        'player, level ' + p.level,
      ).toBeLessThanOrEqual(0.05);
    }
  });

  it('are worse for one who neglects the defensive techniques and clearly better for one who maxes them', () => {
    for (const p of points) {
      expect(p.enemyHits.neglect, 'level ' + p.level).toBeGreaterThanOrEqual(p.enemyHits.typical);
      if (p.level >= 8)
        expect(p.enemyHits.max, 'level ' + p.level).toBeLessThanOrEqual(p.enemyHits.typical - 0.1);
    }
  });
});
