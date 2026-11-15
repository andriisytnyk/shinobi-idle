/**
 * Regenerates the whole of `test/fixtures/core-snapshot.json` from the pack `core` as it is now:
 * entities and their order, balance numbers and the order of its keys, locale hashes, icons and
 * modifier keys, with the same hashing as `test/snapshot.test.ts`. It prints what changed against
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
const keyOf = (e: Entry, i: number) => e.id ?? e.item ?? e.poison ?? `#${i}`;
const keysOf = (value: unknown): string[] =>
  Array.isArray(value) ? (value as Entry[]).map(keyOf) : Object.keys(value as object);
const entries = (value: unknown): Record<string, string> =>
  Array.isArray(value)
    ? Object.fromEntries((value as Entry[]).map((e, i) => [keyOf(e, i), hash(e)]))
    : Object.fromEntries(Object.entries(value as object).map(([id, e]) => [id, hash(e)]));

const db = composeContent([corePack]) as unknown as Record<string, unknown> & {
  balance: unknown;
  locales: Record<'uk' | 'en', Record<string, string>>;
  icons: unknown;
  modifierKeys: Record<string, unknown>;
};
const META = new Set(['balance', 'packs', 'modifierKeys', 'icons', 'locales']);

const entities: Record<string, Record<string, string>> = {};
const order: Record<string, string[]> = {};
for (const list of Object.keys(db).filter((k) => !META.has(k))) {
  const value = db[list];
  entities[list] = list === 'ai' ? { ai: hash(value) } : entries(value);
  order[list] = list === 'ai' ? ['ai'] : keysOf(value);
}

const balance: Record<string, unknown> = {};
const balanceOrder: Record<string, string[]> = {};
const walk = (p: string, v: unknown) => {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    balanceOrder[p || '(root)'] = Object.keys(v);
    for (const [k, x] of Object.entries(v)) walk(p ? `${p}.${k}` : k, x);
  } else balance[p] = v;
};
walk('', db.balance);

const locales = {
  uk: Object.fromEntries(Object.entries(db.locales.uk).map(([k, v]) => [k, hash(v)])),
  en: Object.fromEntries(Object.entries(db.locales.en).map(([k, v]) => [k, hash(v)])),
};
const modifierKeys = Object.fromEntries(
  Object.entries(db.modifierKeys).map(([k, v]) => [k, hash(v)]),
);

const fresh = { entities, balance, order, locales, icons: db.icons, modifierKeys, balanceOrder };
const old = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Record<string, unknown>>;

const changes: string[] = [];
const diff = (part: string, before: Record<string, unknown> = {}, now: Record<string, unknown>) => {
  for (const k of new Set([...Object.keys(before), ...Object.keys(now)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(now[k])) {
      changes.push(
        `${part} ${k}: ${before[k] === undefined ? 'added' : now[k] === undefined ? 'removed' : 'changed'}`,
      );
    }
  }
};
for (const list of Object.keys(entities)) {
  diff(`entities.${list}`, old.entities?.[list] as Record<string, unknown>, entities[list] ?? {});
}
for (const part of [
  'order',
  'balance',
  'balanceOrder',
  'locales',
  'modifierKeys',
  'icons',
] as const) {
  diff(part, old[part], fresh[part] as Record<string, unknown>);
}
console.log(changes.join('\n') || 'nothing changed');
writeFileSync(FILE, `${JSON.stringify(fresh, null, 2)}\n`);
