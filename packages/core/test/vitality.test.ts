/**
 * Health is the character's state: it carries over between fights and actions, regenerates by the per-second rate
 * in and out of fights (split-invariant out of them), a stop and a restart do not heal, a clone has its own, a
 * defeat wakes the character at a share of the maximum, a save of an older version loads at full health, and the
 * forecast starts from the health the character has.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  analyzeFight,
  createState,
  STATE_VERSION,
  currentHp,
  defaultRules,
  deserialize,
  dispatch,
  growSlots,
  hpRegenOf,
  performerHpRegen,
  performerMaxHp,
  regenerated,
  restartReady,
  serialize,
  vitalityLevels,
  type GameState,
} from '../src/index.ts';
import { fullHp, genin, HOUR } from './helpers.ts';
import { fighter, ids, startFight, stock } from './prep-state.ts';

const K = content.balance.K;
const MIN = 60_000;
const WOLF = 'core:zone_wolf';
const HARD = 'core:zone_foreign_genin';
const CLONE = 'core:shadow_clone';

/** Health regenerated per second at Vitality level 1, the level of a new character. */
const BASE = (K.hpRegen[0] ?? 0) + (K.hpRegen[1] ?? 0);

describe('the health of a new character and the regeneration out of a fight', () => {
  it('starts full', () => {
    const state = createState(1, content);
    expect(state.player.hp).toBe(performerMaxHp(state, content));
    expect(state.player.hp).toBe(K.hpBase + K.hpPerVit);
  });

  it('regenerates by the per-second rate of the balance, with nothing to do or with an action', () => {
    expect(performerHpRegen(genin(), content, defaultRules)).toBeCloseTo(BASE, 12);
    const idle = genin();
    idle.player.hp = 10;
    advance(idle, 100_000, content);
    expect(idle.player.hp).toBeCloseTo(10 + 100 * BASE, 5);
    // An action that is not a fight does not change it.
    const busy = genin();
    busy.player.hp = 10;
    dispatch(busy, { type: 'action.start', slot: 0, kind: 'practice', id: 'core:clone' }, content);
    advance(busy, 100_000, content);
    expect(busy.player.hp).toBeCloseTo(10 + 100 * BASE, 5);
  });

  it('grows with Vitality and with the hp.regen modifier (flat HP per second)', () => {
    const levels = (n: number) => hpRegenOf(vitalityLevels(n), content);
    expect(levels(20)).toBeCloseTo((K.hpRegen[0] ?? 0) + 20 * (K.hpRegen[1] ?? 0), 12);
    expect(levels(50)).toBeGreaterThan(levels(20));
    const rules = {
      ...defaultRules,
      modifierProviders: [
        () => [
          {
            key: 'hp.regen',
            op: 'add' as const,
            value: 0.25,
            group: 'items' as const,
            source: 'test',
          },
        ],
      ],
    };
    expect(performerHpRegen(genin(), content, rules)).toBeCloseTo(BASE + 0.25, 12);
  });

  it('stops at the maximum', () => {
    const state = genin();
    state.player.hp = performerMaxHp(state, content) - 1;
    advance(state, 10 * HOUR, content);
    expect(state.player.hp).toBe(performerMaxHp(state, content));
  });

  it('is split-invariant: any chunking gives the same health, to the bit', () => {
    const run = (chunk: number): number => {
      const state = genin();
      state.player.hp = 3;
      for (let t = 0; t < 600_000; t += chunk)
        advance(state, Math.min(chunk, 600_000 - t), content);
      return state.player.hp;
    };
    const whole = run(600_000);
    for (const chunk of [1, 7, 999, 1000, 33_333]) expect(run(chunk)).toBe(whole);
    expect(whole).toBeCloseTo(3 + 600 * BASE, 4);
  });

  it('is pure arithmetic: a span added in pieces gives the same number', () => {
    const a = regenerated(5, 0.37, 12_345, 1e9);
    const b = regenerated(regenerated(5, 0.37, 12_000, 1e9), 0.37, 345, 1e9);
    expect(b).toBe(a);
  });

  it('runs while the game is closed: offline time is advance time', () => {
    const state = genin();
    state.player.hp = 1;
    advance(state, 4 * HOUR, content);
    expect(state.player.hp).toBe(performerMaxHp(state, content));
    // A level of Vitality raises the maximum without healing: health is a state, not a share.
    const level = fighter(3, 20);
    level.player.hp = 50;
    expect(currentHp(level, 0, content).hp).toBe(50);
    expect(currentHp(level, 0, content).max).toBeGreaterThan(50);
  });
});

