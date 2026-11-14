import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// Hex, rgb(a), hsl(a), hwb, lab, lch, oklab and oklch literals; CSS variables are the only way to colour.
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;

describe('colours', () => {
  const files = walk(src).filter((f) => /\.(svelte|css|ts)$/.test(f));

  it('finds the sources to check', () => {
    expect(files.some((f) => f.endsWith('App.svelte'))).toBe(true);
  });

  for (const file of files) {
    const name = relative(src, file).replaceAll('\\', '/');
    // Tokens (and the generated font ranges) are the only files allowed to hold literals.
    if (name === 'tokens.css' || name === 'fonts.css') continue;
    it(`${name} uses no raw colour literals`, () => {
      const text = readFileSync(file, 'utf8');
      // Ignore URL fragments such as #/skill/tai in route strings.
      const cleaned = text.replace(/#\/[A-Za-z0-9/_:-]*/g, '');
      expect(RAW_COLOR.exec(cleaned)?.[0]).toBeUndefined();
    });
  }
});
