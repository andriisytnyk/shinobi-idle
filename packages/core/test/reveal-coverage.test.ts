/** R1 review: the owners of the reveal catalog are complete, an open region is never hidden, and a v14 save keeps what the player had met. */
import { readFileSync } from 'node:fs';
import {
  composeContent,
  content,
  corePack,
  type ContentDb,
  type ContentPack,
} from '@shinobi/content';
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
import { testmodPack } from '../src/testmod/index.ts';

const listsOf = (db: ContentDb) =>
  db as unknown as Record<string, readonly Record<string, unknown>[] | undefined>;
const level = (state: ReturnType<typeof createState>, kind: string, id: string) =>
  revealOf(state, { kind, id }, content);

/** Every id of an entity of the content, with its kinds. */
function entityKinds(db: ContentDb): Map<string, string[]> {
  const lists = listsOf(db);
  const out = new Map<string, string[]>();
  for (const kind of db.entityKinds) {
    const rows = kind.list === null ? [] : (lists[kind.list] ?? []);
    for (const e of rows) out.set(e.id as string, [...(out.get(e.id as string) ?? []), kind.id]);
  }
  for (const cell of db.cells) {
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

/** The entities that some record of the database names and that no owner of the catalog names. */
function unowned(db: ContentDb): { missing: string[]; named: number } {
  const ids = entityKinds(db);
  const missing: string[] = [];
  const named = new Set<string>();
  for (const [name, rows] of Object.entries(listsOf(db))) {
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
    if (!kinds.some((kind) => revealOwnersOf(db, { kind, id }).length > 0)) missing.push(id);
  }
  return { missing, named: named.size };
}

describe('the owners of the catalog cover every reference field of every kind', () => {
  const ids = entityKinds(content);

  it('every entity that any record of the core pack names has an owner', () => {
    const { missing, named } = unowned(content);
    expect(missing).toEqual([]);
    expect(named).toBeGreaterThan(100);
  });

  it('the same holds with the test pack composed in', () => {
    const { missing, named } = unowned(composeContent([corePack, testmodPack]));
    expect(missing).toEqual([]);
    expect(named).toBeGreaterThan(100);
  });

  it('every item of the core pack can be revealed by some rule: it has an owner, or it is a placeholder shown when held', () => {
    // Held, any item is shown (the bank remembers it); this list is what has no owner and no other source.
    const heldOnly = new Set(['core:scrollpart']);
    const lonely = content.items
      .filter((i) => revealOwnersOf(content, { kind: 'item', id: i.id }).length === 0)
      .map((i) => i.id)
      .filter((id) => !heldOnly.has(id));
    expect(lonely).toEqual([]);
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

describe('a requirement tree of any depth names its entities (a pack)', () => {
  it('a quest step asking, three levels down, for an item makes the item named', () => {
    const quest = (testmodPack.data.quests ?? [])[0]!;
    const deep: ContentPack = {
      ...testmodPack,
      data: {
        ...testmodPack.data,
        quests: [
          {
            ...quest,
            steps: [
              {
                ...quest.steps[0]!,
                objective: {
                  t: 'req',
                  req: {
                    t: 'all',
                    of: [
                      { t: 'any', of: [{ t: 'all', of: [{ t: 'item', id: 'core:gem', n: 1 }] }] },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const mod = composeContent([corePack, deep]);
    expect(revealOwnersOf(mod, { kind: 'item', id: 'core:gem' })).toContain(
      'entity:quest:testmod:test_chain',
    );
    const state = createState(1, mod);
    expect(revealOf(state, { kind: 'quest', id: 'testmod:test_chain' }, mod)).toBe('full');
    expect(revealOf(state, { kind: 'item', id: 'core:gem' }, mod)).toBe('name');
    // The plain game does not have that quest: the gem is not named there.
    expect(level(createState(1, content), 'item', 'core:gem')).toBe('hidden');
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

describe('saves of version 14 whose items left no trace in the bank or the reports (made on dev)', () => {
  const load = (name: string) =>
    deserialize(
      readFileSync(new URL('./fixtures/' + name + '.json', import.meta.url), 'utf8'),
      content,
    );

  it('a player who ran dig 50 times and combined the parts: the part, the scroll and the mission are known', () => {
    const state = load('save-v14-dig');
    expect(state.bank['core:scrollpart_fire_dragon_flame_bullet']).toBeUndefined();
    expect(level(state, 'item', 'core:scrollpart_fire_dragon_flame_bullet')).toBe('full');
    expect(level(state, 'item', 'core:scroll_fire_dragon_flame_bullet')).toBe('full');
    expect(level(state, 'mission', 'core:dig')).toBe('full');
  });

  it('a player who combined scrolls from parts and read them: the scrolls and their parts are known', () => {
    const state = load('save-v14-scrolls');
    for (const t of ['drunken_fist', 'hidden_shadow_snake_hands']) {
      expect(state.known['core:' + t], t).toBe(true);
      expect(level(state, 'item', 'core:scroll_' + t), t).toBe('full');
      expect(level(state, 'item', 'core:scrollpart_' + t), t).toBe('full');
    }
  });

  it('does not take the key of a mission report for an enemy', () => {
    const raw = JSON.parse(
      readFileSync(new URL('./fixtures/save-v14-dig.json', import.meta.url), 'utf8'),
    ) as {
      state: { report: Record<string, unknown> };
    };
    raw.state.report['core:thief'] = {};
    const state = deserialize(JSON.stringify(raw), content);
    expect(state.shown['core:thief@enemy']).toBeUndefined();
  });
});
