/**
 * Regenerates `test/fixtures/core-snapshot.json`, the pin of the content of the pack `core` that
 * `test/snapshot.test.ts` checks. Run it (`pnpm --filter @shinobi/content snapshot`) only when a
 * change to the pack is deliberate, and list every added, changed or moved entity in the PR.
 * The hashing is the one of the test; the output is then formatted by Prettier.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeContent, corePack } from '../src/index.ts';

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

const db = composeContent([corePack]);
const lists = db as unknown as Record<string, unknown>;
const META = new Set(['balance', 'packs', 'modifierKeys', 'icons', 'locales']);
const listNames = Object.keys(db).filter((k) => !META.has(k));

const flat: Record<string, unknown> = {};
const balanceOrder: Record<string, string[]> = {};
const walk = (p: string, v: unknown) => {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    balanceOrder[p || '(root)'] = Object.keys(v);
    for (const [k, x] of Object.entries(v)) walk(p ? `${p}.${k}` : k, x);
  } else flat[p] = v;
};
walk('', db.balance);

const hashed = (record: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, hash(v)]));

/** Keeps the key order of the current fixture where there is one, so a regeneration diffs by what changed. */
const ordered = <T>(record: Record<string, T>, like: unknown): Record<string, T> => {
  const known = like !== null && typeof like === 'object' ? Object.keys(like) : [];
  const keys = [
    ...known.filter((k) => k in record),
    ...Object.keys(record).filter((k) => !known.includes(k)),
  ];
  return Object.fromEntries(keys.map((k) => [k, record[k] as T]));
};

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../test/fixtures/core-snapshot.json');
let before: Record<string, unknown> = {};
try {
  before = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
} catch {
  // no fixture yet
}
const snapshot = {
  entities: ordered(
    Object.fromEntries(
      listNames.map((l) => [l, l === 'ai' ? { ai: hash(lists[l]) } : entries(lists[l])]),
    ),
    before.entities,
  ),
  balance: ordered(flat, before.balance),
  order: ordered(
    Object.fromEntries(listNames.map((l) => [l, l === 'ai' ? ['ai'] : keysOf(lists[l])])),
    before.order,
  ),
  locales: { uk: hashed(db.locales.uk), en: hashed(db.locales.en) },
  icons: db.icons,
  modifierKeys: Object.fromEntries(Object.entries(db.modifierKeys).map(([k, v]) => [k, hash(v)])),
  balanceOrder,
};

writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
spawnSync('pnpm', ['exec', 'prettier', '--write', out], {
  cwd: here,
  shell: true,
  stdio: 'inherit',
});
console.log(`wrote ${out}`);
