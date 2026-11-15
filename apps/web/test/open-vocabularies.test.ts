import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';

/*
 * T3. The interface reads its vocabularies from the content of the running game, so no source file
 * of the app imports the global content, and no source file names a skill, a nature, a rank, a
 * currency or an entity of the pack `core` by its id. What is allowed is listed here, with the reason.
 */

const src = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(src)
  .filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f))
  .map((f) => ({ name: relative(src, f).replaceAll('\\', '/'), text: readFileSync(f, 'utf8') }))
  // The icon bodies are generated data.
  .filter((f) => f.name !== 'lib/icons.generated.ts');

/** The one module that names packs: it composes the content of a boot. */
const BOOT = 'lib/boot.ts';

/** The code of a source without its comments: a comment may name an id as an example. */
const code = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    // An import names a module, not an id.
    .replace(/^\s*import [^\n]*$/gm, '');

/**
 * The parts of a source where an id can be a value rather than the name of a property: string
 * and template literals (a composite key such as `xp.skill.ath`, a data-* value, an attribute value),
 * `class:` directives and the selectors of a style block. A property or an attribute name is not.
 */
const valuesOf = (text: string): string => {
  const parts: string[] = [];
  for (const m of text.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g))
    // The name of a locale string (`world.panel.intel`) is a text key, not an id.
    if (!(m[0].slice(1, -1) in content.locales.uk)) parts.push(m[0].replace(/\$\{[^}]*\}/g, ''));
  for (const m of text.matchAll(/\bclass:([A-Za-z0-9_-]+)/g)) parts.push(m[1] ?? '');
  for (const style of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const sel of (style[1] ?? '').matchAll(/([^{}]+)\{/g)) parts.push(sel[1] ?? '');
  }
  return parts.join('\n');
};

/** Value imports from `@shinobi/content` that are allowed anywhere: pure helpers that take their data as arguments. */
const PURE_HELPERS = new Set(['localeKey', 'iconFor', 'scrollPartId']);

const CONTENT_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@shinobi\/content'/g;

describe('the interface does not import the global content (D1)', () => {
  it('finds the sources to check', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.name === BOOT)).toBe(true);
  });

  for (const file of files) {
    if (file.name === BOOT) continue;
    it(`${file.name} imports only types and pure helpers from the content package`, () => {
      const bad: string[] = [];
      for (const m of file.text.matchAll(CONTENT_IMPORT)) {
        if (m[1]) continue;
        for (const spec of (m[2] ?? '').split(',')) {
          const name = spec.trim();
          if (name === '' || name.startsWith('type ')) continue;
          if (!PURE_HELPERS.has(name.split(/\s+as\s+/)[0] ?? name)) bad.push(name);
        }
      }
      expect(bad).toEqual([]);
    });
  }

  it('does not import the test packs either, except through the boot module', () => {
    const offenders = files.filter(
      (f) => f.name !== BOOT && /@shinobi\/(content|core)\/testmod|dev-packs\//.test(f.text),
    );
    expect(offenders.map((f) => f.name)).toEqual([]);
  });
});

/** Ids that the content of the pack `core` gives to skills, natures, ranks and currencies. */
const vocabulary: { kind: string; ids: string[] }[] = [
  { kind: 'skill', ids: content.skills.map((s) => s.id) },
  { kind: 'nature', ids: content.natures.map((n) => n.id) },
  { kind: 'rank', ids: content.playerRanks.map((r) => r.id) },
  { kind: 'currency', ids: content.currencies.map((c) => c.id) },
];

/** Every id of an entity of the pack `core` (`core:<slug>`), from every list of the content. */
function coreEntityIds(): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === 'object') {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && id.startsWith('core:')) ids.add(id);
      Object.values(value).forEach(visit);
    }
  };
  for (const [key, value] of Object.entries(content)) {
    if (key !== 'locales' && key !== 'icons' && key !== 'balance') visit(value);
  }
  return [...ids];
}

const CORE_IDS = coreEntityIds();

/**
 * Places where a core id is allowed to stand, by file, with the reason. Everything else that names
 * a core id is a failure: such a name is data and belongs in the content.
 */
const ALLOWED: Record<string, { ids: string[]; why: string }> = {
  'lib/missions.ts': {
    ids: ['intel'],
    why: 'The pay kind of a mission stage (the engine schema of mission pay is closed): a kind of payment, not the currency of that id.',
  },
  'lib/crafts.ts': {
    ids: ['herb'],
    why: 'The source kind of an item that grows in a patch (ItemSource.kind and the craft.src.herb text): a kind of source, not the skill of that id.',
  },
};

/** An id as a whole token: bare in code, inside a composite string (xp.skill.ath), a class, a CSS selector or a data value. */
const quoted = (id: string): RegExp =>
  new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`);

describe('the interface names no core vocabulary or entity (D3, D5, D6)', () => {
  it('lists the vocabulary it checks', () => {
    for (const v of vocabulary) expect(v.ids.length, v.kind).toBeGreaterThan(1);
    expect(CORE_IDS.length).toBeGreaterThan(300);
  });

  for (const file of files) {
    it(`${file.name} names no skill, nature, rank, currency or core entity`, () => {
      const allowed = ALLOWED[file.name]?.ids ?? [];
      const text = valuesOf(code(file.text));
      const found: string[] = [];
      for (const { kind, ids } of vocabulary) {
        for (const id of ids) {
          if (!allowed.includes(id) && quoted(id).test(text)) {
            const line = text.split('\n').find((l) => quoted(id).test(l)) ?? '';
            found.push(`${kind} ${id}: ${line.trim().slice(0, 90)}`);
          }
        }
      }
      for (const id of CORE_IDS) {
        if (!allowed.includes(id) && text.includes(id)) {
          const line = text.split('\n').find((l) => l.includes(id));
          found.push(`entity ${id}: ${line?.trim().slice(0, 80)}`);
        }
      }
      expect(found).toEqual([]);
    });
  }

  it('keeps the allowlist honest: every allowed id is still used where it is allowed', () => {
    for (const [name, entry] of Object.entries(ALLOWED)) {
      const file = files.find((f) => f.name === name);
      expect(file, name).toBeDefined();
      for (const id of entry.ids)
        expect(quoted(id).test(valuesOf(code(file?.text ?? ''))), `${name} ${id}`).toBe(true);
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});

describe('the scan itself', () => {
  const hit = (source: string, id: string): boolean => quoted(id).test(valuesOf(code(source)));

  it('finds an id inside a composite string, a template, a class directive and a selector', () => {
    expect(hit("const k = 'xp.skill.ath';", 'ath')).toBe(true);
    expect(hit('const k = `interval.skill.${x}.ath`;', 'ath')).toBe(true);
    expect(hit('<li class:intel={x}>', 'intel')).toBe(true);
    expect(
      hit(
        "<style>\n  [data-entity='currency:intel'] dt {\n    color: red;\n  }\n</style>",
        'intel',
      ),
    ).toBe(true);
    expect(hit('<div data-total="ryo">', 'ryo')).toBe(true);
    expect(hit("const r = 'student';", 'student')).toBe(true);
  });

  it('does not take a property, an attribute name, a longer word or a text key for an id', () => {
    expect(hit('const n = cost.ryo + poi.ryo;', 'ryo')).toBe(false);
    expect(hit('<div data-herb={x}>', 'herb')).toBe(false);
    expect(hit("const k = 'herbalism';", 'herb')).toBe(false);
    expect(hit("t('world.panel.intel')", 'intel')).toBe(false);
  });
});
