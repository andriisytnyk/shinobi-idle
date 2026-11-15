/** R1: the reveal rule. What a player may see of an entity: scripted states, the `reveal.mark` command, the save. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  deserialize,
  dispatch,
  MARK_MAX_REFS,
  noteFight,
  noteSighting,
  revealHint,
  revealOf,
  serialize,
  updateQuests,
  type EntityRef,
  type GameState,
} from '../src/index.ts';
import { openWorld } from './helpers.ts';
import { modContent, modRules, setSkill } from './packs-helpers.ts';

const level = (state: GameState, kind: string, id: string) =>
  revealOf(state, { kind, id }, content);
const mark = (state: GameState, ...refs: EntityRef[]) =>
  dispatch(state, { type: 'reveal.mark', refs }, content);

const lists = content as unknown as Record<string, readonly { id: string }[]>;
const idsOf = (kind: string): string[] =>
  (lists[content.entityKinds.find((k) => k.id === kind)?.list ?? ''] ?? []).map((e) => e.id);

/** The kinds the core pack leaves open: no default rule, so everything of them is always shown. */
const OPEN_KINDS = content.entityKinds.filter((k) => !k.reveal && k.list !== null).map((k) => k.id);

/** A zone enemy that nothing but its zone names, and a shop good, an item no list offers, a recipe. */
const WOLF = 'core:wolf';
const FINAL_BOSS = 'core:boss_ren2';
const DROP = 'core:fang';

describe('the default rule of each kind, on a fresh save', () => {
  const state = createState(1, content);

  it('shows skills, techniques and the other open kinds in full', () => {
    expect(OPEN_KINDS).toEqual(
      expect.arrayContaining(['skill', 'technique', 'building', 'seal', 'exercise', 'status']),
    );
    for (const kind of OPEN_KINDS) {
      for (const id of idsOf(kind)) expect(level(state, kind, id), `${kind} ${id}`).toBe('full');
    }
  });

  it('shows an enemy of an open zone by name, and one that is not met not at all', () => {
    expect(level(state, 'enemy', 'core:dummy')).toBe('name');
    expect(level(state, 'enemy', WOLF)).toBe('hidden');
  });

  it('hides every boss of the story', () => {
    for (const id of idsOf('boss')) expect(level(state, 'boss', id), id).toBe('hidden');
  });

  it('shows the region the player stands in by name and the farther ones not at all', () => {
    expect(level(state, 'region', 'core:forest')).toBe('name');
    expect(level(state, 'region', 'core:plains')).toBe('hidden');
    expect(level(state, 'region', 'core:valley')).toBe('hidden');
  });

  it('shows the cells of a shown region by name, those of a hidden one not at all, and no point of interest', () => {
    const forest = content.regions.find((r) => r.id === 'core:forest')!;
    const valley = content.regions.find((r) => r.id === 'core:valley')!;
    for (const id of forest.cells) expect(level(state, 'cell', id), id).toBe('name');
    for (const id of valley.cells) expect(level(state, 'cell', id), id).toBe('hidden');
    for (const id of idsOf('poi').length > 0 ? idsOf('poi') : []) {
      expect(level(state, 'poi', id)).toBe('hidden');
    }
    for (const cell of content.cells) {
      for (const poi of cell.pois) expect(level(state, 'poi', poi.id), poi.id).toBe('hidden');
    }
  });

  it('shows the chain that has started and hides the one that has not', () => {
    expect(level(state, 'quest', 'core:graduation')).toBe('full');
    expect(level(state, 'quest', 'core:mission_board')).toBe('hidden');
  });

  it('shows the missions of the board by name, and an operation that is not open not at all', () => {
    expect(level(state, 'mission', 'core:cat')).toBe('name');
    expect(level(state, 'mission', 'core:op_hideout')).toBe('hidden');
  });

  it('shows items by name only where an entity that is shown names them, else not at all', () => {
    // A scroll that a technique names, a drop that only an enemy that is not met names.
    expect(level(state, 'item', 'core:scroll_gunshot')).toBe('name');
    expect(level(state, 'item', DROP)).toBe('hidden');
  });

  it('says how to learn more for each kind of rule', () => {
    expect(revealHint(state, { kind: 'boss', id: FINAL_BOSS }, content)).toBe(
      'reveal.hint.encountered',
    );
    expect(revealHint(state, { kind: 'region', id: 'core:valley' }, content)).toBe(
      'reveal.hint.explored',
    );
    expect(revealHint(state, { kind: 'quest', id: 'core:mission_board' }, content)).toBe(
      'reveal.hint.quest',
    );
    expect(revealHint(state, { kind: 'skill', id: 'tai' }, content)).toBeNull();
  });

  it('treats an id the content does not have as full (the page says it is not found)', () => {
    expect(level(state, 'enemy', 'core:no_such_enemy')).toBe('full');
  });
});

