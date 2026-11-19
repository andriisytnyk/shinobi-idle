/**
 * The content of the pack `core` must not change by accident. `fixtures/core-snapshot.json` pins
 * every list of the pack (hash per entity, plus the order of each list), every balance number,
 * every locale string (hash per key), every icon and every modifier key. A change to any of them
 * needs a deliberate fixture update in the same PR.
 *
 * Provenance: the entities and numbers that existed on `dev` before the packs (the 31 original
 * lists, the balance numbers and the entities that #37 added) were generated from `origin/dev`,
 * and the refactor proved to change none of them. The lists that are new with the packs
 * (`skillGroups`, `natures`, `playerRanks`, `techRanks`, `missionRanks`, `villageStages`,
 * `states`, `tags`, `roles`, `attackStyles`, `fightRegions`, `itemKinds`, `currencies`,
 * `entityKinds`, `trophies`, `gearFx`), the list orders, the locales, the icons and the modifier
 * keys did not exist as data on `dev`: they were generated from the state of the pack at the
 * time the snapshot was extended (PR #50, iteration 1), which is the content that `dev` read from
 * constants, so they pin the pack from there on.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composeContent, corePack } from '../src/index.ts';
import snapshot from './fixtures/core-snapshot.json' with { type: 'json' };

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
const fixture = snapshot.entities as Record<string, Record<string, string>>;
const META = new Set(['balance', 'packs', 'modifierKeys', 'icons', 'locales']);

describe('core pack snapshot', () => {
  it('pins every list of the pack', () => {
    const actual = Object.keys(db).filter((k) => !META.has(k));
    expect(actual.sort()).toEqual(Object.keys(fixture).sort());
  });

  for (const [list, expected] of Object.entries(fixture)) {
    it(`keeps every entity of ${list}`, () => {
      const value = lists[list];
      const actual = list === 'ai' ? { ai: hash(value) } : entries(value);
      for (const [id, h] of Object.entries(expected)) expect(actual[id], `${list} ${id}`).toBe(h);
      expect(
        Object.keys(actual).filter((id) => !(id in expected)),
        `${list}: not in the fixture`,
      ).toEqual([]);
    });
  }

  it('keeps the order of every list (the order of ranks, groups and stages means something)', () => {
    const order = snapshot.order as Record<string, string[]>;
    // An order is required for every pinned list, so deleting one from the fixture fails.
    expect(Object.keys(order).sort()).toEqual(Object.keys(fixture).sort());
    for (const [list, expected] of Object.entries(order)) {
      expect(list === 'ai' ? ['ai'] : keysOf(lists[list]), `order of ${list}`).toEqual(expected);
      expect([...expected].sort(), `fixture order of ${list}`).toEqual(
        Object.keys(fixture[list] ?? {}).sort(),
      );
    }
  });

  it('keeps the order of the keys of every record of the balance object', () => {
    const actual: Record<string, string[]> = {};
    const walk = (p: string, v: unknown) => {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        actual[p || '(root)'] = Object.keys(v);
        for (const [k, x] of Object.entries(v)) walk(p ? `${p}.${k}` : k, x);
      }
    };
    walk('', db.balance);
    expect(actual).toEqual(snapshot.balanceOrder);
  });

  it('keeps every balance number', () => {
    const flat: Record<string, unknown> = {};
    const walk = (p: string, v: unknown) => {
      if (v !== null && typeof v === 'object' && !Array.isArray(v))
        for (const [k, x] of Object.entries(v)) walk(p ? `${p}.${k}` : k, x);
      else flat[p] = v;
    };
    walk('', db.balance);
    const expected = snapshot.balance as Record<string, unknown>;
    for (const [path, value] of Object.entries(expected)) expect(flat[path], path).toEqual(value);
    expect(Object.keys(flat).filter((p) => !(p in expected))).toEqual([]);
  });

  it('keeps every locale string', () => {
    for (const lang of ['uk', 'en'] as const) {
      const expected = snapshot.locales[lang] as Record<string, string>;
      const actual = Object.fromEntries(
        Object.entries(db.locales[lang]).map(([k, v]) => [k, hash(v)]),
      );
      for (const [key, h] of Object.entries(expected))
        expect(actual[key], `${lang} ${key}`).toBe(h);
      expect(Object.keys(actual).filter((k) => !(k in expected))).toEqual([]);
    }
  });

  it('keeps every icon and every modifier key', () => {
    expect(db.icons).toEqual(snapshot.icons);
    const expected = snapshot.modifierKeys as Record<string, string>;
    const actual = Object.fromEntries(
      Object.entries(db.modifierKeys).map(([k, v]) => [k, hash(v)]),
    );
    expect(actual).toEqual(expected);
  });
});
