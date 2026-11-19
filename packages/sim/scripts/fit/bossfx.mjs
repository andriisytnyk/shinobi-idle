/* Sets heavyCast hp/dmg in balance-ext.ts, re-imports, and runs the boss/analysis guards for the hunter. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const [hp, dmg, filter = 'hunter|first fight|favourable'] = process.argv.slice(2);
const p = 'packages/content/src/packs/core/balance-ext.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/(heavyCast: \{[^}]*?hp: )[0-9.]+(, dmg: )[0-9.]+/, `$1${hp}$2${dmg}`);
fs.writeFileSync(p, s);
execSync('pnpm content:import', { stdio: 'ignore' });
try {
  const out = execSync(
    `pnpm exec vitest run test/bosses.test.ts test/analysis.test.ts -t "${filter}"`,
    { cwd: 'packages/core', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  console.log(hp, dmg, out.split('\n').filter((l) => /Tests /.test(l)).join(''));
} catch (e) {
  const out = String(e.stdout) + String(e.stderr);
  console.log(
    hp,
    dmg,
    out
      .split('\n')
      .filter((l) => /→|Tests /.test(l))
      .join('\n'),
  );
}
