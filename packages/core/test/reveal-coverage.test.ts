/** R1 review: the owners of the reveal catalog are complete, an open region is never hidden, and a v14 save keeps what the player had met. */
import { readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createState,
  deserialize,
  refreshRegions,
  revealHint,
  revealOf,
  revealOwnersOf,
  STATE_VERSION,
  xpAt,
} from '../src/index.ts';

const lists = content as unknown as Record<string, readonly Record<string, unknown>[] | undefined>;
const level = (state: ReturnType<typeof createState>, kind: string, id: string) =>
  revealOf(state, { kind, id }, content);

/** Every id of an entity of the content, with its kinds. */
function entityKinds(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const kind of content.entityKinds) {
    const rows = kind.list === null ? [] : (lists[kind.list] ?? []);
    for (const e of rows) out.set(e.id as string, [...(out.get(e.id as string) ?? []), kind.id]);
  }
  for (const cell of content.cells) {
    for (const poi of cell.pois) out.set(poi.id, [...(out.get(poi.id) ?? []), 'poi']);
  }
  return out;
}

/** Every reference to an entity inside the data of a record, at any depth, apart from the record's own id. */
function refsIn(record: unknown, own: string, ids: Map<string, string[]>): Set<string> {
  const found = new Set<string>();
  const walk = (v: unknown, atRoot: boolean): void => {
    if (typeof v === 'string') {
      if (ids.has(v) && v !== own) found.add(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, false);
    } else if (v !== null && typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) {
        if (k === 'reveal' || (atRoot && k === 'id')) continue;
        walk(item, false);
      }
    }
  };
  walk(record, true);
  return found;
}

describe('the owners of the catalog cover every reference field of every kind', () => {
  const ids = entityKinds();

  it('every entity that any record of the content names has an owner', () => {
    const missing: string[] = [];
    const named = new Set<string>();
    for (const [name, rows] of Object.entries(lists)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        for (const id of refsIn(row, (row.id as string | undefined) ?? '', ids)) named.add(id);
        // Nested records: the points of interest of a cell.
        if (name === 'cells') {
          for (const poi of (row as { pois: Record<string, unknown>[] }).pois) {
            for (const id of refsIn(poi, poi.id as string, ids)) named.add(id);
          }
        }
      }
    }
    for (const id of named) {
      const kinds = ids.get(id) ?? [];
      const owned = kinds.some((kind) => revealOwnersOf(content, { kind, id }).length > 0);
      if (!owned) missing.push(id);
    }
    expect(missing).toEqual([]);
    expect(named.size).toBeGreaterThan(100);
  });

  it('a record that is no entity (a coat) names its product once its poison is shown', () => {
    const coat = content.coat.find((c) => c.product === 'core:parsenbon');
    expect(coat).toBeDefined();
    if (!coat) return;
    const state = createState(1, content);
    expect(level(state, 'item', coat.product)).toBe('hidden');
    state.bank[coat.poison] = 1;
    expect(level(state, 'item', coat.product)).toBe('name');
  });

  it('a requirement node names its entity (a nested id counts)', () => {
    // Every quest step or unlock that asks for an item or a technique makes it a named entity.
    const need = content.quests
      .flatMap((q) => q.steps)
      .flatMap((s) => (s.objective.t === 'req' ? [s.objective.req] : []));
    expect(need.length).toBeGreaterThan(0);
    const named = refsIn(need, '', ids);
    for (const id of named) {
      expect(
        (ids.get(id) ?? []).some((kind) => revealOwnersOf(content, { kind, id }).length > 0),
        id,
      ).toBe(true);
    }
  });
});

describe('an open region is never hidden', () => {
  it('shows by name a region that Scouting from missions opened before any cell was explored', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    const valley = content.regions.find((r) => r.id === 'core:valley')!;
    expect(level(state, 'region', valley.id)).toBe('hidden');
    expect(revealHint(state, { kind: 'region', id: valley.id }, content)).toBe(
      'reveal.hint.adjacent',
    );
    state.skills.scout!.xp = xpAt(valley.scout);
    refreshRegions(state, content, true);
    expect(level(state, 'region', valley.id)).toBe('name');
    // No cell of the plains was explored, so the neighbour rule alone would have left it hidden.
    const plains = content.regions.find((r) => r.id === 'core:plains')!;
    expect(plains.cells.every((c) => (state.world.explores[c] ?? 0) === 0)).toBe(true);
  });
});

describe('a save of version 14 made on dev (a Genin who beat the wolf 98 times and sold the drops)', () => {
  const text = readFileSync(new URL('./fixtures/save-v14-reveal.json', import.meta.url), 'utf8');
  const loaded = deserialize(text, content);

  it('is a version-14 save and loads to the current version', () => {
    expect((JSON.parse(text) as { v: number }).v).toBe(14);
    expect(loaded.v).toBe(STATE_VERSION);
  });

  it('keeps shown in full what the player had met, held, sold or fought', () => {
    expect(loaded.bank['core:pelt']).toBeUndefined();
    expect(loaded.bank['core:gem']).toBeUndefined();
    for (const [kind, id] of [
      ['item', 'core:pelt'],
      ['item', 'core:gem'],
      ['enemy', 'core:wolf'],
    ] as const) {
      expect(level(loaded, kind, id), `${kind} ${id}`).toBe('full');
    }
  });

  it('does not show what the save does not prove (the boss never fought, the late items)', () => {
    expect(level(loaded, 'boss', 'core:boss_ren2')).toBe('hidden');
    expect(level(loaded, 'item', 'core:crate')).toBe('hidden');
  });
});
