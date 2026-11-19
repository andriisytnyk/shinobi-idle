/** A8: the battle report: counts, causes of defeat, the save, its size, the offline summary. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  advanceOffline,
  battleReport,
  deserialize,
  serialize,
  type GameState,
} from '../src/index.ts';
import { K } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, run, startFight, stock } from './prep-state.ts';

const BANDIT = 'core:zone_bandit';
const HARD = 'core:zone_foreign_genin';

/** Plays a zone for `ms`, restarting it after every defeat and keeping the heal item in stock. */
function grind(state: GameState, zone: string, ms: number): void {
  startFight(state, zone);
  for (let t = 0; t < ms; t += 60_000) {
    // The player is kept at the edge of defeat: under the new rules a character of this level no longer loses on its own.
    const me = state.combat?.fight.player;
    if (me) me.hp = Math.min(me.hp, 3);
    advance(state, 60_000, content);
    state.events = [];
    state.bank[ids.heal] = 400;
    if (!state.slots[0]?.action) startFight(state, zone);
  }
}

/** A scripted session: wins against the bandit, then a defeat against the hardest zone. */
function session(): GameState {
  const state = fighter(1, 40, 'katon');
  stock(state, { [ids.heal]: 8 });
  startFight(state, BANDIT);
  advance(state, 5 * 60_000, content);
  for (const skill of ['tai', 'nin', 'katon', 'vit'] as const) setLevel(state, skill, 3);
  state.flags['region.exam.unlocked'] = true;
  startFight(state, HARD);
  advance(state, 10 * 60_000, content);
  return state;
}

describe('the battle report of a session', () => {
  it('counts the fights of a target and what happened in them', () => {
    const state = session();
    const r = battleReport(state, BANDIT);
    expect(r.wins).toBeGreaterThan(10);
    expect(r.wins).toBe(state.bingo['core:bandit']?.wins);
    expect(r.wins).toBe(state.counters['kills.core:bandit']);
    expect(r.fights).toBe(r.wins + r.losses + r.timeouts);
    expect(r.losses).toBe(0);
    expect(r.winMs).toBeGreaterThan(0);
    expect(r.winMs).toBeLessThanOrEqual(r.allMs);
    expect(Object.values(r.damage).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(Object.keys(r.uses).length + r.basic).toBeGreaterThan(0);
    expect(r.loot.ryo).toBeGreaterThan(0);
    for (const mult of Object.values(r.habLow)) {
      expect(mult).toBeGreaterThan(0);
      expect(mult).toBeLessThanOrEqual(1);
    }
    expect(r.defeats).toEqual([]);
  });

  it('keeps the cause of a defeat: when, to whom, and what was left', () => {
    const state = session();
    const r = battleReport(state, HARD);
    expect(r.losses).toBe(1);
    expect(r.wins).toBe(0);
    expect(r.wounds).toBeGreaterThanOrEqual(1);
    expect(r.defeats).toHaveLength(1);
    const cause = r.defeats[0];
    expect(cause?.enemy).toBe('core:foreign_genin');
    expect(cause?.tMs).toBeGreaterThan(0);
    expect(cause?.at).toBeGreaterThan(5 * 60_000);
    expect(cause?.at).toBeLessThanOrEqual(state.now);
    expect(cause?.chakra).toBeGreaterThanOrEqual(0);
    expect(cause?.chakra).toBeLessThanOrEqual(100);
    expect(cause?.stamina).toBeLessThanOrEqual(100);
    expect(state.bingo['core:foreign_genin']?.losses).toBe(1);
    expect(battleReport(state, 'core:zone_wolf').fights).toBe(0);
  });

  it('counts the pouch units used', () => {
    const state = fighter(2, 9, 'katon');
    stock(state, { [ids.heal]: 400 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    run(state, { type: 'pouch.medic', slot: 0 });
    grind(state, 'core:zone_marauder', 30 * 60_000);
    const r = battleReport(state, 'core:zone_marauder');
    expect(r.items[ids.heal] ?? 0).toBeGreaterThan(0);
  });

  it('hands out a copy', () => {
    const state = session();
    const r = battleReport(state, BANDIT);
    r.wins = 0;
    r.damage['x'] = 1;
    expect(battleReport(state, BANDIT).wins).toBeGreaterThan(0);
    expect(battleReport(state, BANDIT).damage['x']).toBeUndefined();
  });

  it('survives a save and a load', () => {
    const state = session();
    const loaded = deserialize(serialize(state, 0), content);
    expect(loaded.report).toEqual(state.report);
    expect(serialize(loaded, 0)).toBe(serialize(state, 0));
    // A damaged report is cleaned, not trusted.
    const raw = JSON.parse(serialize(state, 0)) as { state: { report: Record<string, unknown> } };
    raw.state.report['core:ghost'] = { fights: 3 };
    raw.state.report[BANDIT] = { fights: 'many', wins: -4, defeats: [{ enemy: 5 }, null] };
    const doctored = deserialize(JSON.stringify(raw), content);
    expect(doctored.report['core:ghost']).toBeUndefined();
    expect(doctored.report[BANDIT]?.fights).toBe(0);
    expect(doctored.report[BANDIT]?.defeats).toEqual([]);
  });
});

describe('the size of the report', () => {
  it('stays under a cap after 12 game hours, and keeps only the latest defeats', () => {
    const state = fighter(3, 9, 'katon');
    stock(state, { [ids.heal]: 400 });
    run(state, { type: 'pouch.set', slot: 0, item: ids.heal });
    grind(state, 'core:zone_marauder', 12 * 3_600_000);
    const r = battleReport(state, 'core:zone_marauder');
    expect(r.fights).toBeGreaterThan(100);
    expect(r.losses).toBeGreaterThan(K.report.defeats);
    expect(r.defeats.length).toBeLessThanOrEqual(K.report.defeats);
    const bytes = JSON.stringify(state.report).length;
    console.log(
      `report after 12 game hours: ${bytes} bytes, ${r.fights} fights, ${r.losses} defeats`,
    );
    expect(bytes).toBeLessThan(6000);
  });
});

describe('the offline summary', () => {
  it('includes the report of the time away, and folds it into the running one', () => {
    const state = fighter(4, 40, 'katon');
    startFight(state, BANDIT);
    advance(state, 60_000, content);
    const before = battleReport(state, BANDIT).fights;
    const summary = advanceOffline(state, 3_600_000, content);
    const away = summary.reports[BANDIT];
    expect(away?.fights).toBeGreaterThan(100);
    expect(battleReport(state, BANDIT).fights).toBe(before + (away?.fights ?? 0));
    expect(away?.wins).toBe(away?.fights);
  });
});
