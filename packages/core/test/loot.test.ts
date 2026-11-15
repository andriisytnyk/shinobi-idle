/** A3 and A9: loot, bounties, operation rewards; none on defeat or timeout; the dice and the chunks. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  grantLoot,
  noteFight,
  rollLoot,
  serialize,
  unlockBoss,
  type GameState,
} from '../src/index.ts';
import { K } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, startFight, startOperation, stock, unlock } from './prep-state.ts';

const N = 20_000;
const everyone = [...content.enemies, ...content.bosses];

/** Standard error of a rate. */
const se = (p: number): number => Math.sqrt((p * (1 - p)) / N);

describe('A3: what a win pays matches the content data', () => {
  for (const [at, entry] of everyone.entries()) {
    it(`${entry.id}: ryo, trophies and parts over ${N} wins`, () => {
      const state = createState(100 + at, content);
      let ryo = 0;
      const items: Record<string, number> = {};
      for (let i = 0; i < N; i++) {
        const loot = rollLoot(state, entry);
        expect(loot.ryo).toBeGreaterThanOrEqual(entry.ryo[0]);
        expect(loot.ryo).toBeLessThanOrEqual(entry.ryo[1]);
        ryo += loot.ryo;
        for (const [id, n] of Object.entries(loot.items)) items[id] = (items[id] ?? 0) + n;
      }
      const [low, high] = entry.ryo;
      const width = high - low + 1;
      const sd = Math.sqrt((width * width - 1) / 12);
      expect(Math.abs(ryo / N - (low + high) / 2)).toBeLessThanOrEqual(
        (3 * sd) / Math.sqrt(N) + 1e-9,
      );
      for (const drop of entry.drops) {
        expect(
          Math.abs((items[drop.item] ?? 0) / N - drop.chance),
          `${drop.item} rate`,
        ).toBeLessThanOrEqual(3 * se(drop.chance));
      }
      const part = entry.scrollPart;
      if (part && 'chance' in part) {
        expect(Math.abs((items[part.item] ?? 0) / N - part.chance)).toBeLessThanOrEqual(
          3 * se(part.chance),
        );
      } else if (part) {
        // A boss pays its parts in a fixed count, every time.
        expect(items[part.item]).toBe(part.count * N);
      }
      // Nothing else drops.
      const known = new Set([...entry.drops.map((d) => d.item), part?.item]);
      for (const id of Object.keys(items)) expect(known.has(id), id).toBe(true);
    });
  }

  it('pays the bounty once in full, then at the repeat share', () => {
    const boss = content.bosses.find((b) => b.bounty !== null);
    if (!boss?.bounty) throw new Error('no boss with a bounty');
    const state = createState(2, content);
    const first = rollLoot(state, boss);
    expect(first.bounty).toBe(boss.bounty.first);
    noteFight(state, boss.id, 'win', content);
    const again = rollLoot(state, boss);
    expect(again.bounty).toBe(Math.round(boss.bounty.first * K.bountyRepeat));
    noteFight(state, boss.id, 'win', content);
    expect(rollLoot(state, boss).bounty).toBe(again.bounty);
    // An enemy with no bounty pays none.
    const plain = content.enemies[1];
    if (!plain) throw new Error('no enemy');
    expect(rollLoot(state, plain).bounty).toBe(0);
  });

  it('pays the bounty to the purse and records it in the book through a real boss fight', () => {
    const state = fighter(3, 50, 'katon');
    setLevel(state, 'futon', 50);
    expect(unlockBoss(state, 'core:boss_wolf', content)).toBe(true);
    const bounty = content.bosses.find((b) => b.id === 'core:boss_wolf')?.bounty;
    expect(startFight(state, 'core:zone_boss_wolf')).toEqual({ ok: true });
    const ryo0 = state.currencies.intel + state.currencies.ryo;
    let paid = 0;
    for (let t = 0; t < 600_000 && paid === 0; t += 500) {
      for (const e of state.combat?.fight.enemies ?? []) e.hp = Math.min(e.hp, 1);
      advance(state, 500, content);
      const loot = state.events.find((e) => e.type === 'loot');
      if (loot?.type === 'loot') paid = loot.ryo + loot.bounty;
    }
    expect(paid).toBeGreaterThan(0);
    expect(state.currencies.ryo).toBe(paid);
    expect(ryo0).toBe(0);
    const loot = state.events.find((e) => e.type === 'loot');
    expect(loot?.type === 'loot' && loot.bounty).toBe(bounty?.first);
    expect(state.bingo['core:boss_wolf']?.wins).toBeGreaterThanOrEqual(1);
  });

  it('pays nothing on a defeat or a timeout, and a fled enemy pays like a win', () => {
    // Defeat: a weak genin against the hardest zone.
    const weak = fighter(4, 5, 'katon');
    stock(weak, {});
    weak.flags['region.exam.unlocked'] = true;
    startFight(weak, 'core:zone_foreign_genin');
    advance(weak, 10 * 60_000, content);
    expect(weak.events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(weak.events.some((e) => e.type === 'loot')).toBe(false);
    expect(weak.currencies.ryo).toBe(0);
    expect(Object.keys(weak.bank).filter((id) => id !== ids.medpouch)).toEqual([]);
    // Timeout: an enemy that cannot be hurt.
    const state = fighter(5, 36, 'katon');
    startFight(state, 'core:zone_kiri_hunter');
    for (const e of state.combat?.fight.enemies ?? []) {
      e.hp = e.maxHp = 1e12;
      e.timer.need = 1e18;
    }
    if (state.combat) state.combat.fight.player.hp = state.combat.fight.player.maxHp = 1e12;
    advance(state, K.combat.fightCapMs + 5000, content);
    expect(state.bingo['core:kiri_hunter']?.timeouts).toBeGreaterThanOrEqual(1);
    expect(state.events.some((e) => e.type === 'loot')).toBe(false);
    expect(state.currencies.ryo).toBe(0);
    // Fled: the Nameless leaves at a share of health, and that is a win for the loot.
    const boss = fighter(6, 50, 'katon');
    setLevel(boss, 'futon', 50);
    unlockBoss(boss, 'core:boss_nameless', content);
    startFight(boss, 'core:zone_boss_nameless');
    for (let t = 0; t < 600_000 && !boss.events.some((e) => e.type === 'loot'); t += 250) {
      for (const e of boss.combat?.fight.enemies ?? []) e.hp = Math.min(e.hp, e.maxHp * 0.2);
      advance(boss, 250, content);
    }
    expect(boss.events.some((e) => e.type === 'loot')).toBe(true);
    expect(boss.bingo['core:boss_nameless']?.wins).toBeGreaterThanOrEqual(1);
  });

  it('draws on the loot stream only: the same fights come out with the loot dice changed', () => {
    const run = (seedLoot: number): string => {
      const state = fighter(7, 50, 'katon');
      state.rng.loot = [seedLoot, 2, 3, 4];
      startFight(state, 'core:zone_wolf');
      advance(state, 30 * 60_000, content);
      return JSON.stringify([state.rng.combat, state.counters, state.skills, state.wounds]);
    };
    expect(run(1)).toBe(run(99));
  });

  it('puts the loot in the bank and tells the UI', () => {
    const state = createState(8, content);
    const wolf = content.enemies.find((e) => e.id === 'core:wolf');
    if (!wolf) throw new Error('no wolf');
    grantLoot(state, wolf.id, { ryo: 12, bounty: 3, items: { 'core:pelt': 2 } });
    expect(state.currencies.ryo).toBe(15);
    expect(state.bank['core:pelt']).toBe(2);
    expect(state.events.at(-1)).toMatchObject({ type: 'loot', enemy: wolf.id, ryo: 12, bounty: 3 });
  });
});

describe('operation rewards', () => {
  const hideout = content.operations.find((o) => o.id === 'core:op_hideout');

  function strong(seed: number): GameState {
    const state = fighter(seed, 50, 'katon');
    setLevel(state, 'futon', 50);
    unlock(state, 'op.hideout.unlocked');
    stock(state, { [ids.heal]: 8 });
    return state;
  }

  function clear(state: GameState): void {
    startOperation(state, 'core:op_hideout');
    for (let t = 0; t < 3_600_000 && state.slots[0]?.action; t += 500) {
      for (const e of state.combat?.fight.enemies ?? []) e.hp = Math.min(e.hp, 1);
      advance(state, 500, content);
    }
  }

  it('has the rewards of the hideout in the data: 1500 ryo and 40 reputation first, scroll parts after', () => {
    expect(hideout?.rewards?.first).toMatchObject({ ryo: 1500, rep: 40 });
    expect(hideout?.rewards?.repeat.parts.map((p) => p.technique)).toEqual(['core:water_prison']);
    expect(content.operations.find((o) => o.id === 'core:op_forest_of_death')?.rewards).toBeNull();
  });

  it('pays the first clear once, and the repeat share (parts only) afterwards', () => {
    const state = strong(1);
    const ryo0 = state.currencies.ryo;
    clear(state);
    expect(state.flags['op.hideout.cleared']).toBe(true);
    const paid = state.events.find((e) => e.type === 'operationPaid');
    expect(paid).toMatchObject({ op: 'core:op_hideout', first: true, ryo: 1500, rep: 40 });
    expect(state.currencies.rep).toBe(40);
    // The fights of the run paid their own loot besides the 1500.
    expect(state.currencies.ryo).toBeGreaterThanOrEqual(ryo0 + 1500);
    state.events = [];
    let parts = 0;
    for (let i = 0; i < 12; i++) {
      state.events = [];
      clear(state);
      const again = state.events.find((e) => e.type === 'operationPaid');
      expect(again).toMatchObject({ first: false, ryo: 0, rep: 0 });
      parts += state.bank['core:scrollpart_water_prison'] ?? 0;
    }
    // The twins pay no part, the mist boss pays two each win: the repeat chance adds on top.
    expect(state.currencies.rep).toBe(40);
    expect(parts).toBeGreaterThan(12);
  });

  it('pays nothing for a run that ends in defeat', () => {
    const state = fighter(2, 10, 'katon');
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    advance(state, 20 * 60_000, content);
    expect(state.flags['op.hideout.cleared']).toBeUndefined();
    expect(state.events.some((e) => e.type === 'operationPaid')).toBe(false);
    expect(state.currencies.rep).toBe(0);
  });
});

describe('A9: the chunks do not matter', () => {
  const CHUNKS = [1, 7, 999, 3600];
  const TOTAL = 6 * 60_000;

  function scenario(kind: 'zone' | 'operation', shares: 1000 | 500): GameState {
    const state = fighter(11, 50, 'katon');
    setLevel(state, 'futon', 50);
    stock(state, { [ids.heal]: 8 });
    if (shares === 500) {
      state.slots.push({ action: null, progress: 0, share: 1000, data: null });
      state.slots[1] = { action: null, progress: 0, share: 1000, data: null };
    }
    if (kind === 'operation') {
      unlock(state, 'op.hideout.unlocked');
      startOperation(state, 'core:op_hideout');
    } else {
      startFight(state, 'core:zone_wolf');
    }
    if (shares === 500) {
      // A drill in the second slot halves the share of the fight.
      const drill = content.exercises[0];
      if (!drill) throw new Error('no exercise');
      state.slots[1] = {
        action: { kind: 'drill', id: drill.id },
        progress: 0,
        share: 500,
        data: null,
      };
      if (state.slots[0]) state.slots[0].share = 500;
    }
    return state;
  }

  for (const kind of ['zone', 'operation'] as const) {
    for (const shares of [1000, 500] as const) {
      it(`${kind}, share ${shares}: any chunking gives the same state, loot and rewards included`, () => {
        const whole = scenario(kind, shares);
        advance(whole, TOTAL, content);
        const expected = serialize(whole, 0);
        for (const chunk of CHUNKS) {
          const state = scenario(kind, shares);
          for (let t = 0; t < TOTAL; t += chunk)
            advance(state, Math.min(chunk, TOTAL - t), content);
          expect(serialize(state, 0), `chunk ${chunk}`).toBe(expected);
        }
        expect(whole.currencies.ryo).toBeGreaterThan(0);
        expect(Object.keys(whole.report).length).toBeGreaterThan(0);
      });
    }
  }
});
