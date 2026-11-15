/**
 * `pnpm typecheck:open`: type-checks core, sim and the web app against the TRUTHFUL types of
 * @shinobi/content (ids are `string`, records keyed by vocabulary members are `Record<string, T>`)
 * and fails only on diagnostics inside the folders listed in `open-typecheck.json`. For every other
 * folder it prints how many errors remain, as information: that is the work of the migration.
 *
 * Compilers: `tsc -p tsconfig.truth.json` for packages/core and packages/sim (src and test) and
 * `svelte-check --tsconfig tsconfig.truth.json --output machine` for apps/web (svelte-check cannot
 * be filtered by folder, so its output is filtered here).
 *
 * Run with Node 24 (type stripping): `node scripts/typecheck-open.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countByFolder,
  dedupe,
  entryPath,
  judge,
  type MigratedEntry,
  parseSvelteCheck,
  parseTsc,
  type Diagnostic,
} from './open-typecheck-lib.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { name: 'packages/core', dir: 'packages/core', compiler: 'tsc' },
  { name: 'packages/sim', dir: 'packages/sim', compiler: 'tsc' },
  { name: 'apps/web', dir: 'apps/web', compiler: 'svelte-check' },
] as const;

function run(target: (typeof targets)[number]): Diagnostic[] {
  const cwd = resolve(root, target.dir);
  const args =
    target.compiler === 'tsc'
      ? ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.truth.json']
      : ['exec', 'svelte-check', '--tsconfig', './tsconfig.truth.json', '--output', 'machine'];
  const result = spawnSync(`pnpm ${args.join(' ')}`, {
    cwd,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 1 << 28,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const diagnostics =
    target.compiler === 'tsc' ? parseTsc(output, cwd, root) : parseSvelteCheck(output, cwd, root);
  if (diagnostics.length === 0 && result.status !== 0 && !/COMPLETED/.test(output)) {
    console.error(`${target.name}: the compiler failed without a diagnostic:\n${output}`);
    process.exit(2);
  }
  return diagnostics;
}

const config = JSON.parse(readFileSync(resolve(root, 'open-typecheck.json'), 'utf8')) as {
  migrated: MigratedEntry[];
};
const migrated = config.migrated;

const all: Diagnostic[] = [];
for (const target of targets) {
  const diagnostics = run(target);
  all.push(...diagnostics);
  console.log(`${target.name}: ${diagnostics.length} error(s) against the truthful types`);
  for (const [folder, count] of countByFolder(diagnostics)) console.log(`  ${count}\t${folder}`);
}

const unique = dedupe(all);
console.log(
  `total (without duplicates): ${unique.length} error(s) in ${countByFolder(unique).length} folder(s)`,
);
console.log(
  `migrated: ${migrated.length === 0 ? 'none yet' : migrated.map((m) => (typeof m === 'string' ? m : `${entryPath(m)} (without ${(m.exclude ?? []).join(', ')})`)).join('; ')}`,
);

const verdict = judge(
  unique,
  migrated,
  existsSync(resolve(root, 'tsconfig.legacy-ids.json')),
  (folder) => existsSync(resolve(root, folder)),
);
if (!verdict.ok) {
  for (const message of verdict.messages) console.error(`typecheck:open: ${message}`);
  process.exit(1);
}
console.log('typecheck:open: ok');
