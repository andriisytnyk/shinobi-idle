/** Dumps the numbers the fit touches, with the knobs of a JSON file applied (or none): used to check that `apply.mjs` reproduces what the optimiser scored. */
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { apply, DEFAULTS } from './fit.ts';

const file = process.argv[2];
if (file && file !== '-') apply({ ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) });
const out = {
  K: content.balance.K,
  cast: Object.fromEntries(content.techniques.map((t) => [t.id, t.cast])),
  tiers: content.ai.tiers.map((t) => [t.id, t.waitMs]),
};
writeFileSync(process.argv[3] ?? 'dump.json', JSON.stringify(out, null, 1));
