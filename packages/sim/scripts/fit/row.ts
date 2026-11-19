/* eslint-disable @typescript-eslint/no-explicit-any */
import { content } from '@shinobi/content';
import { allEntries, fightRow } from '../../src/fightReport.ts';
const ids = process.argv.slice(2);
for (const e of allEntries(content).filter((x) => ids.includes(x.id.replace('core:', '')))) {
  const row: any = fightRow(e, { entries: [], runs: 30, seed: 1, comparePouch: false } as any);
  console.log(e.id, row.loadout, JSON.stringify(row.stats.damageShare), row.stats.timeSec?.mean);
}
