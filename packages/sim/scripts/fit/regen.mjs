/* Applies knob multipliers (JSON in argv[2], relative to the numbers now in the docs) and regenerates the content. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const dir = new URL('.', import.meta.url);
const best = new URL('opt-best.json', dir);
const identity = fs.readFileSync(best, 'utf8');
const knobs = { ...JSON.parse(identity), ...JSON.parse(process.argv[2] ?? '{}') };
fs.writeFileSync(best, JSON.stringify(knobs));
try {
  execSync('node packages/sim/scripts/fit/apply.mjs', { stdio: 'inherit' });
} finally {
  fs.writeFileSync(best, identity);
}
execSync('node balance.mjs', {
  cwd: 'docs/Shinobi Idle — MVP — зріз і баланс',
  stdio: 'ignore',
});
execSync('pnpm content:import', { stdio: 'inherit' });
execSync('pnpm exec prettier --write packages/content/src/packs/core/data/hand/ai.json', {
  stdio: 'ignore',
});