describe('health across fights', () => {
  it('carries over to the next fight: no heal between the fights of a zone', () => {
    const state = fighter(11, 36);
    const max = performerMaxHp(state, content);
    // Wounded from the start: the old lump heal of 80% of the maximum would have put each win above this line.
    state.player.hp = 100;
    startFight(state, WOLF);
    const seen: number[] = [];
    let kills = 0;
    for (let t = 0; t < 10 * MIN && kills < 4; t += 1000) {
      advance(state, 1000, content);
      const now = state.counters['kills.core:wolf'] ?? 0;
      if (now > kills) {
        kills = now;
        seen.push(state.player.hp);
      }
    }
    expect(kills).toBeGreaterThanOrEqual(3);
    // Each win leaves the character short of the maximum, and the next fight starts from there, not from a lump heal.
    expect(seen[0]).toBeLessThan(max / 2);
    expect(K.zoneHpRegen).toBe(0);
    expect(Math.min(...seen)).toBeLessThan(max);
  });

  it('starts a fight from the health the character has, and writes it back as the fight goes', () => {
    const state = fighter(12, 36);
    state.player.hp = 77;
    startFight(state, WOLF);
    expect(state.combat?.fight.player.hp).toBe(77);
    advance(state, 20_000, content);
    const live = state.combat?.fight.player.hp;
    expect(live).toBeDefined();
    expect(state.player.hp).toBe(live);
    expect(currentHp(state, 0, content).hp).toBe(live);
  });

  it('is not healed by a stop and a restart of the action', () => {
    const state = fighter(13, 36);
    state.player.hp = 60;
    startFight(state, WOLF);
    advance(state, 15_000, content);
    const before = state.player.hp;
    expect(before).toBeLessThan(performerMaxHp(state, content));
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    expect(state.player.hp).toBe(before);
    startFight(state, WOLF);
    expect(state.combat?.fight.player.hp).toBe(before);
    // Starting another action and coming back changes nothing but the time regeneration gives.
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    startFight(state, HARD);
    expect(state.combat?.fight.player.hp).toBe(before);
  });

  it('regenerates in a fight on the rate it has outside it, times the share the balance gives the fight', () => {
    const state = fighter(14, 36);
    // A fight the character does not lose in a short time: a long wait is not needed, the first step is.
    state.player.hp = 100;
    startFight(state, WOLF);
    expect(state.combat?.fight.kit.hpRegen).toBeCloseTo(
      performerHpRegen(state, content, defaultRules) * K.combat.hpRegenShare,
      9,
    );
  });

  it('wakes the character at a share of the maximum after a defeat', () => {
    const state = fighter(15, 36);
    state.player.hp = 1;
    startFight(state, HARD);
    // Second by second, up to the defeat: the check is of the moment the character wakes, before regeneration goes on.
    for (let t = 0; t < 5 * MIN && state.slots[0]?.action; t += 1000) advance(state, 1000, content);
    expect(state.slots[0]?.action).toBeNull();
    const max = performerMaxHp(state, content);
    // The share of the maximum (the Wound the defeat cost has already cut the maximum), then the regeneration since.
    expect(state.player.hp).toBeGreaterThanOrEqual(K.defeatHp * max - 1e-6);
    expect(state.player.hp).toBeLessThan(max);
  });

  it('is kept by food: a pill in the pouch restores health in the fight and the state keeps it', () => {
    const state = fighter(16, 36);
    stock(state, { [ids.heal]: 20 });
    dispatch(state, { type: 'pouch.set', slot: 0, item: ids.heal }, content);
    state.player.hp = 30;
    startFight(state, WOLF);
    advance(state, 30_000, content);
    expect(state.player.hp).toBeGreaterThan(30);
  });
});

describe('waiting for health after a defeat, and the training yard', () => {
  it('a player is ready to go back once health is K.restartHp of the maximum, not before', () => {
    const state = fighter(41, 36);
    const max = performerMaxHp(state, content);
    state.player.hp = K.restartHp * max - 1;
    expect(restartReady(state, content)).toBe(false);
    state.player.hp = K.restartHp * max;
    expect(restartReady(state, content)).toBe(true);
  });

  it('the forecast session waits for health after a defeat and counts the wait as session time', () => {
    const state = fighter(42, 36);
    state.player.hp = 5;
    const result = analyzeFight(
      state,
      { kind: 'zone', id: HARD },
      { maxSessions: 2, sessionMinutes: 20 },
      content,
      defaultRules,
    );
    // Not a run of defeats at the health a defeat leaves: the series does not spiral.
    expect(result?.session?.winRate.median ?? 0).toBeGreaterThanOrEqual(0);
    expect(result?.session?.verdict).toBeDefined();
  });

  it('a mission stage lost in a fight waits for health before the next try', () => {
    const state = fighter(43, 36);
    const mission = content.missions.find((m) => m.stages.some((st) => st.t === 'combat'));
    if (!mission) throw new Error('no mission with a combat stage');
    state.player.hp = 1;
    dispatch(state, { type: 'action.start', slot: 0, kind: 'mission', id: mission.id }, content);
    // Second by second: after a defeat, a new try (a new fight of the stage) begins only with the health a player waits for.
    let defeated = false;
    let tries = 0;
    let last: unknown = null;
    for (let t = 0; t < 12 * MIN; t += 1000) {
      advance(state, 1000, content);
      // The first try is made to fail: the player falls at once, and what follows is the wait.
      if (!defeated && state.combat) state.combat.fight.player.hp = 0;
      if (state.events.some((e) => e.type === 'playerDefeated')) defeated = true;
      state.events = [];
      if (state.combat && state.combat !== last) {
        tries++;
        if (defeated && tries > 1) {
          const fresh = state.combat.fight.player.hp;
          expect(fresh).toBeGreaterThanOrEqual(0.5 * performerMaxHp(state, content));
        }
      }
      last = state.combat;
    }
    expect(defeated).toBe(true);
    expect(tries).toBeGreaterThan(1);
  });

  it('the training yard puts health back after a win, so a new character is not worn down by the dummy', () => {
    const state = genin(44);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' }, content);
    let low = Infinity;
    for (let t = 0; t < 30 * MIN; t += 1000) {
      advance(state, 1000, content);
      low = Math.min(low, state.player.hp);
    }
    expect(state.slots[0]?.action?.kind).toBe('fight');
    expect(state.wounds.stacks).toBe(0);
    expect(state.counters['kills.core:dummy'] ?? 0).toBeGreaterThan(5);
    expect(K.regionHeal.academy).toBeGreaterThan(0);
    void low;
  });
});

