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

/**
 * Sizes, spacing, radii, border widths and fonts come from the tokens, so that a theme can change
 * them. A literal length is allowed only as: zero (any unit), a 1px hairline, and the breakpoints
 * of `@media` and `@container` conditions, which CSS cannot take from a variable. Percentages,
 * `fr`, `vw`, `dvh` and the like are relative and are not lengths in this sense.
 */
const LENGTH = /(?<![\w-])(-?\d*\.?\d+)(px|rem|em)\b/g;

/** Files that still hold literals: owned by a task that is under way. Remove an entry when it is converted. */
const PENDING = new Set(['components/ToastHost.svelte']);

/** The CSS of a file: the `<style>` blocks of a component, or the whole stylesheet. */
function cssOf(file: string, text: string): string {
  const css = file.endsWith('.css')
    ? text
    : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The offending literals of a piece of CSS. */
export function rawLengths(css: string): string[] {
  const found: string[] = [];
  for (const line of css.split('\n')) {
    if (/^\s*@(media|container|supports)\b/.test(line)) continue;
    for (const m of line.matchAll(LENGTH)) {
      const n = Number(m[1]);
      if (n === 0 || (n === 1 && m[2] === 'px')) continue;
      found.push(`${m[0]} in "${line.trim()}"`);
    }
  }
  return found;
}

describe('lengths', () => {
  it('finds literals and allows the exceptions', () => {
    expect(rawLengths('a { padding: 0.5rem; margin: 0; border: 1px solid; width: 50%; }')).toEqual([
      '0.5rem in "a { padding: 0.5rem; margin: 0; border: 1px solid; width: 50%; }"',
    ]);
    expect(rawLengths('@media (max-width: 768px) {')).toEqual([]);
    expect(rawLengths('x { gap: var(--space-2); grid-template-columns: 1fr 2fr; }')).toEqual([]);
    expect(rawLengths('x { height: 2px; }')).toHaveLength(1);
  });

  for (const file of walk(src).filter((f) => /\.(svelte|css)$/.test(f))) {
    const name = relative(src, file).replaceAll('\\', '/');
    if (name === 'tokens.css' || name === 'fonts.css' || PENDING.has(name)) continue;
    it(`${name} uses no raw length literals`, () => {
      expect(rawLengths(cssOf(file, readFileSync(file, 'utf8')))).toEqual([]);
    });
  }
});
