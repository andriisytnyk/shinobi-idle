import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/*
 * T4 (the production side). The production bundle never contains the test packs: the code that
 * loads them sits behind `import.meta.env.DEV`, which the build replaces with `false`. The same
 * goes for the developer panel (D1): its code sits behind `__DEV_PANEL__`, which only a test
 * build sets. The tests build the app the way `pnpm build` does, into a temporary folder, and
 * read what came out.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Builds in mode `production` (`pnpm build`) or `test` (`pnpm build:test`) and reads the output. */
async function bundle(mode: 'production' | 'test'): Promise<{ name: string; text: string }[]> {
  const out = mkdtempSync(join(tmpdir(), 'shinobi-dist-'));
  // Vitest sets NODE_ENV=test; the build must see what `pnpm build` sees. A stray flag in the
  // environment must not decide the production build either.
  const nodeEnv = process.env.NODE_ENV;
  const flag = process.env.VITE_DEV_PANEL;
  process.env.NODE_ENV = 'production';
  delete process.env.VITE_DEV_PANEL;
  try {
    await build({
      root,
      mode,
      logLevel: 'silent',
      build: { outDir: out, emptyOutDir: true, reportCompressedSize: false },
    });
    return walk(out)
      .filter((f) => /\.(js|css|html|json|webmanifest)$/.test(f))
      .map((f) => ({ name: f.slice(out.length), text: readFileSync(f, 'utf8') }));
  } finally {
    process.env.NODE_ENV = nodeEnv;
    if (flag !== undefined) process.env.VITE_DEV_PANEL = flag;
    rmSync(out, { recursive: true, force: true });
  }
}

/** What only the developer panel carries: its title, the markers of its markup, its command names, its refusals. */
const PANEL_MARKS = [
  'Панель розробника',
  'data-dev-open',
  'data-dev-panel',
  'time.advance',
  'skill.setLevel',
  'map.teleport',
  'raid.spawn',
  'dev.err.',
  'DevPanel',
  // The panel's hooks into the game and the console: gated by the flag, so tree-shaken away too.
  '__shinobi',
  'devApply',
  'devSpeed',
  'clone.setLife',
  'dev.cloneCreate',
];

describe('the production bundle (T4)', () => {
  it('contains no test pack, no test UI pack and no `testmod` string', async () => {
    const files = await bundle('production');
    expect(files.some((f) => f.name.endsWith('.js'))).toBe(true);
    const offenders = files.filter((f) => /testmod/i.test(f.text));
    expect(offenders.map((f) => f.name)).toEqual([]);
  }, 180_000);

  it('contains none of the developer panel: no code, no module, no text, no fixture save', async () => {
    const files = await bundle('production');
    const found = files.flatMap((f) =>
      PANEL_MARKS.filter((mark) => f.text.includes(mark)).map((mark) => `${f.name}: ${mark}`),
    );
    expect(found).toEqual([]);
    // The fixture saves are read only by the panel's own module, so they are gone with it.
    expect(files.some((f) => /\\"savedAt\\":0/.test(f.text))).toBe(false);
  }, 180_000);

  it('does contain the panel in a test build, so that the check above can fail', async () => {
    const files = await bundle('test');
    const text = files.map((f) => f.text).join('\n');
    for (const mark of ['Панель розробника', 'data-dev-open', 'time.advance'])
      expect(text, mark).toContain(mark);
  }, 180_000);
});
