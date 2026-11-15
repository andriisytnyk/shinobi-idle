/**
 * The content of the pack `core` must not change by accident. `fixtures/core-snapshot.json` holds
 * a hash of every entity and every balance number as they were when the content was first
 * assembled from packs; an entity or number that differs fails here. New entities are added to
 * the fixture when they arrive; existing ones are never regenerated.
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
const entries = (value: unknown): Record<string, string> => {
  if (Array.isArray(value))
    return Object.fromEntries(
      (value as Entry[]).map((e, i) => [e.id ?? e.item ?? e.poison ?? `#${i}`, hash(e)]),
    );
  return Object.fromEntries(Object.entries(value as object).map(([id, e]) => [id, hash(e)]));
};

const db = composeContent([corePack]);
const fixture = snapshot.entities as Record<string, Record<string, string>>;

describe('core pack snapshot', () => {
  for (const [list, expected] of Object.entries(fixture)) {
    it(`keeps every entity of ${list}`, () => {
      const value = (db as unknown as Record<string, unknown>)[list];
      const actual = list === 'ai' ? { ai: hash(value) } : entries(value);
      for (const [id, h] of Object.entries(expected)) expect(actual[id], `${list} ${id}`).toBe(h);
      // Entities that are not in the fixture are new on purpose: they need an entry.
      expect(
        Object.keys(actual).filter((id) => !(id in expected)),
        `${list}: not in the fixture`,
      ).toEqual([]);
    });
  }

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
});
