/**
 * T2: a pack adds a status, a combo, a trait with its answer, a nature and a boss special, and they
 * work in fights, in the battle analysis and in the Bingo book without a line of engine code. The
 * pack is `testmod` (composed with `core`); what it adds is data and one hook.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeFight,
  applyItem,
  applyStatusById,
  bingoLevel,
  bingoView,
  createFight,
  createState,
  fightAdvance,
  loadoutLimits,
  makeCtx,
  prepareFor,
  stat,
  wheelFactor,
  workOf,
  type Effect,
  type FightState,
  type GameState,
} from '../src/index.ts';
import {
  TECH,
  caster,
  core,
  encounter,
  landed,
  mod,
  modRules,
  pacify,
  player,
  quiet,
  runUntil,
  sec,
  withAi,
} from './combat-packs-helpers.ts';

const ext = (key: string): number => {
  const row = (mod.balance.K.ext as Record<string, Record<string, number>>).testmod;
  const value = row?.[key];
  if (value === undefined) throw new Error(`no K.ext.testmod.${key}`);
  return value;
};
const K = mod.balance.K;
const ctxOf = (fight: FightState) => makeCtx(fight, mod, modRules);
const find = (list: readonly Effect[], id: string) => list.find((e) => e.id === id);

describe('a status that a pack adds: damage over time and a stat modifier, stacking to two', () => {
  /** A fight with a body that has the status applied `times` times, for the status alone to play. */
  function chilled(times: number): FightState {
    const fight = pacify(
      quiet(createFight(player([]), encounter('testmod:shellback'), 1, mod, modRules)),
    );
    const body = fight.enemies[0];
    if (!body) throw new Error('no body');
    for (let i = 0; i < times; i++) {
      applyStatusById(ctxOf(fight), body, 'testmod:chill', 'tester');
    }
    return fight;
  }

  it('is put on the body that a technique of its state hits', () => {
    const fight = landed('testmod:shellback', TECH, 1);
    const body = fight.enemies[0];
    expect(find(body?.effects ?? [], 'testmod:chill')).toMatchObject({
      kind: 'periodic',
      stacks: 1,
    });
    expect(find(body?.effects ?? [], 'testmod:chill#1')).toMatchObject({
      kind: 'modifier',
      stat: 'speed',
    });
    expect(fight.tally.statuses['testmod:chill']).toBe(1);
  });

  it('ticks its damage every second, slows its holder and ends when its time is up', () => {
    const fight = chilled(1);
    const body = fight.enemies[0];
    if (!body) throw new Error('no body');
    const before = body.hp;
    expect(stat(ctxOf(fight), body, 'speed', 1000)).toBeCloseTo(1000 * ext('chillSlow'), 6);
    fightAdvance(fight, sec(1), mod, modRules);
    const tick = ext('chillDot') * body.maxHp;
    expect(before - body.hp).toBeCloseTo(tick, 3);
    expect(fight.tally.damage.tester).toBeCloseTo(tick, 3);
    // The whole duration: one tick for each second it lasts, then nothing is left of it.
    fightAdvance(fight, sec(ext('chillSecs') + 5), mod, modRules);
    expect(fight.tally.damage.tester).toBeCloseTo(tick * ext('chillSecs'), 3);
    expect(body.effects.filter((e) => e.id.startsWith('testmod:chill'))).toEqual([]);
  });

  it('stacks to two and no further, each stack adding its damage and its slowing', () => {
    const fight = chilled(2);
    const body = fight.enemies[0];
    if (!body) throw new Error('no body');
    expect(find(body.effects, 'testmod:chill')).toMatchObject({ stacks: 2 });
    expect(stat(ctxOf(fight), body, 'speed', 1000)).toBeCloseTo(1000 * ext('chillSlow') ** 2, 6);
    fightAdvance(fight, sec(1), mod, modRules);
    expect(fight.tally.damage.tester).toBeCloseTo(2 * ext('chillDot') * body.maxHp, 3);
    applyStatusById(ctxOf(fight), body, 'testmod:chill', 'tester');
    expect(find(body.effects, 'testmod:chill')).toMatchObject({ stacks: 2 });
    expect(body.effects.filter((e) => e.id.startsWith('testmod:chill'))).toHaveLength(2);
  });

  it('is cleansed by an item whose effect names it', () => {
    const fight = chilled(0);
    const target = fight.player;
    applyStatusById(ctxOf(fight), target, 'testmod:chill', 'tester');
    expect(target.effects.filter((e) => e.id.startsWith('testmod:chill'))).toHaveLength(2);
    expect(applyItem(ctxOf(fight), 'testmod:elixir')).toBe(true);
    expect(target.effects.filter((e) => e.id.startsWith('testmod:chill'))).toEqual([]);
  });
});

