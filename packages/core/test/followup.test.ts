/** Follow-ups: gating by enemy id, the burn ointment, the non-native cast penalty, the auto-attack rule. */
import { content, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createFight,
  createState,
  defaultCombatAi,
  advance,
  deserialize,
  dispatch,
  knowledgeOf,
  refreshUnlocks,
  serialize,
  xpAt,
  fightAdvance,
  findEffect,
  nonNativeLevel,
  techniqueFigures,
  type FightView,
  type PlayerSnapshot,
} from '../src/index.ts';
import { K, enemyAt, quiet, rules, scripted, sec, withAi } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { fighter, ids, startFight, stock, unlock } from './prep-state.ts';

describe('fighting by a raw enemy id respects the gating of its zone', () => {
  it('refuses a student the enemies of the forest, and a boss needs its flag', () => {
    const student = fighter(1, 10);
    student.player.rank = 'student';
    student.flags = {};
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

  it('opens a region enemy by its id only with its region flag', () => {
    const state = fighter(2, 10);
    state.flags = {};
    const open = () => startFight(state, 'core:marauder');
    expect(open()).toEqual({ ok: false, reason: 'error.requirementsNotMet' });
    unlock(state, 'region.plains.unlocked');
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
    // The wait, then the item's own action time, then the effect.
    fightAdvance(
      fight,
      sec(2),
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
    expect(nonNativeLevel('katon', ['futon'], 20, content)).toBe(20);
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

describe('the basic strike is an action of its own', () => {
  it('is struck only when the player decides, and never while a technique is cast', () => {
    const tech = 'core:dynamic_entry';
    const starts: number[] = [];
    const decisions: number[] = [];
    const ai = withAi((view: FightView) => {
      const d = defaultCombatAi(view);
      decisions.push(view.t);
      if (d.type === 'technique') starts.push(view.t);
      return d;
    }, rules);
    const fight = createFight(scripted([tech]), enemyAt(20), 2, content, ai);
    quiet(fight);
    fight.player.damage = 1;
    fightAdvance(fight, sec(100), content, ai);
    const t = fight.kit.techniques[0];
    if (!t) throw new Error('no technique');
    // A technique is cast again no sooner than one cast plus one cooldown after it began.
    const gaps = starts.slice(1).map((s, i) => s - (starts[i] ?? 0));
    expect(gaps.length).toBeGreaterThan(3);
    for (const gap of gaps)
      expect(gap).toBeGreaterThanOrEqual(sec((t.castMs + t.cooldownMs) / 1000));
    // Every decision comes at the end of a wait: one wait at least apart, since an action fills the time between.
    const apart = decisions.slice(1).map((d, i) => d - (decisions[i] ?? 0));
    for (const gap of apart) expect(gap).toBeGreaterThanOrEqual(sec(fight.player.waitMs / 1000));
    expect(fight.tally.basic).toBeGreaterThan(5);
  });
});

describe('the auto-loadout and the signature', () => {
  it('never drops the signature, even when another nature is far stronger', () => {
    const state = fighter(3, 40, 'katon');
    setLevel(state, 'futon', 50);
    setLevel(state, 'katon', 31);
    refreshUnlocks(state, content, true);
    const sig = 'core:great_fireball';
    state.mastery[sig] = { xp: xpAt(K.signature.minMastery) };
    state.loadouts.auto = false;
    state.loadouts.active = [sig, 'core:leaf_whirlwind'];
    state.loadouts.signature = sig;
    dispatch(state, { type: 'loadout.auto', on: true }, content);
    expect(state.loadouts.active).toContain(sig);
    expect(state.loadouts.signature).toBe(sig);
    // The one nature of the loadout is the signature's.
    const natures = state.loadouts.active
      .map((id) => content.techniques.find((t) => t.id === id)?.skill)
      .filter((s) => s === 'katon' || s === 'futon');
    expect(new Set(natures)).toEqual(new Set(['katon']));
  });

  it('never takes a stance or a technique that needs one, however high Taijutsu stands', () => {
    const state = fighter(4, 50, 'katon');
    state.known['core:front_lotus'] = true;
    state.loadouts.basis = '';
    dispatch(state, { type: 'loadout.auto', on: true }, content);
    for (const id of state.loadouts.active) {
      const t = content.techniques.find((x) => x.id === id);
      expect(t?.combat?.effect.kind, id).not.toBe('stance');
      expect(t?.combat?.requiresStance ?? false, id).toBe(false);
    }
    // A hand-made loadout may still take them.
    expect(
      dispatch(
        state,
        { type: 'loadout.set', techniques: ['core:gate_of_opening', 'core:front_lotus'] },
        content,
      ).ok,
    ).toBe(true);
  });
});

describe('the medic pouch and the pouch of a student', () => {
  it('comes with the graduation and is not for sale', () => {
    const exam = content.exams.find((e) => e.rank === 'genin');
    expect(exam?.rewards.items.some((i) => i.item === ids.medpouch)).toBe(true);
    expect(content.shop.some((s) => s.item === ids.medpouch)).toBe(false);
  });

  it('is given to the genin of an older save by the migration, and a student has no pouch', () => {
    const state = fighter(5, 20);
    const raw = JSON.parse(serialize(state, 0)) as { v: number; state: Record<string, unknown> };
    raw.v = 9;
    raw.state.v = 9;
    raw.state.bank = {};
    for (const key of ['loadouts', 'pouch', 'wounds', 'seen']) delete raw.state[key];
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.bank[ids.medpouch]).toBe(1);
    expect(loaded.pouch.slots).toHaveLength(K.pouch.slots);
    const student = createState(1, content);
    expect(student.pouch.slots).toHaveLength(0);
    expect(dispatch(student, { type: 'pouch.set', slot: 0, item: ids.kunai }, content).ok).toBe(
      false,
    );
  });
});

describe('names and loaded state are checked', () => {
  it('rejects names that are properties of every object', () => {
    const state = fighter(6, 20);
    for (const name of ['__proto__', 'constructor', 'toString']) {
      expect(dispatch(state, { type: 'loadout.save', name }, content)).toEqual({
        ok: false,
        reason: 'error.invalidName',
      });
    }
    expect(
      dispatch(state, { type: 'loadout.save', name: 'x'.repeat(K.loadout.nameMax + 1) }, content)
        .ok,
    ).toBe(false);
  });

  it('cuts a loaded loadout to the slots and natures of the rank and keeps out-of-loadout techniques out', () => {
    const state = fighter(7, 40, 'katon');
    setLevel(state, 'futon', 40);
    refreshUnlocks(state, content, true);
    const raw = JSON.parse(serialize(state, 0)) as { state: { loadouts: unknown } };
    raw.state.loadouts = {
      active: [
        'core:body_replacement',
        'core:leaf_whirlwind',
        'core:dynamic_entry',
        'core:leaf_gale',
        'core:great_fireball',
        'core:gale_palm',
        'core:shadow_shuriken',
      ],
      auto: false,
      signature: null,
      basis: '',
      saved: { __proto__x: { techniques: [], signature: null } },
    };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.loadouts.active).not.toContain('core:body_replacement');
    expect(loaded.loadouts.active.length).toBeLessThanOrEqual(K.loadout.slots.genin!);
    const natures = loaded.loadouts.active
      .map((id) => content.techniques.find((t) => t.id === id)?.skill)
      .filter((s) => s === 'katon' || s === 'futon');
    expect(new Set(natures).size).toBeLessThanOrEqual(K.loadout.natures.genin!);
  });
});

describe('a student and a genin against a locked zone', () => {
  it('refuses a student the zones of the world by their raw enemy ids', () => {
    for (const id of ['core:foreign_genin', 'core:tiger']) {
      const student = fighter(8, 10);
      student.player.rank = 'student';
      student.flags = {};
      expect(startFight(student, id), id).toEqual({
        ok: false,
        reason: 'error.requirementsNotMet',
      });
    }
  });

  it('refuses a genin a zone whose flag is not raised, by zone id and by enemy id', () => {
    const state = fighter(9, 20);
    state.flags = {};
    for (const id of ['core:zone_foreign_genin', 'core:foreign_genin', 'core:zone_boss_wolf']) {
      expect(startFight(state, id), id).toEqual({
        ok: false,
        reason: 'error.requirementsNotMet',
      });
    }
  });
});

describe('a stance-dependent signature', () => {
  const lotus = 'core:front_lotus';
  function withLotus() {
    const state = fighter(11, 50, 'katon');
    state.known[lotus] = true;
    state.mastery[lotus] = { xp: xpAt(K.signature.minMastery) };
    return state;
  }

  it('may be any known technique with Mastery 25, and the auto-loadout keeps it with the best stance', () => {
    const state = withLotus();
    expect(state.loadouts.auto).toBe(true);
    expect(dispatch(state, { type: 'loadout.signature', technique: lotus }, content)).toEqual({
      ok: true,
    });
    expect(state.loadouts.signature).toBe(lotus);
    expect(state.loadouts.active).toContain(lotus);
    expect(state.loadouts.active).toContain('core:gate_of_healing');
    expect(state.loadouts.active.length).toBeLessThanOrEqual(K.loadout.slots.genin!);
    // Turning the auto-loadout off and on again changes nothing about it.
    dispatch(state, { type: 'loadout.auto', on: false }, content);
    dispatch(state, { type: 'loadout.auto', on: true }, content);
    expect(state.loadouts.active).toContain(lotus);
    // Learning something new rebuilds around it too.
    state.loadouts.basis = '';
    refreshUnlocks(state, content, true);
    expect(state.loadouts.active).toContain(lotus);
  });

  it('keeps the invariant after every change: a signature that is set is in the loadout', () => {
    const state = withLotus();
    const holds = () => {
      const l = state.loadouts;
      if (l.signature !== null) expect(l.active).toContain(l.signature);
    };
    dispatch(state, { type: 'loadout.signature', technique: lotus }, content);
    holds();
    dispatch(state, { type: 'loadout.set', techniques: ['core:leaf_whirlwind'] }, content);
    holds();
    expect(state.loadouts.signature).toBeNull();
    // A manual loadout must hold the technique before it can be the signature.
    expect(dispatch(state, { type: 'loadout.signature', technique: lotus }, content)).toEqual({
      ok: false,
      reason: 'error.notInLoadout',
    });
    dispatch(state, { type: 'loadout.set', techniques: [lotus, 'core:gate_of_healing'] }, content);
    dispatch(state, { type: 'loadout.signature', technique: lotus }, content);
    holds();
    dispatch(state, { type: 'loadout.save', name: 'lotus' }, content);
    dispatch(state, { type: 'loadout.set', techniques: ['core:leaf_whirlwind'] }, content);
    dispatch(state, { type: 'loadout.load', name: 'lotus' }, content);
    holds();
    dispatch(state, { type: 'loadout.auto', on: true }, content);
    holds();
    const loaded = deserialize(serialize(state, 0), content);
    if (loaded.loadouts.signature !== null) {
      expect(loaded.loadouts.active).toContain(loaded.loadouts.signature);
    }
  });

  it('is not what the auto-loadout takes without it', () => {
    const state = withLotus();
    expect(state.loadouts.active).not.toContain(lotus);
    expect(state.loadouts.active).not.toContain('core:gate_of_healing');
  });
});

describe('junk commands never throw', () => {
  it('refuse a null-prototype name, a prototype kind and a string slot with a reason', () => {
    const state = fighter(12, 20);
    stock(state, { [ids.heal]: 4 });
    dispatch(state, { type: 'pouch.set', slot: 0, item: ids.heal }, content);
    const bare = Object.create(null) as string;
    const results = [
      dispatch(state, { type: 'loadout.load', name: bare }, content),
      dispatch(state, { type: 'loadout.delete', name: bare }, content),
      dispatch(state, { type: 'loadout.load', name: '__proto__' }, content),
      dispatch(state, { type: 'action.start', slot: 0, kind: '__proto__', id: 'x' }, content),
      dispatch(state, { type: 'action.start', slot: 0, kind: 'constructor', id: 'x' }, content),
      dispatch(state, { type: 'pouch.medic', slot: '0' as unknown as number }, content),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(typeof (r.ok ? '' : r.reason)).toBe('string');
    }
    expect(state.pouch.medic).toBeNull();
  });

  it('refuse a raw enemy id that belongs to no zone: a mission enemy is fought in its mission', () => {
    const state = fighter(13, 40);
    expect(startFight(state, 'core:thief')).toEqual({ ok: false, reason: 'error.unknownAction' });
  });
});

describe('what a fight to the time cap teaches', () => {
  /** Starts a fight with an enemy that cannot be beaten or hurt and watches it for `ms`. */
  function watched(ms: number) {
    const state = fighter(14, 36);
    startFight(state, 'core:zone_kiri_hunter');
    const fight = state.combat?.fight;
    if (!fight) throw new Error('no fight');
    for (const e of fight.enemies) {
      e.hp = e.maxHp = 1e12;
      e.timer.need = 1e18;
    }
    fight.player.hp = fight.player.maxHp = 1e12;
    advance(state, ms, content);
    return state;
  }

  it('is counted in the book, and teaches an ordinary enemy nothing without a win', () => {
    const state = watched(K.combat.fightCapMs + 5000);
    expect(state.bingo['core:kiri_hunter']?.timeouts).toBeGreaterThanOrEqual(1);
    expect(knowledgeOf(state, content, ['core:kiri_hunter'])['core:kiri_hunter']).toEqual([]);
  });

  it('teaches nothing new when the player stops within the first seconds', () => {
    const state = watched(5000);
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    expect(state.bingo['core:kiri_hunter']?.timeouts).toBe(0);
    expect(knowledgeOf(state, content, ['core:kiri_hunter'])['core:kiri_hunter']).toEqual([]);
  });
});
