/**
 * Regenerates `test/fixtures/core-snapshot.json` from the pack `core` as it is now, with the same
 * hashing as `test/snapshot.test.ts`, and prints every entity, list and order that changed against
 * the fixture on disk. Run it on purpose, when a content change is meant: `pnpm --filter
 * @shinobi/content exec tsx scripts/snapshot.ts`; list what it printed in the PR description.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { composeContent, corePack } from '../src/index.ts';

const FILE = new URL('../test/fixtures/core-snapshot.json', import.meta.url);

const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v !== null && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
};
const hash = (v: unknown) => createHash('sha1').update(canon(v)).digest('hex').slice(0, 12);

type Entry = { id?: string; item?: string; poison?: string };
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? (value as Entry[]).map((e, i) => e.id ?? e.item ?? e.poison ?? `#${i}`)
    : Object.keys(value as object);
const entries = (value: unknown): Record<string, string> => {
  if (Array.isArray(value))
    return Object.fromEntries(
      (value as Entry[]).map((e, i) => [e.id ?? e.item ?? e.poison ?? `#${i}`, hash(e)]),
    );
  return Object.fromEntries(Object.entries(value as object).map(([id, e]) => [id, hash(e)]));
};

const db = composeContent([corePack]) as unknown as Record<string, unknown>;
const META = new Set(['balance', 'packs', 'modifierKeys', 'icons', 'locales']);
const old = JSON.parse(readFileSync(FILE, 'utf8')) as {
  entities: Record<string, Record<string, string>>;
  order: Record<string, string[]>;
  [key: string]: unknown;
};

const entities: Record<string, Record<string, string>> = {};
const order: Record<string, string[]> = {};
for (const list of Object.keys(db).filter((k) => !META.has(k))) {
  const value = db[list];
  entities[list] = list === 'ai' ? { ai: hash(value) } : entries(value);
  order[list] = list === 'ai' ? ['ai'] : keysOf(value);
}

const changes: string[] = [];
for (const [list, now] of Object.entries(entities)) {
  const before = old.entities[list] ?? {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(now)])) {
    if (before[id] !== now[id]) {
      changes.push(
        `${list} ${id}: ${before[id] === undefined ? 'added' : now[id] === undefined ? 'removed' : 'changed'}`,
      );
    }
  }
  if (JSON.stringify(old.order[list]) !== JSON.stringify(order[list]))
    changes.push(`${list}: order`);
}
console.log(changes.join('\n') || 'nothing changed');
writeFileSync(FILE, `${JSON.stringify({ ...old, entities, order }, null, 2)}\n`);