describe('a combo that a pack adds', () => {
  it('fires exactly when a technique of its nature hits a body that is in its state', () => {
    // No chill on the body yet: the first hit applies it and fires nothing.
    const first = landed('testmod:shellback', TECH, 1);
    expect(first.tally.combos['testmod:frostburn']).toBeUndefined();
    // With the chill already there, the same technique fires the combo and breaks the chill.
    const second = landed('testmod:shellback', TECH, 1, (f) => {
      const body = f.enemies[0];
      if (body) applyStatusById(ctxOf(f), body, 'testmod:chill', 'tester');
    });
    expect(second.tally.combos['testmod:frostburn']).toBe(1);
    expect(second.enemies[0]?.effects.filter((e) => e.id.startsWith('testmod:chill'))).toEqual([]);
  });

  it('does not fire for a technique of another nature', () => {
    const katon = core.techniques.find(
      (t) =>
        t.skill === 'katon' &&
        t.rank !== null &&
        t.level <= 40 &&
        !t.noDamage &&
        t.combat?.effect.kind === 'damage',
    );
    if (!katon) throw new Error('no katon technique');
    for (let seed = 1; seed < 100; seed++) {
      const rules = withAi(caster(katon.id));
      const fight = pacify(
        quiet(createFight(player([katon.id]), encounter('testmod:shellback'), seed, mod, rules)),
      );
      const body = fight.enemies[0];
      if (body) applyStatusById(ctxOf(fight), body, 'testmod:chill', 'tester');
      runUntil(fight, (f) => (f.tally.uses[katon.id] ?? 0) >= 1, rules);
      if ((fight.tally.damage[katon.id] ?? 0) > 0) {
        expect(fight.tally.combos).toEqual({});
        return;
      }
    }
    throw new Error('no seed lands the katon technique');
  });
});

describe('a trait that a pack adds', () => {
  it('changes the stats of its holder, until something stops it', () => {
    const fight = pacify(
      quiet(createFight(player([TECH]), encounter('testmod:shellback'), 1, mod, modRules)),
    );
    const body = fight.enemies[0];
    if (!body) throw new Error('no body');
    expect(stat(ctxOf(fight), body, 'damageTaken', 1)).toBeCloseTo(1 - ext('shellArmor'), 9);
    // The tag the pack defines cracks the shell: the trait stops and the body takes more.
    const hit = landed('testmod:shellback', TECH, 1);
    const cracked = hit.enemies[0];
    if (!cracked) throw new Error('no body');
    expect(find(cracked.effects, 'testmod:cracked')).toBeDefined();
    expect(stat(makeCtx(hit, mod, modRules), cracked, 'damageTaken', 1)).toBeCloseTo(
      ext('crackMult'),
      9,
    );
    expect(hit.tally.statuses['testmod:crackBreak']).toBe(1);
  });

  it('is answered by the auto-loadout and the pouch with the tag it names, from data', () => {
    const known = mod.techniques
      .filter(
        (t) =>
          t.rank !== null && t.level <= 40 && ['tai', 'nin', 'katon', 'futon'].includes(t.skill),
      )
      .map((t) => t.id);
    const snap = { ...player(known), tier: 2 };
    const limits = loadoutLimits(2, mod);
    const target = { traits: ['testmod:shelled'], nature: null };
    const plan = prepareFor(snap, limits, target, { 'core:tag': 5 }, 4, null, mod);
    const answer = mod.traits.find((t) => (t.id as string) === 'testmod:shelled')?.answer;
    expect(answer).toBe('area');
    expect(
      plan.techniques.some((id) =>
        mod.techniques.find((t) => t.id === id)?.tags.includes('area' as never),
      ),
    ).toBe(true);
    // The tool that carries the tag is in the pouch.
    expect(plan.pouch.map((p) => p.id)).toContain('core:tag');
    // A body without the trait asks for no such tool.
    const none = prepareFor(
      snap,
      limits,
      { traits: [], nature: null },
      { 'core:tag': 5 },
      4,
      null,
      mod,
    );
    expect(none.pouch.map((p) => p.id)).not.toContain('core:tag');
  });
});

describe('a nature that a pack adds', () => {
  it('is strong against one core nature and weak against another, and the multiplier applies both ways', () => {
    const wheel = K.wheel;
    // The test nature beats Katon ...
    expect(wheelFactor('testmod:aether', 'katon', mod)).toBeCloseTo(1 + wheel, 12);
    expect(wheelFactor('katon', 'testmod:aether', mod)).toBeCloseTo(1 - wheel, 12);
    // ... and Doton beats it (a patch of the pack to the core nature).
    expect(wheelFactor('doton', 'testmod:aether', mod)).toBeCloseTo(1 + wheel, 12);
    expect(wheelFactor('testmod:aether', 'doton', mod)).toBeCloseTo(1 - wheel, 12);
    // The core pack alone has no such nature, and the wheel is as it was.
    expect(wheelFactor('testmod:aether', 'katon', core)).toBe(1);
    expect(wheelFactor('katon', 'futon', core)).toBeCloseTo(1 + wheel, 12);
  });

  it('is the nature of the enemy that counters it in a wheel fight, first in the list that is strong against it', () => {
    const entry = { ...mod.enemies[0], id: 'core:test', nature: 'wheel' as const };
    const fight = createFight(
      { ...player([]), natures: ['testmod:aether' as never] },
      {
        ...encounter('testmod:shellback'),
        spawns: [
          { ...encounter('testmod:shellback').spawns[0]!, enemy: entry.id, nature: 'wheel' },
        ],
      },
      1,
      mod,
      modRules,
    );
    // Doton is the one nature of the list that beats the test nature.
    expect(fight.enemies[0]?.nature).toBe('doton');
  });
});

