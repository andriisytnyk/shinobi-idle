/**
 * T4: the fight engine names no content id. A pack adds a status, a combo, a trait, a nature, a
 * tag, a role, a skill, a boss special or a currency by data and hooks; so no id of the pack `core`
 * may appear as a string literal in `src/combat/`. The ids are read from the data of the core pack,
 * not written here. What stays is listed with the reason it is not a content id.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../src/combat/', import.meta.url);

/** The ids that must not appear, with the kind of list each came from. */
function coreIds(): Map<string, string> {
  const ids = new Map<string, string>();
  const add = (kind: string, list: readonly string[]) => {
    for (const id of list) if (!ids.has(id)) ids.set(id, kind);
  };
  add(
    'status',
    content.statuses.map((s) => s.id),
  );
  add(
    'state',
    content.states.map((s) => s.id),
  );
  add(
    'combo',
    content.combos.map((c) => c.id),
  );
  add(
    'trait',
    content.traits.map((t) => t.id),
  );
  add(
    'nature',
    content.natures.map((n) => n.id),
  );
  add(
    'tag',
    content.tags.map((t) => t.id),
  );
  add(
    'role',
    content.roles.map((r) => r.id),
  );
  add(
    'skill',
    content.skills.map((s) => s.id),
  );
  add(
    'currency',
    content.currencies.map((c) => c.id),
  );
  add(
    'rank',
    [...content.techRanks, ...content.playerRanks].map((r) => r.id),
  );
  add(
    'boss special',
    content.bosses.map((b) => b.special.kind),
  );
  add(
    'hook',
    content.bosses.map((b) => b.special.hook),
  );
  add(
    'hook',
    content.traits.flatMap((t) => (t.hook === undefined ? [] : [t.hook])),
  );
  return ids;
}

/** String literals of a source file, with the comments taken out. */
function literals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    out.push(m[1] ?? m[2] ?? '');
  }
  return out;
}

/**
 * The literals that equal a core id and are not one. Each entry is `file: literal` and says why.
 * Everything here is engine vocabulary: the name of a technique effect kind, an item effect kind,
 * a field of the balance object, a pouch use or a stat, which happens to be spelled like an id.
 */
const FX_KIND =
  'the kind of a technique or item effect (a closed union of the content schema), not a tag';
const ALLOWED: Record<string, string> = {
  'fight-items.ts: cleanse': FX_KIND,
  'fight-items.ts: dispel': FX_KIND,
  'fight-parse.ts: cleanse': FX_KIND,
  'fight-parse.ts: reveal': FX_KIND,
  'fight-types.ts: cleanse': FX_KIND,
  'fight-types.ts: reveal': FX_KIND,
  'fight.ts: cleanse': FX_KIND,
  'fight.ts: reveal': FX_KIND,
};

describe('the fight engine names no id of the core pack', () => {
  const ids = coreIds();
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

  it('finds the ids and the files', () => {
    expect(ids.size).toBeGreaterThan(40);
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no literal that is an id of the core pack, besides the listed ones', () => {
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(new URL(file, DIR), 'utf8');
      for (const lit of new Set(literals(source))) {
        const kind = ids.get(lit);
        if (kind !== undefined && ALLOWED[`${file}: ${lit}`] === undefined) {
          found.push(`${file}: '${lit}' (a ${kind})`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('lists only what is still there', () => {
    for (const key of Object.keys(ALLOWED)) {
      const [file, lit] = key.split(': ');
      const source = readFileSync(new URL(file ?? '', DIR), 'utf8');
      expect(literals(source), key).toContain(lit);
    }
  });
});
