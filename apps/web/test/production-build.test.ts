import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/*
 * T4 (the production side). The production bundle never contains the test packs: the code that
 * loads them sits behind `import.meta.env.DEV`, which the build replaces with `false`. The test
 * builds the app the way `pnpm build` does, into a temporary folder, and reads what came out.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('the production bundle (T4)', () => {
  it('contains no test pack, no test UI pack and no `testmod` string', async () => {
    const out = mkdtempSync(join(tmpdir(), 'shinobi-dist-'));
    // Vitest sets NODE_ENV=test; the build must see what `pnpm build` sees.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await build({
        root,
        mode: 'production',
        logLevel: 'silent',
        build: { outDir: out, emptyOutDir: true, reportCompressedSize: false },
      });
      const files = walk(out).filter((f) => /\.(js|css|html|json|webmanifest)$/.test(f));
      expect(files.some((f) => f.endsWith('.js'))).toBe(true);
      const offenders = files.filter((f) => /testmod/i.test(readFileSync(f, 'utf8')));
      expect(offenders.map((f) => f.slice(out.length))).toEqual([]);
    } finally {
      process.env.NODE_ENV = nodeEnv;
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