describe('what the state changes', () => {
  it('shows an enemy in full from the first sighting, and a boss too', () => {
    const state = createState(1, content);
    noteSighting(state, WOLF, content);
    expect(level(state, 'enemy', WOLF)).toBe('full');
    expect(level(state, 'boss', 'core:boss_wolf')).toBe('hidden');
    noteFight(state, 'core:boss_hunter', 'loss', content);
    noteSighting(state, 'core:boss_hunter', content);
    expect(level(state, 'boss', 'core:boss_hunter')).toBe('full');
  });

  it('opens a cell, its region and a found point of interest by exploring', () => {
    const state = createState(1, content);
    const forest = content.regions.find((r) => r.id === 'core:forest')!;
    const cell = forest.cells[0]!;
    state.world.explores[cell] = content.balance.K.cellExplores[0] ?? 1;
    expect(level(state, 'cell', cell)).toBe('full');
    expect(level(state, 'region', 'core:forest')).toBe('full');
    // The next region is next to an explored one; the one after is not.
    expect(level(state, 'region', 'core:plains')).toBe('name');
    expect(level(state, 'region', 'core:valley')).toBe('hidden');
    const poi = content.cells.find((c) => c.id === cell)?.pois[0];
    if (poi) {
      expect(level(state, 'poi', poi.id)).toBe('hidden');
      state.world.pois[poi.id] = true;
      expect(level(state, 'poi', poi.id)).toBe('full');
    }
    const plains = content.regions.find((r) => r.id === 'core:plains')!;
    state.world.explores[plains.cells[0]!] = content.balance.K.cellExplores[0] ?? 1;
    expect(level(state, 'region', 'core:valley')).toBe('name');
  });

  it('starts a chain when its unlock holds, and shows it', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    updateQuests(state, content);
    expect(level(state, 'quest', 'core:mission_board')).toBe('full');
    expect(level(state, 'mission', 'core:cat')).toBe('full');
  });

  it('opens an operation and the bosses it holds when its unlock holds', () => {
    const state = createState(1, content);
    expect(level(state, 'boss', 'core:boss_twins')).toBe('hidden');
    state.player.rank = 'genin';
    state.flags['op.hideout.unlocked'] = true;
    expect(level(state, 'mission', 'core:op_hideout')).toBe('full');
    expect(level(state, 'boss', 'core:boss_twins')).toBe('name');
    expect(level(state, 'enemy', 'core:guard_pack')).toBe('name');
    expect(level(state, 'boss', FINAL_BOSS)).toBe('hidden');
  });

  it('shows an item in full once it is held', () => {
    const state = createState(1, content);
    expect(level(state, 'item', DROP)).toBe('hidden');
    state.bank[DROP] = 2;
    expect(level(state, 'item', DROP)).toBe('full');
  });

  it('opens an enemy that a zone shows once the zone is open', () => {
    const state = createState(1, content);
    expect(level(state, 'enemy', WOLF)).toBe('hidden');
    state.player.rank = 'genin';
    openWorld(state);
    expect(level(state, 'enemy', WOLF)).toBe('name');
  });
});

