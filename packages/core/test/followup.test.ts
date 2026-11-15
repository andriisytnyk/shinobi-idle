/** Follow-ups: gating by enemy id, the burn ointment, the non-native cast penalty, the auto-attack rule. */
import { content, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createFight,
  defaultCombatAi,
  dispatch,
  fightAdvance,
  findEffect,
  nonNativeLevel,
  techniqueFigures,
  type FightView,
  type PlayerSnapshot,
} from '../src/index.ts';
import { K, enemyAt, quiet, rules, scripted, sec, withAi } from './fight-helpers.ts';
import { fighter, ids, startFight, unlock } from './prep-state.ts';

describe('fighting by a raw enemy id respects the gating of its zone', () => {
  it('refuses a student the enemies of the forest, and a boss needs its flag', () => {
    const student = fighter(1, 10);
    student.player.rank = 'student';
    expect(startFight(student, 'core:bandit')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    expect(startFight(student, 'core:dummy')).toEqual({ ok: true });
    const genin = fighter(1, 10);
    expect(startFight(genin, 'core:bandit')).toEqual({ ok: true });
    // A boss has no raw id: only its zone, which its flag opens.
    expect(startFight(genin, 'core:boss_wolf').ok).toBe(false);
    expect(startFight(genin, 'core:zone_boss_wolf')).toEqual({
      ok: false,
      reason: 'error.requirementsNotMet',
    });
    unlock(genin, 'boss.wolf.unlocked');
    expect(startFight(genin, 'core:zone_boss_wolf')).toEqual({ ok: true });
  });

  it('follows the switch of the balance extension that turns the region zones back to their flags', () => {
    const off = {
      ...content,
      balance: { ...content.balance, K: { ...K, regionZones: { openFromRank: 'off' as const } } },
    };
    const state = fighter(2, 10);
    const open = () =>
      dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:bandit' }, off);
    expect(open()).toEqual({ ok: false, reason: 'error.requirementsNotMet' });
    unlock(state, 'region.forest.unlocked');
    expect(open()).toEqual({ ok: true });
  });
});

describe('the burn ointment', () => {
  it('hardens the skin against the nature it names for a while, as a damage-taken modifier', () => {
    const snap: PlayerSnapshot = {
      ...scripted(['core:leaf_whirlwind']),
      pouch: [{ id: ids.burnOintment, n: 2 }],
    };
    const fight = createFight(
      snap,
      enemyAt(20, [], 'katon'),
      3,
      content,
      withAi(() => ({ type: 'item', id: ids.burnOintment })),
    );
    quiet(fight);
    fight.player.hp = fight.player.maxHp = 1e9;
    fightAdvance(
      fight,
      sec(1),
      content,
      withAi(() => ({ type: 'item', id: ids.burnOintment })),
    );
    const resist = findEffect(fight.player, 'resist');
    expect(resist).toMatchObject({ kind: 'modifier', nature: 'katon', value: K.toolFx.resist });
    expect(fight.pouch[0]?.n).toBeLessThan(2);
  });

  it('cuts the damage of a Katon enemy by the configured factor, and no other', () => {
    const taken = (nature: NatureId, resist: boolean) => {
      const fight = createFight(
        scripted([]),
        enemyAt(20, [], nature),
        5,
        content,
        withAi(() => ({ type: 'wait' })),
      );
      fight.player.hp = fight.player.maxHp = 1e9;
      fight.player.evasion = 0;
      if (resist) {
        fight.player.effects.push({
          kind: 'modifier',
          id: 'resist',
          src: 'x',
          until: null,
          stat: 'resist',
          op: 'mul',
          value: K.toolFx.resist,
          nature: 'katon',
        });
      }
      fightAdvance(
        fight,
        sec(30),
        content,
        withAi(() => ({ type: 'wait' })),
      );
      return fight.tally.taken;
    };
    expect(taken('katon', true) / taken('katon', false)).toBeCloseTo(K.toolFx.resist, 9);
    expect(taken('suiton', true)).toBe(taken('suiton', false));
  });
});

describe('the non-native cast penalty applies in fights', () => {
  const levels = scripted([]).levels;
  const figures = (natures: NatureId[], id: string) => {
    const tech = content.techniques.find((t) => t.id === id);
    if (!tech) throw new Error(id);
    return techniqueFigures(
      {
        levels: { ...levels, katon: 20 },
        mastery: {},
        costMod: { chakra: 1, stamina: 1 },
        natures,
      },
      tech,
      content,
    );
  };

  it('stretches the cast of a technique of a nature that is not the native one', () => {
    const native = figures(['katon'], 'core:great_fireball').castMs;
    const foreign = figures(['futon'], 'core:great_fireball').castMs;
    expect(nonNativeLevel('katon', ['futon'], 20)).toBe(20);
    expect(foreign).toBeGreaterThan(native);
    // Taijutsu and Ninjutsu are no nature: no stretch whoever the native one is.
    expect(figures(['futon'], 'core:leaf_whirlwind').castMs).toBe(
      figures(['katon'], 'core:leaf_whirlwind').castMs,
    );
    // A player with no nature has nothing to be foreign to.
    expect(figures([], 'core:great_fireball').castMs).toBe(native);
  });

  it('reaches the kit of the fight', () => {
    const kit = (natures: NatureId[]) =>
      createFight({ ...scripted(['core:great_fireball']), natures }, enemyAt(20), 1, content, rules)
        .kit.techniques[0]?.castMs ?? 0;
    expect(kit(['futon'])).toBeGreaterThan(kit(['katon']));
  });
});

describe('the basic attack is an auto-attack on its own timer', () => {
  it('lands every interval and never delays a cast', () => {
    const tech = 'core:dynamic_entry';
    const starts: number[] = [];
    const basics: number[] = [];
    const ai = withAi((view: FightView) => {
      const d = defaultCombatAi(view);
      if (d.type === 'technique') starts.push(view.t);
      if (d.type === 'basic') basics.push(view.t);
      return d;
    }, rules);
    const fight = createFight(scripted([tech]), enemyAt(20), 2, content, ai);
    quiet(fight);
    fight.player.damage = 1;
    fightAdvance(fight, sec(100), content, ai);
    const t = fight.kit.techniques[0];
    if (!t) throw new Error('no technique');
    // Casts are exactly one cast plus one cooldown apart: the basic attacks never held one back.
    const gaps = starts.slice(1).map((s, i) => s - (starts[i] ?? 0));
    expect(gaps.length).toBeGreaterThan(5);
    for (const gap of gaps) expect(gap).toBe(sec((t.castMs + t.cooldownMs) / 1000));
    // The attacks that landed are one interval apart, casts or no casts in between.
    const landed = basics.filter(
      (_, i) => i === 0 || (basics[i] ?? 0) - (basics[i - 1] ?? 0) >= sec(K.basicInterval),
    );
    const spacing = landed.slice(1).map((b, i) => b - (landed[i] ?? 0));
    for (const gap of spacing) expect(gap).toBeGreaterThanOrEqual(sec(K.basicInterval));
    expect(fight.tally.basic).toBeGreaterThanOrEqual(Math.floor(100 / K.basicInterval) - 8);
    expect(fight.tally.basic).toBeLessThanOrEqual(Math.ceil(100 / K.basicInterval));
  });
});
