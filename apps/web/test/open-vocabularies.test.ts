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
    // A CSS class name is not an id: class="scout".
    .replace(/\bclass="[^"]*"/g, '');

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
      (f) => f.name !== BOOT && /@shinobi\/content\/testmod|dev-packs\//.test(f.text),
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

/** The quoted forms in which an id stands in source: 'id', "id" and `id`. */
const quoted = (id: string): RegExp =>
  new RegExp(`(['"\`])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`);

describe('the interface names no core vocabulary or entity (D3, D5, D6)', () => {
  it('lists the vocabulary it checks', () => {
    for (const v of vocabulary) expect(v.ids.length, v.kind).toBeGreaterThan(1);
    expect(CORE_IDS.length).toBeGreaterThan(300);
  });

  for (const file of files) {
    it(`${file.name} names no skill, nature, rank, currency or core entity`, () => {
      const allowed = ALLOWED[file.name]?.ids ?? [];
      const text = code(file.text);
      const found: string[] = [];
      for (const { kind, ids } of vocabulary) {
        for (const id of ids) {
          if (!allowed.includes(id) && quoted(id).test(text)) found.push(`${kind} ${id}`);
        }
      }
      for (const id of CORE_IDS) {
        if (!allowed.includes(id) && text.includes(id)) found.push(`entity ${id}`);
      }
      expect(found).toEqual([]);
    });
  }

  it('keeps the allowlist honest: every allowed id is still used where it is allowed', () => {
    for (const [name, entry] of Object.entries(ALLOWED)) {
      const file = files.find((f) => f.name === name);
      expect(file, name).toBeDefined();
      for (const id of entry.ids)
        expect(quoted(id).test(file?.text ?? ''), `${name} ${id}`).toBe(true);
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});
