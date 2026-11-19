/**
 * Writes `docs/balance-evidence/fit-table.md`: for each yardstick and entry the baseline of 3f559af against the
 * recorded fit (win rate, mean time, share of the plain strike) and which bands the row meets.
 * Run after `scripts/fit-record.ts`: `pnpm --filter @shinobi/sim exec tsx scripts/fit/table.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { targetsMet, YARDSTICKS } from '../fit-record.ts';

const DIR = new URL('../../../../docs/balance-evidence/', import.meta.url);
interface Row {
  enemy: string;
  loadout: string[];
  winRate: number;
  timeSec: { mean: number } | null;
  damageShare: Record<string, number>;
}
const read = (name: string): Row[] => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as Row[];
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const out: string[] = [
  '# Підгонка циклу v2: було (dev, 3f559af) і стало',
  '',
  'Смуги: час бою ±20% від бази (мірило C: ±25%); звичайний ворог виграється щонайменше в 97% (C: 95%); звичайний удар ≤ 40% шкоди при повному наборі. Боси ґатуються окремо (`fit.test.ts`, `boss-defence.md`). ✓ — смуга виконана, ✗ — ні.',
  '',
];
const totals: string[] = [];
for (const [name] of YARDSTICKS) {
  const base = read(`baseline-dev-3f559af-${name}.json`);
  const now = read(`fit-after-${name}.json`);
  out.push(
    `## Мірило ${name}`,
    '',
    '| Запис | Перемоги (було → стало) | Час, с (було → стало) | × | Удар | Час | Перемоги | Удар |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  let all = 0;
  for (const r of now) {
    const b = base.find((x) => x.enemy === r.enemy) as Row;
    const m = targetsMet(b, r, name);
    if (m.time && m.win && m.basic) all++;
    const ratio = b.timeSec && r.timeSec ? (r.timeSec.mean / b.timeSec.mean).toFixed(2) : '-';
    out.push(
      `| ${r.enemy.replace('core:', '')} | ${pct(b.winRate)} → ${pct(r.winRate)} | ${b.timeSec?.mean.toFixed(1) ?? '-'} → ${r.timeSec?.mean.toFixed(1) ?? '-'} | ${ratio} | ${pct(r.damageShare.basic ?? 0)} | ${m.time ? '✓' : '✗'} | ${m.win ? '✓' : '✗'} | ${m.basic ? '✓' : '✗'} |`,
    );
  }
  out.push('');
  totals.push(`${name}: ${all} з ${now.length}`);
}
out.splice(3, 0, `Рядків, що виконують усі смуги: ${totals.join('; ')}.`, '');
writeFileSync(new URL('fit-table.md', DIR), out.join('\n') + '\n');
console.log(totals.join('; '));
