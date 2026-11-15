/** T3: a save made with the test pack loads without it, loses nothing the pack kept, and a core save loads with the pack present. */
import { describe, expect, it } from 'vitest';
import {
  advance,
  deserialize,
  dispatch,
  serialize,
  teamFor,
  type GameEvent,
  type GameState,
} from '../src/index.ts';
import { TOKEN, TOKEN_TICKS } from '../src/testmod/index.ts';
import {
  HOUR,
  modContent,
  modGenin,
  modRules,
  plainContent,
  plainGenin,
  plainRules,
  setSkill,
  withoutPackData,
} from './packs-helpers.ts';

const LEAF = 'core:leaf_whirlwind';
/** Seven tokens set by hand and the three that the quest of the pack paid when the forge level finished it. */
const TOKENS = 10;
/** Five pellets set by hand and the one that the same quest paid. */
const PELLETS = 6;
const start = (kind: string, id: string) => ({ type: 'action.start', slot: 0, kind, id }) as const;

/** The game the player started with the pack: the core practice running, the nature of the core chosen, the rank the core grants. */
function coreOnly(state: GameState, content: typeof plainContent): void {
  setSkill(state, 'tai', 12);
  state.player.rank = 'chunin';
  state.player.natures = ['katon'];
  state.team = teamFor(content, 'katon');
}

/** The same game with the things only the pack has: its skills, its nature after the first, its rank, currency, items and quest. */
function withPack(): GameState {
  const state = modGenin(9);
  coreOnly(state, modContent);
  dispatch(state, start('practice', LEAF), modContent, modRules);
  advance(state, HOUR, modContent, modRules);
  setSkill(state, 'testmod:forge', 3);
  setSkill(state, 'testmod:aether', 2);
  state.pools['testmod:forge'] = { xp: 123 };
  state.mastery['testmod:elixir_brew'] = { xp: 456 };
  state.player.natures = ['katon', 'testmod:aether'];
  state.player.rank = 'testmod:adept';
  state.currencies[TOKEN] = 7;
  state.bank['testmod:pellet'] = 5;
  state.bank['testmod:elixir'] = 2;
  state.flags['testmod:seen'] = true;
  state.gear['testmod:anvil'] = 1;
  advance(state, 1, modContent, modRules);
  return state;
}

/** The same game without any of it. */
function without(): GameState {
  const state = plainGenin(9);
  coreOnly(state, plainContent);
  dispatch(state, start('practice', LEAF), plainContent, plainRules);
  advance(state, HOUR, plainContent, plainRules);
  advance(state, 1, plainContent, plainRules);
  return state;
}

const eventsOf = (state: GameState, type: GameEvent['type']) =>
  state.events.filter((e) => e.type === type);

