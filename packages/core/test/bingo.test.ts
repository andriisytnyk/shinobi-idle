/** A2: the Bingo book: levels from encounters and wins, Intel studies, the AI's knowledge, the save. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  bingoLevel,
  bingoView,
  deserialize,
  dispatch,
  encounterFor,
  knowledgeOf,
  noteFight,
  noteSighting,
  refreshUnlocks,
  serialize,
  STATE_VERSION,
  simulateFights,
  snapshotPlayer,
  type GameState,
} from '../src/index.ts';
import { K, rules } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, openWorld, run, startFight } from './prep-state.ts';

const ENEMY = 'core:wolf';
const BOSS = 'core:boss_hunter';
const level = (state: GameState, id: string) => bingoLevel(state, id, content);

describe('levels from encounters and wins', () => {
  it('starts unknown, is seen from the first encounter, defeated at the first win, studied after N wins', () => {
    const state = fighter(1, 30);
    expect(level(state, ENEMY)).toBe(0);
    expect(knowledgeOf(state, content, [ENEMY])[ENEMY]).toEqual([]);
    startFight(state, 'core:zone_wolf');
    expect(level(state, ENEMY)).toBe(1);
    expect(state.bingo[ENEMY]?.seen).toBe(1);
    // A loss or a timeout teaches an ordinary enemy nothing more.
    noteFight(state, ENEMY, 'loss', content);
    noteFight(state, ENEMY, 'timeout', content);
    expect(level(state, ENEMY)).toBe(1);
    noteFight(state, ENEMY, 'win', content);
    expect(level(state, ENEMY)).toBe(2);
    const need = K.bingo.studiedWins.enemy;
    for (let i = 1; i < need - 1; i++) noteFight(state, ENEMY, 'win', content);
    expect(level(state, ENEMY)).toBe(2);
    noteFight(state, ENEMY, 'win', content);
    expect(state.bingo[ENEMY]?.wins).toBe(need);
    expect(level(state, ENEMY)).toBe(3);
  });

  it('teaches a boss with the first fight of any outcome, and studies it after its own number of wins', () => {
    for (const outcome of ['win', 'loss', 'timeout'] as const) {
      const state = fighter(2, 30);
      noteSighting(state, BOSS, content);
      expect(level(state, BOSS)).toBe(1);
      noteFight(state, BOSS, outcome, content);
      expect(level(state, BOSS), outcome).toBe(2);
    }
    const state = fighter(3, 30);
    noteSighting(state, BOSS, content);
    for (let i = 0; i < K.bingo.studiedWins.boss - 1; i++) noteFight(state, BOSS, 'win', content);
    expect(level(state, BOSS)).toBe(2);
    noteFight(state, BOSS, 'win', content);
    expect(level(state, BOSS)).toBe(3);
  });

  it('counts a real fight in the game: a win raises the level, an event says so', () => {
    const state = fighter(4, 50);
    run(state, { type: 'loadout.auto', on: true });
    startFight(state, 'core:zone_bandit');
    advance(state, 120_000, content);
    expect(state.bingo['core:bandit']?.wins).toBeGreaterThan(0);
    expect(level(state, 'core:bandit')).toBeGreaterThanOrEqual(2);
    expect(state.events.some((e) => e.type === 'bingoLevel' && e.enemy === 'core:bandit')).toBe(
      true,
    );
  });
});

describe('bingo.study', () => {
  const study = (state: GameState, enemy: string) =>
    dispatch(state, { type: 'bingo.study', enemy }, content);

  it('costs Intel for a level and stops at the studied level', () => {
    const state = fighter(5, 30);
    const cost = K.intel.bingoLevel;
    state.currencies.intel = cost * 5;
    expect(study(state, ENEMY)).toEqual({ ok: true });
    expect(level(state, ENEMY)).toBe(1);
    expect(state.currencies.intel).toBe(cost * 4);
    // The level between is earned by a fight, not bought.
    expect(study(state, ENEMY)).toEqual({ ok: false, reason: 'error.bingoNeedsFight' });
    expect(state.currencies.intel).toBe(cost * 4);
    noteFight(state, ENEMY, 'win', content);
    expect(level(state, ENEMY)).toBe(2);
    expect(study(state, ENEMY)).toEqual({ ok: true });
    expect(level(state, ENEMY)).toBe(3);
    expect(study(state, ENEMY)).toEqual({ ok: false, reason: 'error.bingoMax' });
    expect(state.currencies.intel).toBe(cost * 3);
  });

  it('refuses without enough Intel and for an unknown id, changing nothing', () => {
    const state = fighter(6, 30);
    state.currencies.intel = K.intel.bingoLevel - 1;
    expect(study(state, ENEMY)).toEqual({ ok: false, reason: 'error.notEnoughIntel' });
    expect(study(state, 'core:nobody')).toEqual({ ok: false, reason: 'error.unknownEnemy' });
    expect(state.currencies.intel).toBe(K.intel.bingoLevel - 1);
    expect(state.bingo[ENEMY]).toBeUndefined();
  });

  it('buys level 1 before the first meeting only when the cell of the zone is explored', () => {
    const state = fighter(7, 30);
    state.world.explores = {};
    state.currencies.intel = 10;
    expect(study(state, ENEMY)).toEqual({ ok: false, reason: 'error.notDiscovered' });
    openWorld(state);
    expect(study(state, ENEMY)).toEqual({ ok: true });
    expect(level(state, ENEMY)).toBe(1);
    // The studied level needs no cell.
    state.world.explores = {};
    noteFight(state, ENEMY, 'win', content);
    expect(study(state, ENEMY)).toEqual({ ok: true });
    expect(level(state, ENEMY)).toBe(3);
  });

  it('shows what each level lets the player see', () => {
    const state = fighter(8, 30);
    const hidden = 'core:kiri_hunter';
    state.currencies.intel = 20;
    expect(bingoView(state, hidden, content)?.hiddenTraits).toBeNull();
    study(state, hidden);
    expect(bingoView(state, hidden, content)?.hiddenTraits).toBeNull();
    noteFight(state, hidden, 'win', content);
    expect(bingoView(state, hidden, content)?.hiddenTraits).toEqual(['hidden']);
    expect(bingoView(state, hidden, content)?.drops).toBeNull();
    study(state, hidden);
    expect(bingoView(state, hidden, content)?.drops).not.toBeNull();
    expect(bingoView(state, 'core:nobody', content)).toBeNull();
  });
});

describe('the AI follows the level', () => {
  it('answers a hidden trait only from level 2', () => {
    const state = fighter(9, 40, 'katon');
    setLevel(state, 'futon', 40);
    state.player.rank = 'chunin';
    refreshUnlocks(state, content, true);
    const target = 'core:kiri_hunter';
    const reveal = 'core:sensing';
    expect(state.known[reveal]).toBe(true);
    const attacks = Object.keys(state.known)
      .filter((id) =>
        ['projectile', 'series', 'area'].includes(
          content.techniques.find((t) => t.id === id)?.role ?? '',
        ),
      )
      .slice(0, 3);
    run(state, { type: 'loadout.set', techniques: [reveal, ...attacks] });
    const entry = content.enemies.find((e) => e.id === target);
    if (!entry) throw new Error('no enemy');
    const uses = (lvl: 1 | 2): number => {
      state.bingo = {
        [target]: {
          seen: 1,
          wins: lvl === 2 ? 1 : 0,
          losses: 0,
          timeouts: 0,
          bought: 0,
          bounty: 0,
        },
      };
      const snap = snapshotPlayer(state, content, rules, undefined, [target]);
      expect(snap.knowledge?.[target]).toEqual(lvl === 2 ? ['hidden', 'special'] : []);
      const sum = simulateFights(snap, encounterFor(entry, content), 20, 3, content, rules);
      return sum.tally.uses[reveal] ?? 0;
    };
    const first = uses(1);
    const second = uses(2);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(0.5);
  });

  it('puts the level into a fight that starts', () => {
    const state = fighter(10, 36);
    startFight(state, 'core:zone_kiri_hunter');
    expect(state.combat?.fight.knowledge['core:kiri_hunter']).toEqual([]);
    run(state, { type: 'action.stop', slot: 0 });
    noteFight(state, 'core:kiri_hunter', 'win', content);
    startFight(state, 'core:zone_kiri_hunter');
    expect(state.combat?.fight.knowledge['core:kiri_hunter']).toContain('hidden');
  });
});

describe('the book in a save', () => {
  it('round-trips, drops unknown ids and clamps numbers', () => {
    const state = fighter(11, 30);
    state.currencies.intel = 4;
    run(state, { type: 'bingo.study', enemy: ENEMY });
    noteFight(state, ENEMY, 'win', content);
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.bingo).toEqual(state.bingo);
    const raw = JSON.parse(serialize(state, 0)) as { state: { bingo: Record<string, unknown> } };
    raw.state.bingo['core:ghost'] = { seen: 1 };
    raw.state.bingo[ENEMY] = { seen: -4, wins: 2.7, losses: 'x', bought: 99 };
    const doctored = deserialize(JSON.stringify(raw), content);
    expect(doctored.bingo['core:ghost']).toBeUndefined();
    expect(doctored.bingo[ENEMY]).toEqual({
      seen: 0,
      wins: 2,
      losses: 0,
      timeouts: 0,
      bought: 3,
      bounty: 0,
    });
  });

  it('migrates a version 10 save: `seen` and the counters become the book', () => {
    const state = fighter(12, 30);
    const raw = JSON.parse(serialize(state, 0)) as {
      v: number;
      state: Record<string, unknown>;
    };
    raw.v = 10;
    raw.state.v = 10;
    delete raw.state.bingo;
    delete raw.state.report;
    raw.state.seen = { [ENEMY]: true, 'core:bandit': true };
    raw.state.counters = { 'kills.core:bandit': 5, 'defeats.core:bandit': 1 };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect('seen' in loaded).toBe(false);
    expect(loaded.bingo[ENEMY]?.seen).toBe(1);
    expect(level(loaded, ENEMY)).toBe(1);
    expect(loaded.bingo['core:bandit']).toMatchObject({ wins: 5, losses: 1 });
    expect(level(loaded, 'core:bandit')).toBe(2);
    expect(loaded.report).toEqual({});
  });
});