describe('a boss special that a pack adds, implemented by a hook of the pack', () => {
  const boss = 'testmod:boss_shell';

  /** The damage of each attack the boss makes, hit or miss (a miss is null), over a fixed time. */
  function attacks(seed: number, chunk?: number): (number | null)[] {
    const fight = createFight(player([]), encounter(boss), seed, mod, modRules);
    fight.player.hp = fight.player.maxHp = 1e9;
    fight.player.evasion = 0;
    fight.log = [];
    const total = sec(60);
    if (chunk === undefined) fightAdvance(fight, total, mod, modRules);
    else for (let t = 0; t < total; t += chunk) fightAdvance(fight, chunk, mod, modRules);
    return (fight.log ?? [])
      .filter((l) => l.side === 'enemy' && (l.act === 'hit' || l.act === 'miss'))
      .map((l) => (l.act === 'hit' ? l.dmg : null));
  }

  it('makes every third attack a heavy one, and only those', () => {
    const list = attacks(5);
    expect(list.length).toBeGreaterThanOrEqual(9);
    const mult = (K.bossFx as Record<string, Record<string, number>>)['testmod:third']?.mult ?? 0;
    const normal = list.find((d, i) => d !== null && (i + 1) % 3 !== 0);
    if (normal === undefined || normal === null) throw new Error('no normal hit');
    list.forEach((d, i) => {
      if (d === null) return;
      expect(d / normal).toBeCloseTo((i + 1) % 3 === 0 ? mult : 1, 6);
    });
    expect(list.some((d, i) => d !== null && (i + 1) % 3 === 0)).toBe(true);
  });

  it('is deterministic, and the same however the time is split', () => {
    expect(attacks(7)).toEqual(attacks(7));
    expect(attacks(7, sec(1) + 17)).toEqual(attacks(7));
  });

  it('is data to the encounter: the boss carries the hook that its special names', () => {
    const fight = createFight(player([]), encounter(boss), 1, mod, modRules);
    expect(fight.enemies[0]?.specials).toEqual(['testmod:thirdStrike']);
  });
});

describe('the battle analysis and the Bingo book with a pack enemy', () => {
  /** A genin who knows what a mod fight needs: levels of the skills and a few techniques. */
  function genin(): GameState {
    const state = createState(1, mod);
    state.player.rank = 'genin';
    state.player.natures = ['katon'];
    for (const skill of mod.skills) {
      const s = state.skills[skill.id];
      if (s) s.xp = 20_000;
    }
    for (const t of mod.techniques) {
      if (t.rank !== null && t.level <= 20 && ['tai', 'nin', 'katon'].includes(t.skill)) {
        state.known[t.id] = true;
      }
    }
    return state;
  }

  const target = { kind: 'boss', id: 'testmod:boss_shell' } as const;
  const opts = { seed: 3, samples: 12, minSessions: 3, maxSessions: 3 };

  it('hides the trait of a pack enemy until the player has beaten it, like any other trait', () => {
    const state = genin();
    expect(bingoLevel(state, 'testmod:shellback', mod)).toBe(0);
    const blind = analyzeFight(
      state,
      { kind: 'zone', id: 'testmod:shellback' },
      opts,
      mod,
      modRules,
    );
    expect(blind?.coverage.filter((c) => c.trait === 'testmod:shelled')).toEqual([]);
    expect(blind?.hiddenTraits).toBe(1);
    state.bingo['testmod:shellback'] = {
      seen: 1,
      wins: 1,
      losses: 0,
      timeouts: 0,
      bought: 0,
      bounty: 0,
    };
    const known = analyzeFight(
      state,
      { kind: 'zone', id: 'testmod:shellback' },
      opts,
      mod,
      modRules,
    );
    expect(known?.hiddenTraits).toBe(0);
    expect(known?.coverage.find((c) => c.trait === 'testmod:shelled')).toMatchObject({
      enemy: 'testmod:shellback',
    });
    // The book page says the same.
    expect(bingoView(state, 'testmod:shellback', mod)?.hiddenTraits).toEqual(['testmod:shelled']);
    state.bingo['testmod:shellback'] = {
      seen: 0,
      wins: 0,
      losses: 0,
      timeouts: 0,
      bought: 0,
      bounty: 0,
    };
    expect(bingoView(state, 'testmod:shellback', mod)?.hiddenTraits).toBeNull();
  });

  it('forecasts a boss of the pack, deterministically', () => {
    const state = genin();
    state.bingo['testmod:boss_shell'] = {
      seen: 1,
      wins: 1,
      losses: 0,
      timeouts: 0,
      bought: 0,
      bounty: 0,
    };
    const a = analyzeFight(state, target, opts, mod, modRules);
    const b = analyzeFight(state, target, opts, mod, modRules);
    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a?.fresh.winRate).toBeGreaterThanOrEqual(0);
    expect(workOf(1)).toBeGreaterThan(0);
  });
});