describe('a save made with the pack, loaded without it', () => {
  const saved = serialize(withPack());

  it('loads, tells the UI which pack vanished and plays on', () => {
    const state = deserialize(saved, plainContent, plainRules);
    expect(state.packs).toEqual([{ id: 'core', version: plainContent.packs[0]?.version }]);
    expect(eventsOf(state, 'packsChanged')).toEqual([
      expect.objectContaining({ added: [], removed: ['testmod'] }),
    ]);
    expect(Object.keys(state.skills)).not.toContain('testmod:forge');
    expect(Object.keys(state.currencies)).toEqual(['ryo', 'rep', 'intel']);
    expect(state.player.rank).toBe('chunin');
    expect(state.player.natures).toEqual(['katon']);
    advance(state, 2 * HOUR, plainContent, plainRules);
    expect(state.now).toBe(3 * HOUR + 1);
  });

  it('keeps the data of the pack in the dormant bucket, and nothing of it in the live state', () => {
    const state = deserialize(saved, plainContent, plainRules);
    const held = state.dormant.testmod;
    expect(held?.rank).toBe('testmod:adept');
    expect(held?.natures).toEqual(['katon', 'testmod:aether']);
    expect(held?.data.skills?.['testmod:forge']).toEqual({ xp: expect.any(Number) });
    expect(held?.data.currencies?.[TOKEN]).toBe(TOKENS);
    expect(held?.data.bank).toEqual({ 'testmod:pellet': PELLETS, 'testmod:elixir': 2 });
    expect(held?.data.pools?.['testmod:forge']).toEqual({ xp: 123 });
    expect(held?.data.mastery?.['testmod:elixir_brew']).toEqual({ xp: 456 });
    expect(held?.data.counters?.[TOKEN_TICKS]).toBeGreaterThanOrEqual(0);
    expect(held?.data.gear?.['testmod:anvil']).toBe(1);
    expect(Object.keys(state.bank)).toEqual(expect.not.arrayContaining(['testmod:pellet']));
    expect(JSON.stringify(state.flags)).not.toContain('testmod');
    expect(JSON.stringify(state.counters)).not.toContain('testmod');
    expect(Object.keys(state.quests)).not.toContain('testmod:test_chain');
  });

  it('leaves the core game byte for byte what it is without the pack, now and after two more hours', () => {
    const loaded = deserialize(saved, plainContent, plainRules);
    const reference = without();
    expect(withoutPackData(serialize(loaded))).toEqual(withoutPackData(serialize(reference)));
    advance(loaded, 2 * HOUR, plainContent, plainRules);
    advance(reference, 2 * HOUR, plainContent, plainRules);
    expect(withoutPackData(serialize(loaded))).toEqual(withoutPackData(serialize(reference)));
  });

  it('gives the pack back what it kept when it is added again', () => {
    const original = withPack();
    const core = deserialize(saved, plainContent, plainRules);
    const again = deserialize(serialize(core), modContent, modRules);
    expect(eventsOf(again, 'packsChanged')).toEqual([
      expect.objectContaining({ added: ['testmod'], removed: [] }),
    ]);
    expect(again.dormant).toEqual({});
    expect(again.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
    expect(again.player.rank).toBe('testmod:adept');
    expect(again.player.natures).toEqual(['katon', 'testmod:aether']);
    for (const skill of ['testmod:forge', 'testmod:aether']) {
      expect(again.skills[skill]).toEqual(original.skills[skill]);
    }
    expect(again.pools['testmod:forge']).toEqual({ xp: 123 });
    expect(again.mastery['testmod:elixir_brew']).toEqual({ xp: 456 });
    expect(again.currencies[TOKEN]).toBe(TOKENS);
    expect(again.bank['testmod:pellet']).toBe(PELLETS);
    expect(again.bank['testmod:elixir']).toBe(2);
    expect(again.flags['testmod:seen']).toBe(true);
    expect(again.gear['testmod:anvil']).toBe(1);
    expect(again.quests['testmod:test_chain']).toEqual(original.quests['testmod:test_chain']);
    expect(again.known['testmod:aether_touch']).toBe(true);
    // The whole state is what the original was: a round trip through the core game changed nothing.
    // Two branches are left out: the automatic loadout and the pouch are derived from the rank by the
    // fight code, which still orders the ranks by its own list and does not know the rank of the pack.
    const derived = ['loadouts', 'pouch'];
    const strip = (state: GameState) => {
      const copy = JSON.parse(serialize(state)).state as Record<string, unknown>;
      for (const key of derived) delete copy[key];
      return copy;
    };
    expect(strip(again)).toEqual(strip(original));
  });

  it('survives two round trips through the core game', () => {
    const once = deserialize(saved, plainContent, plainRules);
    const twice = deserialize(serialize(once), plainContent, plainRules);
    expect(twice.dormant).toEqual(once.dormant);
    const back = deserialize(serialize(twice), modContent, modRules);
    expect(back.currencies[TOKEN]).toBe(TOKENS);
    expect(back.player.rank).toBe('testmod:adept');
  });

  it('falls back along the saved rank order to the highest rank it knows', () => {
    const state = withPack();
    state.player.rank = 'testmod:adept';
    const text = JSON.parse(serialize(state)) as { state: { rankOrder: string[] } };
    // The saved order says which rank came before the missing one.
    text.state.rankOrder = ['student', 'genin', 'testmod:adept', 'chunin'];
    const loaded = deserialize(JSON.stringify(text), plainContent, plainRules);
    expect(loaded.player.rank).toBe('genin');
    text.state.rankOrder = [];
    const unordered = deserialize(JSON.stringify(text), plainContent, plainRules);
    expect(unordered.player.rank).toBe('student');
  });
});

describe('a core save loaded with the pack present', () => {
  it('loads, adds the skills and currencies of the pack at zero and says the pack appeared', () => {
    const core = without();
    const state = deserialize(serialize(core), modContent, modRules);
    expect(eventsOf(state, 'packsChanged')).toEqual([
      expect.objectContaining({ added: ['testmod'], removed: [] }),
    ]);
    expect(state.skills['testmod:forge']).toEqual({ xp: 0 });
    expect(state.currencies[TOKEN]).toBe(0);
    expect(state.player.rank).toBe('chunin');
    expect(state.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
    // The core part is what it was, and the game plays on with the pack's rules.
    expect(state.skills.tai).toEqual(core.skills.tai);
    advance(state, 2 * HOUR, modContent, modRules);
    expect(state.currencies[TOKEN]).toBe(12);
  });

  it('loads a v13 save (no pack list) without a pack event', () => {
    const core = without();
    const text = JSON.parse(serialize(core)) as { v: number; state: Record<string, unknown> };
    delete text.state.packs;
    delete text.state.dormant;
    delete text.state.rankOrder;
    const state = deserialize(JSON.stringify(text), modContent, modRules);
    expect(eventsOf(state, 'packsChanged')).toEqual([]);
    expect(state.packs.map((p) => p.id)).toEqual(['core', 'testmod']);
  });
});
