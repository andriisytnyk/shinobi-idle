/** A8: zones, operations, unlock flags and the way a run goes. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  approachMs,
  createFight,
  encounterFor,
  fightAdvance,
  opSteps,
  setFlag,
  defaultRules,
  workOf,
  type GameState,
} from '../src/index.ts';
import { K, rules, sec } from './fight-helpers.ts';
import { playerFor } from './prep-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, run, startFight, startOperation, stock, unlock } from './prep-state.ts';
import { dispatch } from '../src/index.ts';

const op = (id: string) => {
  const o = content.operations.find((x) => x.id === id);
  if (!o) throw new Error(`no operation ${id}`);
  return o;
};

/** A strong genin for the operations. */
function strong(seed = 1): GameState {
  const state = fighter(seed, 50, 'katon');
  setLevel(state, 'futon', 50);
  return state;
}

/** Makes every enemy of the running fight nearly dead, so a run goes through quickly. */
function weaken(state: GameState): void {
  const c = state.combat;
  if (c?.phase !== 'fight') return;
  for (const e of c.fight.enemies) e.hp = Math.min(e.hp, 1);
}

/** Runs an operation to its end with the enemies weakened; returns the enemies fought, in order. */
function runThrough(state: GameState, limitMs = 3_600_000): string[] {
  const order: string[] = [];
  for (let t = 0; t < limitMs && state.slots[0]?.action; t += 500) {
    weaken(state);
    advance(state, 500, content);
    const enemy = state.combat?.enemy;
    if (enemy && order[order.length - 1] !== enemy) order.push(enemy);
  }
  return order;
}