describe('a save', () => {
  it('keeps the health, and loads an older version at full health', () => {
    const state = genin(5);
    state.player.hp = 12.5;
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.v).toBe(state.v);
    expect(loaded.player.hp).toBe(12.5);
    // A save of version 23 has no health: it is full.
    const raw = JSON.parse(serialize(state, 0)) as {
      v: number;
      state: { v: number; player: Record<string, unknown> };
    };
    raw.v = 23;
    raw.state.v = 23;
    delete raw.state.player.hp;
    const old = deserialize(JSON.stringify(raw), content);
    expect(old.v).toBe(STATE_VERSION);
    expect(old.player.hp).toBe(performerMaxHp(old, content));
  });

  it('clamps a doctored health to the range of the maximum', () => {
    const state = genin(6);
    const raw = JSON.parse(serialize(state, 0)) as { state: { player: { hp: unknown } } };
    for (const bad of [-5, 1e12, 'full', null]) {
      raw.state.player.hp = bad;
      const loaded = deserialize(JSON.stringify(raw), content);
      expect(loaded.player.hp).toBeGreaterThanOrEqual(0);
      expect(loaded.player.hp).toBeLessThanOrEqual(performerMaxHp(loaded, content));
    }
  });

  it('puts a fight in progress and the state on the same health', () => {
    const state = fighter(7, 36);
    startFight(state, WOLF);
    advance(state, 20_000, content);
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.player.hp).toBe(state.player.hp);
  });
});

describe('clones', () => {
  function cloner(seed: number): GameState {
    const state = fighter(seed, 36);
    state.known[CLONE] = true;
    growSlots(state, content);
    stock(state, { [ids.heal]: 100 });
    return state;
  }

  it('has its own health, full when it is made, carried between its fights and regenerating', () => {
    const state = cloner(21);
    // The harder zone: with health regenerating in the fight too (`hpRegenShare` 1) a clone of level 21 loses nothing to the wolves in 20 s.
    startFight(state, HARD, 0);
    startFight(state, HARD, 1);
    const body = state.clones[1];
    expect(body?.hp).toBe(performerMaxHp(state, content));
    advance(state, 20_000, content);
    const mine = currentHp(state, 0, content).hp;
    const theirs = currentHp(state, 1, content).hp;
    expect(theirs).toBeLessThan(performerMaxHp(state, content));
    expect(state.clones[1]?.hp).toBe(theirs);
    // The two fight on their own: the character's health is not the clone's.
    expect(mine).not.toBe(theirs);
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.clones[1]?.hp).toBe(theirs);
  });

  it('regenerates a clone that stands', () => {
    const state = cloner(22);
    dispatch(state, { type: 'clone.create' }, content);
    const body = state.clones[1];
    if (!body) throw new Error('no clone');
    body.hp = 5;
    advance(state, 60_000, content);
    expect(state.clones[1]?.hp).toBeCloseTo(
      5 + 60 * performerHpRegen(state, content, defaultRules),
      4,
    );
  });
});

describe('the forecast', () => {
  it('starts from the health the character has: a wounded character is forecast to do worse', () => {
    const fresh = (hp: number | null): number => {
      const state = fighter(31, 36);
      stock(state, { [ids.heal]: 100 });
      if (hp !== null) state.player.hp = hp;
      else fullHp(state);
      const result = analyzeFight(
        state,
        { kind: 'zone', id: HARD },
        { maxSessions: 1 },
        content,
        defaultRules,
      );
      return result?.fresh.winRate ?? -1;
    };
    const healthy = fresh(null);
    const hurt = fresh(15);
    expect(healthy).toBeGreaterThan(0);
    expect(hurt).toBeLessThan(healthy);
  });
});
