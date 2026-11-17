/** Save version 16: the Evasion skill is gone from the game, and a v15 save loses its entries and keeps the rest. */
import { readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, createState, deserialize, serialize, STATE_VERSION } from '../src/index.ts';

describe('migration v15 -> v16', () => {
  it('drops the XP and pool entries of the removed Evasion skill and nothing else', () => {
    const state = createState(1, content);
    state.skills.tai = { xp: 1234 };
    state.pools.tai = { xp: 77 };
    const raw = JSON.parse(serialize(state, 0)) as {
      v: number;
      state: { v: number; skills: Record<string, unknown>; pools: Record<string, unknown> };
    };
    raw.v = 15;
    raw.state.v = 15;
    raw.state.skills.eva = { xp: 999 };
    raw.state.pools.eva = { xp: 50 };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(Object.keys(loaded.skills)).not.toContain('eva');
    expect(Object.keys(loaded.pools)).not.toContain('eva');
    expect(loaded.skills.tai?.xp).toBe(1234);
    expect(loaded.pools.tai?.xp).toBe(77);
    expect(content.skills).toHaveLength(15);
  });
});

/**
 * Real version 15 saves, recorded by dev code (`origin/dev` at 99929cb, before the fight loop changed): a small
 * script run from a throwaway worktree of that commit (`fighter`/`ableFor` from the test helpers, `action.start`,
 * `advance`, `serialize`) wrote `fixtures/v15-real-saves.json`, with what the dev state said at the moment of
 * saving next to each save. The cases: a zone fight, an operation between its stages and two
 * missions with a combat stage after a ration was spent. `dev` holds what the dev state said when saving.
 * What the migration keeps: the action in its slot, a mission's run (stage, attempts, the plan and the
 * ration share already taken), the ration charges, the bank, an operation's step. What restarts: the fight
 * of the stage (a new one with full pools); an operation's approach would be walked again.
 */
describe('migration v15 -> v16 of real saves recorded on dev', () => {
  interface Dev {
    action: { id: string; kind: string };
    data: { s: number; a: number; r: number; f: number; tk: unknown[] } | null;
    progress: number;
    buffs: Record<string, { charges: number }>;
    bank: Record<string, number>;
    combatEnemy: string | null;
    combatOwner: number | null;
  }
  const recorded = JSON.parse(
    readFileSync(new URL('./fixtures/v15-real-saves.json', import.meta.url), 'utf8'),
  ) as Record<string, { save: string; dev: Dev }>;
  const load = (name: string) => {
    const rec = recorded[name];
    if (!rec) throw new Error(`no record ${name}`);
    expect((JSON.parse(rec.save) as { v: number }).v).toBe(15);
    return { rec, state: deserialize(rec.save, content) };
  };

  for (const id of ['core:thief', 'core:caravan']) {
    it(`${id}: a mission in its fight stage loads in the same stage, no ration lost`, () => {
      const { rec, state } = load(`mission:${id}`);
      expect(state.slots[0]?.action).toEqual(rec.dev.action);
      const run = state.slots[0]?.data as unknown as NonNullable<Dev['data']>;
      expect(run.s).toBe(rec.dev.data?.s);
      expect(run.s).toBeGreaterThanOrEqual(1);
      expect(run.a).toBe(rec.dev.data?.a);
      expect(run.r).toBe(rec.dev.data?.r);
      expect(run.f).toBe(1);
      expect(state.buffs).toEqual(rec.dev.buffs);
      expect(state.buffs['core:sushenyi_paiok']?.charges).toBe(1);
      // The fight of the stage starts afresh, in the same place.
      expect(state.combat?.enemy).toBe(rec.dev.combatEnemy);
      expect(state.combat?.owner).toBe(0);
      expect(state.combat?.phase).toBe('fight');
      expect(state.bank).toEqual(rec.dev.bank);
    });

    it(`${id}: the loaded mission plays on to its end and pays`, () => {
      const { state } = load(`mission:${id}`);
      const done = () => state.counters[`missions.done.${id}`] ?? 0;
      for (let t = 0; t < 3 * 3_600_000 && done() === 0; t += 1000) advance(state, 1000, content);
      expect(done()).toBeGreaterThan(0);
    });
  }

  it('an operation between its stages goes on from the same step', () => {
    const { rec, state } = load('operationSecondStage');
    expect(state.slots[0]?.action).toEqual(rec.dev.action);
    expect(rec.dev.combatEnemy).toBe('core:boss_twins');
    expect(state.combat?.run?.step).toBe(2);
    expect(state.combat?.enemy).toBe('core:boss_twins');
    expect(state.combat?.phase).toBe('fight');
  });

  it('a zone fight starts a fresh fight of the same enemy in its slot', () => {
    const { rec, state } = load('zoneFight');
    expect(state.slots[0]?.action).toEqual(rec.dev.action);
    expect(state.combat?.owner).toBe(0);
    expect(state.combat?.enemy).toBe('core:bandit');
    expect(state.bank).toEqual(rec.dev.bank);
    expect(state.wounds.stacks).toBe(0);
    advance(state, 60_000, content);
    expect(state.counters['kills.core:bandit'] ?? 0).toBeGreaterThan(0);
  });
});
