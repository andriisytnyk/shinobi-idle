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
 * them. A literal length is allowed only as: zero (any unit), a 1px hairline, one full viewport
 * (`100vw`), the breakpoints of `@media` and `@container` conditions (CSS cannot take those from a
 * variable), and the value of a private custom property `--_name`, which is one component's own
 * business. Percentages and `fr` are relative and are not lengths in this sense.
 */
const LENGTH = /(?<![\w-])(-?\d*\.?\d+)(rem|em|px|ch|pt|vh|vw|vmin|vmax)\b/g;

/** The offending literals of a piece of CSS. */
export function rawLengths(css: string): string[] {
  const found: string[] = [];
  for (const line of css.split('\n')) {
    if (/^\s*@(media|container|supports)\b/.test(line)) continue;
    // `--_name: 0.6rem;` is a private custom property.
    if (/^\s*--_[a-z0-9-]+\s*:/.test(line)) continue;
    for (const m of line.matchAll(LENGTH)) {
      const n = Number(m[1]);
      if (n === 0 || (n === 1 && m[2] === 'px')) continue;
      if (n === 100 && /^v(w|h|min|max)$/.test(m[2] ?? '')) continue;
      found.push(`${m[0]} in "${line.trim()}"`);
    }
  }
  return found;
}

/** The CSS of a file: the `<style>` blocks of a component, or the whole stylesheet. */
function cssOf(file: string, text: string): string {
  const css = file.endsWith('.css')
    ? text
    : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Inline `style="…"` attributes and `style:prop` directives of a component, outside its `<style>` block. */
function inlineStyles(text: string): string {
  const markup = text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  return [...markup.matchAll(/\bstyle(?::[\w-]+)?\s*=\s*("[^"]*"|'[^']*')/g)]
    .map((m) => m[1])
    .join('\n');
}

describe('lengths', () => {
  it('finds literals and allows the exceptions', () => {
    expect(rawLengths('a { padding: 0.5rem; margin: 0; border: 1px solid; width: 50%; }')).toEqual([
      '0.5rem in "a { padding: 0.5rem; margin: 0; border: 1px solid; width: 50%; }"',
    ]);
    expect(rawLengths('@media (max-width: 768px) {')).toEqual([]);
    expect(rawLengths('x { gap: var(--space-2); grid-template-columns: 1fr 2fr; }')).toEqual([]);
    expect(rawLengths('x { height: 2px; }')).toHaveLength(1);
    // Private custom properties may hold literals; their users may not.
    expect(rawLengths('  --_dot: 0.6rem;\n  width: var(--_dot);')).toEqual([]);
    expect(rawLengths('  width: 20ch;')).toHaveLength(1);
    expect(rawLengths('  height: 50vh;')).toHaveLength(1);
    expect(rawLengths('  font-size: 12pt;')).toHaveLength(1);
    expect(rawLengths('  width: min(10vmin, 100vw);')).toHaveLength(1);
    expect(rawLengths('  width: 3vmax;')).toHaveLength(1);
    expect(rawLengths('width: 12.5px')).toHaveLength(1);
  });

  it('finds literals in inline styles', () => {
    expect(inlineStyles('<div style="width: 12px" style:height="3rem" class="a"></div>')).toContain(
      '12px',
    );
    expect(
      rawLengths(inlineStyles('<i style:width="{size}px" style="top: 4px"></i>')),
    ).toHaveLength(1);
  });

  for (const file of walk(src).filter((f) => /\.(svelte|css)$/.test(f))) {
    const name = relative(src, file).replaceAll('\\', '/');
    if (name === 'tokens.css' || name === 'fonts.css') continue;
    const text = readFileSync(file, 'utf8');
    it(`${name} uses no raw length literals`, () => {
      expect(rawLengths(cssOf(file, text))).toEqual([]);
    });
    if (file.endsWith('.svelte')) {
      it(`${name} has no raw lengths in inline styles`, () => {
        expect(rawLengths(inlineStyles(text))).toEqual([]);
      });
    }
  }
});

describe('the token contract', () => {
  const tokens = readFileSync(join(src, 'tokens.css'), 'utf8');
  const defined = new Set([...tokens.matchAll(/^\s+(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1] ?? ''));

  it('defines every public token a component uses, or declares it locally', () => {
    const missing: string[] = [];
    for (const file of walk(src).filter((f) => /\.(svelte|css)$/.test(f))) {
      const name = relative(src, file).replaceAll('\\', '/');
      if (name === 'tokens.css' || name === 'fonts.css') continue;
      const text = readFileSync(file, 'utf8');
      const locals = new Set([...text.matchAll(/(--[a-z0-9-]+)\s*[:=]/g)].map((m) => m[1] ?? ''));
      for (const m of cssOf(file, text).matchAll(/var\((--[a-z0-9-]+)/g)) {
        const token = m[1] ?? '';
        if (!defined.has(token) && !locals.has(token)) missing.push(`${name}: ${token}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the size and length tokens to a scale of at most 60', () => {
    const sizeTokens = [...defined].filter((t) =>
      /^--(space|text|leading|tracking|radius|border|focus|control|icon|bar|tile|card|panel|modal|toast|measure|sidebar|meta|topbar|tabbar|now)-/.test(
        t,
      ),
    );
    expect(sizeTokens.length).toBeLessThanOrEqual(60);
    // Names follow roles, not values.
    expect(sizeTokens.filter((t) => /\d-\d|-\d+rem|-\d+px/.test(t))).toEqual([]);
  });

  it('every control height follows the control scale: a theme that changes it changes them all', () => {
    // Each pair is a component and the rule that sizes its buttons, fields, selects or nav items.
    const roles: [file: string, rule: RegExp][] = [
      ['pages/SettingsPage.svelte', /\n {2}button \{[^}]*min-height: var\(--control-md\)/],
      ['pages/SettingsPage.svelte', /\.typed input \{[^}]*min-height: var\(--control-md\)/],
      ['pages/SettingsPage.svelte', /\.select select \{[^}]*min-height: var\(--control-md\)/],
      ['components/ToastHost.svelte', /button\.action \{[^}]*min-height: var\(--control-md\)/],
      ['components/MainNav.svelte', /\n {2}a \{[^}]*min-height: var\(--control-sm\)/],
      ['components/PwaPanel.svelte', /button \{[^}]*min-height: var\(--control-md\)/],
      ['components/Stepper.svelte', /min-height: var\(--control-md\)/],
    ];
    for (const [file, rule] of roles) {
      expect(readFileSync(join(src, file), 'utf8'), `${file} ${rule}`).toMatch(rule);
    }
    // And nothing sizes a control by another route: a min-height is a control token, a private one, or nothing fixed.
    const stray: string[] = [];
    for (const file of walk(src).filter((f) => /\.(svelte|css)$/.test(f))) {
      const name = relative(src, file).replaceAll('\\', '/');
      if (name === 'tokens.css') continue;
      for (const m of cssOf(file, readFileSync(file, 'utf8')).matchAll(
        /^\s*min-height:\s*([^;]+);/gm,
      )) {
        const value = (m[1] ?? '').trim();
        if (
          !/^(var\(--(control-(xs|sm|md)|_[a-z-]+|bar-[a-z]+|now-height|topbar-height)\)|0|auto|100dvh|min-content)$/.test(
            value,
          )
        ) {
          stray.push(`${name}: min-height: ${value}`);
        }
      }
    }
    expect(stray).toEqual([]);
  });
});
