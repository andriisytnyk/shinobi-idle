/**
 * Defence is one automatic roll: the attacker's accuracy against the defender's evasion, where the
 * evasion has no skill term. Defensive techniques are passive and add to it by their mastery.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createFight,
  createState,
  deserialize,
  encounterFor,
  evasionOf,
  evasionParts,
  fightAdvance,
  fightStatus,
  hitChanceOf,
  makeCtx,
  playerEvasionParts,
  serialize,
  type PlayerSnapshot,
} from '../src/index.ts';
import { K, castSeq, enemyAt, quiet, rules, scripted, sec, withAi } from './fight-helpers.ts';
import { modContent, modRules } from './packs-helpers.ts';

const CLONE = 'core:clone';
const WALL = 'core:earth_style_wall';

const snap = (known: string[], mastery: Record<string, number> = {}, tier = 1): PlayerSnapshot => ({
  ...scripted(known),
  mastery: Object.fromEntries(known.map((id) => [id, mastery[id] ?? 1])),
  tier,
});

describe('the evasion rating of the player', () => {
  it('is the base, a term per rank, and every known defensive technique, with no skill term', () => {
    const parts = evasionParts(snap([CLONE, WALL]), content);
    expect(parts.map((p) => p.source)).toEqual(['base', 'tier', 'technique', 'technique']);
    expect(parts[0]?.value).toBe(K.evaBase);
    expect(parts[1]?.value).toBe(K.rating.evaTier);
    expect(parts.filter((p) => p.source === 'technique').map((p) => p.id)).toEqual([CLONE, WALL]);
    // Skill levels change nothing: the same rating at level 1 and at level 50.
    const low = evasionOf({ ...snap([CLONE]) }, content);
    const high = evasionOf(
      { ...snap([CLONE]), levels: { ...scripted([]).levels, tai: 50, nin: 50 } } as PlayerSnapshot,
      content,
    );
    expect(high).toBe(low);
  });

  it('grows with the mastery of each technique: the share for knowing it at mastery 1, all of it at the cap', () => {
    const value = (mastery: number) =>
      evasionParts(snap([CLONE], { [CLONE]: mastery }), content).find((p) => p.id === CLONE)
        ?.value ?? 0;
    const row = K.passiveFx.decoy;
    if (!row) throw new Error('no row');
    expect(value(1)).toBeCloseTo(row.evasion * row.base, 9);
    expect(value(K.masteryCap)).toBeCloseTo(row.evasion, 9);
    expect(value(50)).toBeGreaterThan(value(10));
    expect(value(10)).toBeGreaterThan(value(1));
  });

  it('adds up: every known defensive technique counts', () => {
    const one = evasionOf(snap([CLONE]), content);
    const two = evasionOf(snap([CLONE, WALL]), content);
    expect(two).toBeGreaterThan(one);
    expect(evasionOf(snap([]), content)).toBeLessThan(one);
  });

  it('counts the evasion modifiers of gear and the like over the rest, as a part of their own', () => {
    const parts = evasionParts({ ...snap([CLONE]), evasionMod: 1.1 }, content);
    const sum = parts.filter((p) => p.source !== 'modifiers').reduce((n, p) => n + p.value, 0);
    expect(parts.find((p) => p.source === 'modifiers')?.value).toBeCloseTo(sum * 0.1, 9);
  });

  it('reaches the fight as the evasion of the player, parts and total, in the fight view', () => {
    const fight = createFight(snap([CLONE]), enemyAt(10), 1, content, rules);
    const view = fightStatus(fight, content, rules).player.evasion;
    // Against the first enemy: the rating of the player with every defensive technique weighed by its skill level against the enemy's level.
    const sum = (view?.parts ?? []).reduce((n, p) => n + p.value, 0);
    expect(view?.total).toBeCloseTo(sum, 9);
    expect(view?.parts.find((p) => p.source === 'technique')?.levelAdj).toBeDefined();
    expect(view?.parts.map((p) => p.source)).toEqual(['base', 'tier', 'technique']);
  });

  it('can be read from a game state with its sources', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    state.known[CLONE] = true;
    const parts = playerEvasionParts(state, content);
    expect(parts.some((p) => p.id === CLONE)).toBe(true);
  });
});

describe('one roll: accuracy against evasion, with a term per rank tier', () => {
  it('gives the attacker an accuracy term per tier, for the player and for an enemy', () => {
    const accuracy = (tier: number) =>
      createFight({ ...scripted([]), tier }, enemyAt(10), 1, content, rules).player.accuracy;
    expect(accuracy(2) - accuracy(0)).toBeCloseTo(2 * K.rating.accTier, 9);
    const enemy = (cl: number) =>
      createFight(scripted([]), enemyAt(cl), 1, content, rules).enemies[0];
    const chunin = content.ai.tiers.find((t) => t.id === 'chunin');
    const genin = content.ai.tiers.find((t) => t.id === 'genin');
    const from = K.ai.enemyTier.chunin ?? 0;
    expect((enemy(from)?.accuracy ?? 0) - (enemy(from - 1)?.accuracy ?? 0)).toBeCloseTo(
      K.eAcc[1] + ((chunin?.minTier ?? 0) - (genin?.minTier ?? 0)) * K.rating.enemyAccTier,
      9,
    );
  });

  it('is easier to hit for a player who knows the enemy less: knowledge adds to the evasion', () => {
    const level = (n: number) => {
      const fight = createFight(
        { ...scripted([]), knowledgeLevel: { 'core:test': n } },
        enemyAt(20),
        1,
        content,
        rules,
      );
      const enemy = fight.enemies[0];
      if (!enemy) throw new Error('no enemy');
      return hitChanceOf(makeCtx(fight, content, rules), enemy, fight.player);
    };
    expect(level(0)).toBeGreaterThan(level(1));
    expect(level(1)).toBeGreaterThan(level(3));
    // An enemy the snapshot says nothing of is known completely.
    const fight = createFight(scripted([]), enemyAt(20), 1, content, rules);
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    expect(hitChanceOf(makeCtx(fight, content, rules), enemy, fight.player)).toBeCloseTo(
      level(3),
      12,
    );
  });

  it('puts no defensive technique into the hand and gives no ward or decoy in response to anything', () => {
    const fight = quiet(createFight(snap([CLONE, WALL]), enemyAt(20), 1, content, rules));
    expect(fight.kit.techniques).toHaveLength(0);
    fightAdvance(fight, sec(30), content, rules);
    expect(fight.player.ward).toBe(0);
    expect(fight.player.decoys).toBe(0);
  });
});

describe('what avoided an attack', () => {
  const missesOf = (known: string[], mastery: Record<string, number>) => {
    const via: Record<string, number> = {};
    let none = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const fight = quiet(createFight(snap(known, mastery), enemyAt(30), seed, content, rules));
      fight.player.hp = fight.player.maxHp = 1e12;
      fight.player.evasion = 1e6;
      fight.log = [];
      fightAdvance(fight, sec(30), content, rules);
      for (const line of fight.log ?? []) {
        if (line.side !== 'enemy' || line.act !== 'miss') continue;
        if (line.via === undefined) none++;
        else via[line.via] = (via[line.via] ?? 0) + 1;
      }
    }
    return { via, none };
  };

  it('names a defensive technique the player knows, in proportion to what each adds', () => {
    const { via, none } = missesOf([CLONE, WALL], { [CLONE]: 1, [WALL]: K.masteryCap });
    expect(none).toBe(0);
    expect(Object.keys(via).sort()).toEqual([CLONE, WALL].sort());
    // The wall at the cap adds more than the clone at mastery 1, so it does more of it.
    expect(via[WALL] ?? 0).toBeGreaterThan(via[CLONE] ?? 0);
  });

  it('names none for a player who knows none', () => {
    const { via, none } = missesOf([], {});
    expect(Object.keys(via)).toEqual([]);
    expect(none).toBeGreaterThan(0);
  });

  it('is recorded as the last action of the enemy, with the avoided outcome', () => {
    const fight = quiet(createFight(snap([CLONE]), enemyAt(30), 3, content, rules));
    fight.player.evasion = 1e6;
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    fightAdvance(fight, sec(5), content, rules);
    expect(enemy.last).toMatchObject({ kind: 'attack', outcome: 'miss', avoidedBy: CLONE });
    expect(fightStatus(fight, content, rules).enemies[0]?.last?.avoidedBy).toBe(CLONE);
  });
});

describe('loadouts without defensive techniques', () => {
  it('frees the slot of a defensive technique in a saved loadout on load', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    state.known[CLONE] = true;
    state.known['core:leaf_whirlwind'] = true;
    const raw = JSON.parse(serialize(state, 0)) as {
      state: {
        loadouts: { active: string[]; auto: boolean; saved: Record<string, unknown> };
      };
    };
    raw.state.loadouts.auto = false;
    raw.state.loadouts.active = [CLONE, 'core:leaf_whirlwind'];
    raw.state.loadouts.saved = {
      mine: { techniques: [CLONE, 'core:leaf_whirlwind'], signature: CLONE },
    };
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.loadouts.active).toEqual(['core:leaf_whirlwind']);
    expect(loaded.loadouts.saved.mine).toEqual({
      techniques: ['core:leaf_whirlwind'],
      signature: null,
    });
  });
});

describe('a pack in the new loop: a passive technique, a cast of its own, an interrupting attack', () => {
  const veil = 'testmod:glass_veil';
  const touch = 'testmod:aether_touch';
  const shatter = 'testmod:shatter_pulse';
  const modSnap = (known: string[]): PlayerSnapshot => ({
    ...snap(known, {}, 3),
    natures: ['testmod:aether'],
  });

  it('adds the evasion its own row names, scaled by mastery, and is never in the kit', () => {
    const parts = evasionParts(modSnap([veil]), modContent);
    const row = modContent.balance.K.passiveFx['testmod:veil'];
    expect(parts.find((p) => p.id === veil)?.value).toBeCloseTo(
      (row?.evasion ?? 0) * (row?.base ?? 0),
      9,
    );
    const fight = createFight(modSnap([veil, touch]), enemyAt(5), 1, modContent, modRules);
    expect(fight.kit.techniques.map((t) => t.id)).toEqual([touch]);
  });

  it('casts for its own number, whatever its seals', () => {
    const tech = modContent.techniques.find((t) => t.id === touch);
    expect(tech?.cast).toBe(3);
    const fight = createFight(modSnap([touch]), enemyAt(5), 1, modContent, modRules);
    expect(fight.kit.techniques[0]?.castMs).toBeGreaterThan(2500);
  });

  it('breaks a cast with an attack that carries the interrupt tag (the heavy blow of the test boss)', () => {
    const boss = modContent.bosses.find((b) => b.id === 'testmod:boss_shell');
    if (!boss) throw new Error('no boss');
    const r = withAi(castSeq(touch), modRules);
    const fight = createFight(modSnap([touch]), encounterFor(boss, modContent), 2, modContent, r);
    quiet(fight);
    fight.player.hp = fight.player.maxHp = 1e12;
    fight.player.evasion = 0;
    const body = fight.enemies[0];
    if (!body) throw new Error('no body');
    body.accuracy = 1e9;
    // The next attack of the boss is its heavy one.
    body.data['testmod.attacks'] = 2;
    fight.log = [];
    fightAdvance(fight, sec(3), content, r);
    const broken = (fight.log ?? []).filter((l) => l.act === 'interrupted' && l.side === 'player');
    expect(broken.length).toBe(1);
    expect(fight.tally.uses[touch]).toBeUndefined();
  });

  it('breaks the wind-up of an enemy that the attack with the interrupt tag hits', () => {
    expect(modContent.techniques.find((t) => t.id === shatter)?.tags).toContain('interrupt');
    const r = withAi(castSeq(shatter), modRules);
    const fight = createFight(modSnap([shatter]), enemyAt(10, ['caster']), 1, modContent, r);
    quiet(fight);
    fight.player.accuracy = 1e9;
    const body = fight.enemies[0];
    if (!body) throw new Error('no body');
    body.evasion = 0;
    body.timer.need = 1e15;
    const caster = body.timers.caster;
    if (!caster) throw new Error('no caster timer');
    // The wind-up is under way when the player decides.
    caster.progress = caster.need - sec(0.1) * 1000;
    fightAdvance(fight, sec(2.5), content, r);
    expect(fight.tally.interrupts).toBe(1);
    expect(body.data['caster.cast']).toBe(0);
  });
});

describe('a bonus the pouch carries for the evasion', () => {
  const smoke = 'core:dymova_bomba';

  it('is thrown by the AI when it is not active and something can hit, and renewed when it ends', () => {
    const fight = quiet(
      createFight(
        { ...scripted([]), pouch: [{ id: smoke, n: 10 }] },
        enemyAt(20),
        1,
        content,
        rules,
      ),
    );
    fight.player.hp = fight.player.maxHp = 1e12;
    let seen = 0;
    for (let i = 0; i < 400 && fight.result === 'ongoing'; i++) {
      fightAdvance(fight, sec(0.1), content, rules);
      if (fight.player.effects.some((e) => e.id === 'bomb.evasion')) seen++;
    }
    const used = 10 - (fight.pouch[0]?.n ?? 10);
    expect(used).toBeGreaterThan(3);
    // Never thrown on top of itself: one throw covers its own three seconds.
    expect(used).toBeLessThanOrEqual(Math.ceil(40 / 3) + 1);
    expect(seen).toBeGreaterThan(100);
  });
});