describe('the command reveal.mark', () => {
  const shop = content.shop[0]!.item;
  const recipe = content.recipes[0]!;

  it('records an item the shop offers, and the entity is shown in full from then on', () => {
    const state = createState(1, content);
    expect(level(state, 'item', shop)).not.toBe('full');
    expect(mark(state, { kind: 'item', id: shop })).toEqual({ ok: true });
    expect(state.shown[shop]).toBe(true);
    expect(level(state, 'item', shop)).toBe('full');
  });

  it('records a recipe a skill lists, and then its product', () => {
    const state = createState(1, content);
    expect(level(state, 'recipe', recipe.id)).toBe('name');
    expect(mark(state, { kind: 'item', id: recipe.output.item }).ok).toBe(false);
    expect(mark(state, { kind: 'recipe', id: recipe.id }).ok).toBe(true);
    expect(level(state, 'recipe', recipe.id)).toBe('full');
    expect(mark(state, { kind: 'item', id: recipe.output.item }).ok).toBe(true);
    expect(level(state, 'item', recipe.output.item)).toBe('full');
  });

  it('refuses an entity that nothing shown names, and changes nothing', () => {
    const state = createState(1, content);
    const before = serialize(state);
    for (const ref of [
      { kind: 'boss', id: FINAL_BOSS },
      { kind: 'enemy', id: WOLF },
      { kind: 'item', id: DROP },
      { kind: 'region', id: 'core:valley' },
      { kind: 'quest', id: 'core:mission_board' },
    ]) {
      expect(mark(state, ref), ref.id).toEqual({ ok: false, reason: 'error.revealRefused' });
    }
    // One refused ref refuses the call: the good one in it is not recorded either.
    expect(mark(state, { kind: 'item', id: shop }, { kind: 'boss', id: FINAL_BOSS }).ok).toBe(
      false,
    );
    expect(serialize(state)).toBe(before);
  });

  it('refuses anything that is not a list of refs, and a list that is too long', () => {
    const state = createState(1, content);
    for (const refs of [
      null,
      'x',
      { kind: 'item', id: shop },
      [null],
      [{ kind: 1, id: shop }],
      [{}],
    ]) {
      expect(
        dispatch(state, { type: 'reveal.mark', refs } as never, content),
        JSON.stringify(refs),
      ).toEqual({ ok: false, reason: 'error.invalidReveal' });
    }
    const many = Array.from({ length: MARK_MAX_REFS + 1 }, () => ({ kind: 'item', id: shop }));
    expect(dispatch(state, { type: 'reveal.mark', refs: many }, content).ok).toBe(false);
    expect(Object.keys(state.shown)).toEqual([]);
  });

  it('is idempotent and never holds more than the entities of the content', () => {
    const state = createState(1, content);
    mark(state, { kind: 'item', id: shop });
    const once = serialize(state);
    expect(mark(state, { kind: 'item', id: shop }, { kind: 'item', id: shop }).ok).toBe(true);
    expect(serialize(state)).toBe(once);
    // Every name-level entity of the content, marked over several calls, stays within the bound.
    for (const kind of ['item', 'recipe', 'gear', 'cell']) {
      for (const id of idsOf(kind)) mark(state, { kind, id });
    }
    const entities = new Set(content.entityKinds.flatMap((k) => idsOf(k.id)));
    expect(Object.keys(state.shown).length).toBeLessThanOrEqual(entities.size);
    expect(Object.keys(state.shown).every((id) => entities.has(id))).toBe(true);
  });

  it('is deterministic: the same commands give the same bytes, whatever time passes between', () => {
    const run = (wait: number): string => {
      const state = createState(7, content);
      advance(state, wait, content);
      mark(state, { kind: 'item', id: shop });
      mark(state, { kind: 'recipe', id: recipe.id });
      return JSON.stringify(state.shown);
    };
    expect(run(0)).toBe(run(60_000));
  });

  it('survives a save and a load', () => {
    const state = createState(1, content);
    mark(state, { kind: 'item', id: shop });
    mark(state, { kind: 'recipe', id: recipe.id });
    const loaded = deserialize(serialize(state), content);
    expect(loaded.shown).toEqual(state.shown);
    expect(level(loaded, 'item', shop)).toBe('full');
    expect(serialize(loaded)).toBe(serialize(state));
  });

  it('sanitises a tampered set on load: unknown ids, other values and a swollen set are dropped', () => {
    const state = createState(1, content);
    const raw = JSON.parse(serialize(state)) as { state: { shown: Record<string, unknown> } };
    const entities = [...new Set(content.entityKinds.flatMap((k) => idsOf(k.id)))];
    raw.state.shown = {
      [shop]: true,
      'core:no_such_thing': true,
      __proto__: true,
      constructor: true,
      [FINAL_BOSS]: 'yes',
    };
    for (let i = 0; i < 5000; i++) raw.state.shown[`junk:${i}`] = true;
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(Object.keys(loaded.shown).sort()).toEqual([FINAL_BOSS, shop].sort());
    expect(Object.keys(loaded.shown).length).toBeLessThanOrEqual(entities.length);
    expect(Object.getPrototypeOf(loaded.shown)).toBe(Object.prototype);
  });

  it('migrates an older save with an empty set', () => {
    const state = createState(1, content);
    const raw = JSON.parse(serialize(state)) as { v: number; state: Record<string, unknown> };
    raw.v = 15;
    delete raw.state.shown;
    expect(deserialize(JSON.stringify(raw), content).shown).toEqual({});
  });
});

describe('a pack: its own rule over the default of its pack and its kind', () => {
  const state = createState(1, modContent);
  const at = (s: GameState, kind: string, id: string) =>
    revealOf(s, { kind, id }, modContent, modRules);

  it('follows the rule of the entity (a requirement on a skill level)', () => {
    expect(at(state, 'item', 'testmod:elixir')).toBe('hidden');
    setSkill(state, 'testmod:forge', 2);
    expect(at(state, 'item', 'testmod:elixir')).toBe('full');
  });

  it('follows the default of the pack for a kind: full only once the item is held, no marking before', () => {
    const fresh = createState(1, modContent);
    expect(at(fresh, 'item', 'testmod:pellet')).toBe('hidden');
    expect(
      dispatch(
        fresh,
        { type: 'reveal.mark', refs: [{ kind: 'item', id: 'testmod:pellet' }] },
        modContent,
      ).ok,
    ).toBe(false);
    fresh.bank['testmod:pellet'] = 1;
    expect(at(fresh, 'item', 'testmod:pellet')).toBe('full');
    // The rule of the core kind still holds for the core items.
    expect(at(fresh, 'item', 'core:kunai')).toBe('name');
  });

  it('keeps the pack default away from the core pack', () => {
    const plain = createState(1, content);
    plain.bank['core:kunai'] = 1;
    expect(level(plain, 'item', 'core:kunai')).toBe('full');
  });
});