describe('zones', () => {
  it('open the region zones from the rank the balance extension names, until real flags exist', () => {
    expect(K.regionZones.openFromRank).toBe('genin');
    const student = fighter(1, 10);
    student.player.rank = 'student';
    expect(startFight(student, 'core:zone_bandit')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    const genin = fighter(1, 10);
    expect(startFight(genin, 'core:zone_bandit')).toEqual({ ok: true });
    expect(genin.combat?.enemy).toBe('core:bandit');
    // The Academy yard is always open.
    expect(startFight(student, 'core:zone_dummy')).toEqual({ ok: true });
  });

  it('go back to their region flags when the switch is turned off', () => {
    const off = {
      ...content,
      balance: { ...content.balance, K: { ...K, regionZones: { openFromRank: 'off' as const } } },
    };
    const state = fighter(1, 10);
    const open = () =>
      dispatch(
        state,
        { type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_bandit' },
        off,
      );
    expect(open()).toEqual({ ok: false, reason: 'error.requirementsNotMet' });
    setFlag(state, 'region.forest.unlocked');
    expect(open()).toEqual({ ok: true });
  });

  it('open a boss only with its flag, which a core function raises', () => {
    const state = fighter(1, 30);
    expect(startFight(state, 'core:zone_boss_wolf')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    setFlag(state, 'boss.wolf.unlocked');
    expect(startFight(state, 'core:zone_boss_wolf')).toEqual({ ok: true });
    expect(state.combat?.enemy).toBe('core:boss_wolf');
    expect(state.combat?.fight.encounter.spawns.length).toBe(2);
    // Boss kills count like any other.
    expect(state.slots[0]?.action).toEqual({ kind: 'fight', id: 'core:zone_boss_wolf' });
  });

  it('send the same enemy again and again, with the player recovering between the fights', () => {
    const state = fighter(2, 40);
    startFight(state, 'core:zone_dummy');
    const player = state.combat?.fight.player;
    if (!player) throw new Error('no fight');
    player.hp = player.maxHp * 0.3;
    player.chakra = 0;
    player.stamina = 0;
    weaken(state);
    advance(state, 2000, content);
    const c = state.combat;
    expect(c?.phase).toBe('respawn');
    const p = c?.fight.player;
    expect(p?.chakra).toBe(p?.maxChakra);
    expect(p?.stamina).toBe(p?.maxStamina);
    expect(p?.hp).toBeGreaterThan((p?.maxHp ?? 0) * Math.min(1, 0.3 + K.zoneHpRegen) - 20);
    advance(state, 60_000, content);
    expect(state.combat?.enemy).toBe('core:dummy');
    expect(state.counters['kills.core:dummy']).toBeGreaterThan(1);
  });
});

describe('the hideout', () => {
  it('needs its unlock flag', () => {
    const state = strong();
    expect(startOperation(state, 'core:op_hideout')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    unlock(state, 'op.hideout.unlocked');
    expect(startOperation(state, 'core:op_hideout')).toEqual({ ok: true });
  });

  it('begins with the approach, shorter for a good scout', () => {
    const state = strong();
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    expect(state.combat?.phase).toBe('approach');
    expect(state.combat?.pause).toBe(workOf(K.operation.approachMs));
    expect(state.combat?.enemy).toBe('core:guard_pack');
    expect(state.combat?.fight.t).toBe(0);

    const scout = strong(2);
    setLevel(scout, 'scout', 20);
    expect(approachMs(scout, op('core:op_hideout'), content)).toBe(
      Math.round(K.operation.approachMs * K.operation.approachShort),
    );
  });

  it('runs the stages in order: the guards, the twins, the mist fugitive', () => {
    const state = strong(3);
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    expect(runThrough(state)).toEqual(['core:guard_pack', 'core:boss_twins', 'core:boss_mist']);
    expect(state.slots[0]?.action).toBeNull();
    for (const id of ['guard_pack', 'boss_twins', 'boss_mist']) {
      expect(state.counters[`kills.core:${id}`]).toBe(1);
    }
  });

  it('sets the first-clear flag and sends the event the rewards hang on, the first time only', () => {
    const state = strong(4);
    unlock(state, 'op.hideout.unlocked');
    const cleared = op('core:op_hideout').clearFlag;
    expect(state.flags[cleared]).toBeUndefined();
    startOperation(state, 'core:op_hideout');
    runThrough(state);
    expect(state.flags[cleared]).toBe(true);
    const done = state.events.filter((e) => e.type === 'operationCleared');
    expect(done).toEqual([expect.objectContaining({ op: 'core:op_hideout', first: true })]);
    const stopped = state.events.filter((e) => e.type === 'actionStopped').pop();
    expect(stopped).toMatchObject({ reason: 'finished', kind: 'operation' });
    state.events = [];
    startOperation(state, 'core:op_hideout');
    runThrough(state);
    expect(state.events.filter((e) => e.type === 'operationCleared')).toEqual([
      expect.objectContaining({ first: false }),
    ]);
    expect(state.counters['ops.core:op_hideout']).toBe(2);
  });

  it('gives back only a share of health and the pools between its fights, not the full recovery of a zone', () => {
    const state = strong(5);
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    advance(state, workOf(K.operation.approachMs) / 1000 + 100, content);
    const player = state.combat?.fight.player;
    expect(state.combat?.phase).toBe('fight');
    if (!player) throw new Error('no fight');
    player.hp = player.maxHp * 0.3;
    player.chakra = player.maxChakra * 0.1;
    player.stamina = player.maxStamina * 0.1;
    // The pools regenerate a little in the instants before the fight is over.
    for (let i = 0; i < 100 && state.combat?.phase === 'fight'; i++) {
      weaken(state);
      advance(state, 100, content);
    }
    const c = state.combat;
    expect(c?.phase).toBe('respawn');
    const p = c?.fight.player;
    if (!p) throw new Error('no fight');
    const share = K.opRegen;
    expect(p.chakra).toBeGreaterThan(p.maxChakra * 0.1 - 5);
    expect(p.chakra).toBeLessThan(p.maxChakra * (0.1 + share) + 15);
    expect(p.stamina).toBeLessThan(p.maxStamina * (0.1 + share) + 15);
    expect(p.hp).toBeLessThan(p.maxHp * (0.3 + share) + 40);
    expect(p.hp).toBeLessThan(p.maxHp);
    expect(c?.enemy).toBe('core:boss_twins');
  });

  it('is reset by a defeat: the action ends, nothing is cleared, a new run starts from the approach', () => {
    const state = fighter(6, 6);
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    for (let i = 0; i < 900 && state.slots[0]?.action; i++) advance(state, 1000, content);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.combat).toBeNull();
    expect(state.events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(state.flags[op('core:op_hideout').clearFlag]).toBeUndefined();
    expect(state.wounds.stacks).toBeGreaterThan(0);
    startOperation(state, 'core:op_hideout');
    expect(state.combat?.phase).toBe('approach');
    expect(state.combat?.run).toEqual({ op: 'core:op_hideout', step: 1 });
  });

  it('is reset by stopping it, and another fight replaces it', () => {
    const state = strong(7);
    unlock(state, 'op.hideout.unlocked');
    startOperation(state, 'core:op_hideout');
    advance(state, 1000, content);
    run(state, { type: 'action.stop', slot: 0 });
    expect(state.combat).toBeNull();
    startOperation(state, 'core:op_hideout');
    startFight(state, 'core:zone_dummy');
    expect(state.combat?.run).toBeNull();
    expect(state.slots[0]?.action?.kind).toBe('fight');
  });
});

describe('the Forest of Death', () => {
  const forest = op('core:op_forest_of_death');

  it('is five days of three fights from the exam enemies, ending with the Nameless', () => {
    const steps = opSteps(forest);
    expect(steps).toHaveLength(5 * 3 + 1);
    expect(steps.slice(0, 15).every((s) => s.t === 'draw')).toBe(true);
    expect(steps[15]).toEqual({ t: 'fight', enemy: 'core:boss_nameless' });
  });

  it('draws each day fight from the pool on the combat stream and is the same for the same seed', () => {
    const order = (seed: number): string[] => {
      const state = strong(seed);
      unlock(state, 'op.forest_of_death.unlocked');
      expect(startOperation(state, 'core:op_forest_of_death')).toEqual({ ok: true });
      const fought: string[] = [];
      for (let t = 0; t < 3_600_000 && state.slots[0]?.action; t += 500) {
        weaken(state);
        advance(state, 500, content);
        const c = state.combat;
        if (c?.phase === 'fight' && c.fight.t === 0) fought.push(c.enemy);
        if (c?.phase === 'respawn' && fought[fought.length - 1] !== c.enemy) fought.push(c.enemy);
      }
      expect(state.flags[forest.clearFlag]).toBe(true);
      return fought;
    };
    const a = order(1);
    const pool = forest.stages[0]?.t === 'days' ? forest.stages[0].pool : [];
    expect(a.length).toBeGreaterThanOrEqual(8);
    for (const id of a.slice(0, -1)) expect([...pool, 'core:boss_nameless']).toContain(id);
    expect(a[a.length - 1]).toBe('core:boss_nameless');
    expect(order(1)).toEqual(a);
    expect(new Set(a.slice(0, 15)).size).toBeGreaterThan(1);
  });

  it('ends when the Nameless flees at the threshold, which counts as the completion', () => {
    const state = strong(9);
    unlock(state, 'op.forest_of_death.unlocked');
    startOperation(state, 'core:op_forest_of_death');
    const nameless = content.bosses.find((b) => b.id === 'core:boss_nameless');
    if (!nameless) throw new Error('no boss');
    // Go to the last step directly: weaken everything on the way.
    runThroughUntil(
      state,
      (s) => s.combat?.enemy === 'core:boss_nameless' && s.combat.phase === 'fight',
    );
    const body = state.combat?.fight.enemies[0];
    if (!body) throw new Error('no body');
    expect(body.fleeAt).toBe(K.bossFx.illusion.fleeAtHp);
    body.hp = body.maxHp * (K.bossFx.illusion.fleeAtHp + 0.001);
    for (let i = 0; i < 600 && state.slots[0]?.action; i++) advance(state, 500, content);
    expect(state.combat).toBeNull();
    expect(state.flags[forest.clearFlag]).toBe(true);
    expect(state.counters['kills.core:boss_nameless']).toBe(1);
    expect(state.events.some((e) => e.type === 'playerDefeated')).toBe(false);
  });

  it('is won as a fled fight by the engine: the result is fled, not a victory', () => {
    const snap = playerFor(nameless(), 'katon', { prep: 'prepared', tier: 2 });
    let fled = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const fight = createFight(snap, encounterFor(nameless(), content), seed, content, rules);
      fightAdvance(fight, sec(K.combat.fightCapMs / 1000), content, rules);
      if (fight.result === 'fled') fled++;
    }
    expect(fled).toBeGreaterThan(10);
  });
});

function nameless() {
  const b = content.bosses.find((x) => x.id === 'core:boss_nameless');
  if (!b) throw new Error('no boss');
  return b;
}

function runThroughUntil(state: GameState, done: (s: GameState) => boolean): void {
  for (let t = 0; t < 3_600_000 && !done(state) && state.slots[0]?.action; t += 500) {
    weaken(state);
    advance(state, 500, content);
  }
}

void [ids, stock, defaultRules];
