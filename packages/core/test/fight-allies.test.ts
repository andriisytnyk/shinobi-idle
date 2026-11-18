/**
 * Allies in a fight: the player's side may hold more than one body. The combat clone technique puts
 * bodies on it; each has its own health, pools, phase, action and target, enemies choose among the
 * bodies of the side by a seeded weight, and the fight is lost only when the character falls.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  alliesOf,
  combatantStatus,
  createFight,
  deserialize,
  dealDamage,
  fightAdvance,
  fightNextEventIn,
  fightStatus,
  makeCtx,
  parseFight,
  serialize,
  simulateFights,
  workOf,
  type FightState,
} from '../src/index.ts';
import { K, castSeq, enemyAt, row, rules, scripted, sec, withAi } from './fight-helpers.ts';
import { fighter, run, startFight } from './prep-state.ts';

const CLONE = 'core:shadow_clone';
const DYNAMIC = 'core:dynamic_entry';
const GALE = 'core:leaf_gale';
const fxRow = row('techFx.combatClone');
const num = (key: string): number => {
  const v = fxRow[key];
  if (v === undefined) throw new Error(`no techFx.combatClone.${key}`);
  return v;
};
const fx = {
  count: num('count'),
  masteryStep: num('masteryStep'),
  max: num('max'),
  share: num('share'),
  hp: num('hp'),
  dmg: num('dmg'),
  threat: num('threat'),
  casts: num('casts'),
};

/** A fight where the character casts the combat clone technique as soon as the wait is over. */
function cloned(seed = 3, cl = 20) {
  const r = withAi(castSeq(CLONE, DYNAMIC, GALE));
  const fight = createFight(scripted([CLONE, DYNAMIC, GALE]), enemyAt(cl), seed, content, r);
  return { fight, r };
}

/** Runs until the clone technique has resolved. */
function summoned(seed = 3, cl = 20) {
  const { fight, r } = cloned(seed, cl);
  while ((fight.tally.uses[CLONE] ?? 0) < 1 && fight.result === 'ongoing') {
    fightAdvance(fight, fightNextEventIn(fight, content, r) ?? 1, content, r);
  }
  return { fight, r };
}

const living = (fight: FightState) => alliesOf(fight).filter((a) => a.hp > 0);

describe('the combat clone technique', () => {
  it('is a data effect of the technique, with its numbers in the balance object', () => {
    const t = content.techniques.find((x) => x.id === CLONE);
    expect(t?.combat?.effect).toEqual({ kind: 'summon', fx: 'combatClone' });
    const kit = createFight(scripted([CLONE]), enemyAt(10), 1, content, rules).kit;
    const own = kit.techniques.find((x) => x.id === CLONE);
    expect(own?.damage).toBe(0);
    expect(own?.fx.summon).toMatchObject({ max: fx.max, share: fx.share, hp: fx.hp });
  });

  it('puts the bodies on the character side: its share of the chakra is split, each has a share of its health', () => {
    const { fight } = summoned();
    const allies = alliesOf(fight);
    expect(allies).toHaveLength(fx.count);
    // The character gave `share` of what it had to the bodies, evenly.
    const held = allies.reduce((n, a) => n + a.chakra, 0);
    expect(held / (held + fight.player.chakra)).toBeCloseTo(fx.share, 1);
    expect(allies[0]?.chakra).toBeCloseTo(allies[1]?.chakra ?? 0, 6);
    for (const a of allies) {
      expect(a.side).toBe('player');
      expect(a.maxHp).toBeCloseTo(fight.player.maxHp * fx.hp, 6);
      expect(a.maxHp).toBeLessThan(fight.player.maxHp);
      expect(a.ally?.kind).toBe(CLONE);
    }
    expect(allies.map((a) => a.ally?.n)).toEqual([1, 2]);
    // The technique cannot be cast a second time in the fight, and the AI no longer asks for it.
    expect(fight.uses[CLONE]).toBe(1);
  });

  it('gives one more body for the Mastery the data names, never more than the cap', () => {
    const snap = (m: number) => ({ ...scripted([CLONE]), mastery: { [CLONE]: m } });
    const bodies = (m: number) =>
      createFight(snap(m), enemyAt(10), 1, content, rules).kit.techniques[0]?.fx.summon?.count;
    expect(bodies(1)).toBe(fx.count);
    expect(bodies(fx.masteryStep)).toBe(Math.min(fx.max, fx.count + 1));
    expect(bodies(99)).toBeLessThanOrEqual(fx.max);
  });
});

describe('allies act, are targeted, fall', () => {
  it('has every body wait, act and wait on its own, with its own cooldowns and last action', () => {
    const { fight, r } = summoned();
    const seen = new Set<string>();
    for (let i = 0; i < 400 && fight.result === 'ongoing'; i++) {
      fightAdvance(fight, fightNextEventIn(fight, content, r) ?? 1, content, r);
      if (fight.result !== 'ongoing') break;
      for (const a of living(fight)) {
        expect(['wait', 'act']).toContain(a.phase);
        expect(a.act === null).toBe(a.phase === 'wait');
        expect(a.timer.need).toBeGreaterThan(a.timer.progress);
        if (a.last) seen.add(a.id);
      }
    }
    // Every body acted, and the cooldown of one is not the other's.
    expect(seen.size).toBe(alliesOf(fight).length);
    const [a, b] = alliesOf(fight);
    expect(a?.id).not.toBe(b?.id);
  });

  it('names the acting body in the log and counts its work for the character', () => {
    const { fight, r } = summoned();
    fight.log = [];
    const usesBefore = Object.values(fight.tally.uses).reduce((n, x) => n + x, 0);
    fightAdvance(fight, sec(30), content, r);
    const lines = fight.log ?? [];
    const allyLines = lines.filter((l) => l.side === 'player' && l.ally !== undefined);
    expect(allyLines.length).toBeGreaterThan(0);
    for (const l of allyLines.filter((x) => x.act === 'cast' || x.act === 'resolve')) {
      expect(l.by).toMatch(/^ally#/);
    }
    // What the bodies cast goes into the character's tally.
    const usesAfter = Object.values(fight.tally.uses).reduce((n, x) => n + x, 0);
    expect(usesAfter).toBeGreaterThan(usesBefore);
    expect(Object.values(fight.tally.damage).reduce((n, x) => n + x, 0)).toBeGreaterThan(0);
  });

  it('lets the enemies choose among the living bodies, by weight, and not at all when none stands', () => {
    const { fight, r } = summoned();
    fight.player.hp = fight.player.maxHp = 1e9;
    for (const a of alliesOf(fight)) a.hp = a.maxHp = 1e9;
    fight.log = [];
    fightAdvance(fight, sec(120), content, r);
    const at = (fight.log ?? []).filter(
      (l) => l.side === 'enemy' && (l.act === 'hit' || l.act === 'miss'),
    );
    const onAllies = at.filter((l) => l.ally !== undefined).length;
    const onCharacter = at.length - onAllies;
    expect(onAllies).toBeGreaterThan(0);
    expect(onCharacter).toBeGreaterThan(0);
    // Two bodies of weight `threat` against the character's 1.
    const expected = (2 * fx.threat) / (1 + 2 * fx.threat);
    expect(onAllies / at.length).toBeGreaterThan(expected - 0.25);
    expect(onAllies / at.length).toBeLessThan(expected + 0.25);
  });

  it('dispels a body that falls: it does not come back, and its unspent chakra returns to the character', () => {
    const { fight, r } = summoned();
    const ctx = makeCtx(fight, content, r);
    const victim = alliesOf(fight)[0];
    if (!victim) throw new Error('no ally');
    const held = victim.chakra;
    const chakra = fight.player.chakra;
    fight.player.maxChakra = 1e9;
    dealDamage(ctx, victim, 1e9, 'test');
    expect(victim.hp).toBe(0);
    expect(victim.chakra).toBe(0);
    expect(fight.player.chakra).toBeCloseTo(chakra + held, 6);
    expect(fight.result).toBe('ongoing');
    // The other body goes on; the fallen one is not among the living, and never acts again.
    expect(living(fight).map((a) => a.id)).not.toContain(victim.id);
    fightAdvance(fight, sec(40), content, r);
    expect(victim.hp).toBe(0);
    expect(victim.phase).toBe('wait');
    expect(fight.uses[CLONE]).toBe(1);
    expect(alliesOf(fight)).toHaveLength(fx.count);
  });

  it('gives back what the living bodies hold when the fight ends', () => {
    const { fight, r } = summoned();
    const held = living(fight).reduce((n, a) => n + a.chakra, 0);
    expect(held).toBeGreaterThan(0);
    const chakra = fight.player.chakra;
    fight.player.maxChakra = 1e9;
    for (const e of fight.enemies) e.hp = 1;
    fight.player.damage = 1e9;
    fightAdvance(fight, sec(120), content, r);
    expect(fight.result).toBe('victory');
    expect(living(fight).every((a) => a.chakra === 0)).toBe(true);
    expect(fight.player.chakra).toBeGreaterThan(chakra);
  });

  it('dispels a body that has nothing left to pay for', () => {
    const { fight, r } = summoned();
    const a = alliesOf(fight)[0];
    if (!a) throw new Error('no ally');
    a.chakra = 0;
    a.stamina = 0;
    fight.player.maxChakra = 1e9;
    const chakra = fight.player.chakra;
    fightAdvance(fight, sec(20), content, r);
    expect(a.hp).toBe(0);
    expect(fight.player.chakra).toBeGreaterThanOrEqual(chakra);
  });
});

describe('the character is the fight', () => {
  it('loses the fight when the character falls, whoever else stands', () => {
    const { fight, r } = summoned();
    for (const a of alliesOf(fight)) a.hp = a.maxHp = 1e9;
    const ctx = makeCtx(fight, content, r);
    dealDamage(ctx, fight.player, 1e12, 'test');
    fightAdvance(fight, 1, content, r);
    expect(fight.result).toBe('defeat');
    expect(living(fight).length).toBeGreaterThan(0);
  });

  it('is not lost when an ally falls, and the fall of the last enemy still wins it', () => {
    const { fight, r } = summoned();
    const ctx = makeCtx(fight, content, r);
    for (const a of alliesOf(fight)) dealDamage(ctx, a, 1e12, 'test');
    expect(living(fight)).toHaveLength(0);
    expect(fight.result).toBe('ongoing');
    for (const e of fight.enemies) dealDamage(ctx, e, 1e12, 'test');
    fightAdvance(fight, 1, content, r);
    expect(fight.result).toBe('victory');
  });

  it('costs the character no Wound and no taken health for what the bodies suffer', () => {
    const { fight, r } = summoned();
    const taken = fight.tally.taken;
    const ctx = makeCtx(fight, content, r);
    for (const a of alliesOf(fight)) dealDamage(ctx, a, a.maxHp * 0.9, 'test');
    expect(fight.tally.taken).toBe(taken);
    expect(fight.player.data.low).toBeUndefined();
  });
});

describe('what reaches the allies, and what does not', () => {
  it('cannot be healed from outside: a healing item acts on the character only', () => {
    const heal = content.items.find((i) => i.fx?.kind === 'heal');
    if (!heal) throw new Error('no healing item');
    const snap = { ...scripted([CLONE, DYNAMIC, GALE]), pouch: [{ id: heal.id, n: 5 }], medic: 0 };
    // The character summons, then drinks whatever it holds.
    const r = withAi((view) =>
      view.techniques.some((x) => x.ready && x.tech.id === CLONE)
        ? { type: 'technique', id: CLONE }
        : { type: 'item', id: heal.id },
    );
    const fight = createFight(snap, enemyAt(20), 3, content, r);
    while ((fight.tally.uses[CLONE] ?? 0) < 1) {
      fightAdvance(fight, fightNextEventIn(fight, content, r) ?? 1, content, r);
    }
    for (const a of alliesOf(fight)) a.hp = a.maxHp * 0.1;
    fight.player.hp = fight.player.maxHp * 0.5;
    const before = alliesOf(fight).map((a) => a.hp);
    const healthBefore = fight.player.hp;
    // The player's hand item heals the character; the medic pouch of the AI is the character's too.
    expect(fightStatus(fight, content, r).allies).toHaveLength(2);
    fightAdvance(fight, sec(5), content, r);
    expect(fight.pouch[0]?.n).toBeLessThan(5);
    expect(fight.player.hp).toBeGreaterThan(healthBefore);
    // Only an ally's own technique could mend it, and the clone has none: its health never rises.
    alliesOf(fight).forEach((a, i) => expect(a.hp).toBeLessThanOrEqual(before[i] ?? 0));
  });

  it('uses no consumables: an ally never takes an item from the pouch, whatever the AI asks for', () => {
    const throwable = content.items.find((i) => i.pouch && !i.fx);
    const item = throwable ?? content.items.find((i) => i.pouch);
    if (!item) throw new Error('no pouch item');
    const snap = { ...scripted([CLONE, DYNAMIC]), pouch: [{ id: item.id, n: 50 }], medic: null };
    // The AI casts the clone technique, then asks for the item at every decision.
    const r = withAi((view) => {
      const clone = view.techniques.find((t) => t.ready && t.tech.id === CLONE);
      if (clone) return { type: 'technique', id: CLONE };
      return { type: 'item', id: item.id };
    });
    const fight = createFight(snap, enemyAt(20), 3, content, r);
    fight.log = [];
    fightAdvance(fight, sec(60), content, r);
    const itemLines = (fight.log ?? []).filter((l) => l.tech === item.id && l.act === 'cast');
    expect(itemLines.length).toBeGreaterThan(0);
    // Every use of the item is the character's.
    for (const l of itemLines) {
      expect(l.by).toBe('player');
      expect(l.ally).toBeUndefined();
    }
    const spent = 50 - (fight.pouch[0]?.n ?? 50);
    expect(spent).toBe(fight.tally.uses[item.id] ?? 0);
    expect(spent).toBe(itemLines.length);
  });

  it('keeps the techniques that act on the body itself out of an ally hand: no clone of a clone', () => {
    const { fight, r } = summoned();
    fight.log = [];
    fightAdvance(fight, sec(60), content, r);
    const casts = (fight.log ?? []).filter((l) => l.ally !== undefined && l.act === 'cast');
    expect(casts.length).toBeGreaterThan(0);
    expect(casts.every((l) => l.tech !== CLONE)).toBe(true);
  });
});

describe('the fight view lists every body', () => {
  it('gives the character, each living ally with its own phase and action, and the enemies', () => {
    const { fight, r } = summoned();
    const view = fightStatus(fight, content, r);
    expect(view.allies.map((a) => a.ally)).toEqual([1, 2]);
    expect(view.allies.every((a) => a.side === 'player')).toBe(true);
    expect(view.player.ally).toBeUndefined();
    const ally = alliesOf(fight)[0];
    if (!ally) throw new Error('no ally');
    const one = combatantStatus(fight, ally, content, r);
    expect(one.phase).toBe(ally.phase);
    expect(one.id).toBe(ally.id);
    expect(one.evasion).toBeUndefined();
    // A fallen body is not listed, but stays in the fight with no health.
    const ctx = makeCtx(fight, content, r);
    dealDamage(ctx, ally, 1e12, 'test');
    expect(fightStatus(fight, content, r).allies).toHaveLength(1);
  });
});

describe('determinism, split invariance and saves', () => {
  const run = (cuts: number[]) => {
    const { fight, r } = cloned(5);
    for (const ms of cuts) fightAdvance(fight, workOf(ms), content, r);
    return JSON.stringify(fight);
  };

  it('plays the same fight from the same seed, however time is cut', () => {
    const whole = run([60_000]);
    expect(run([60_000])).toBe(whole);
    expect(run([1, 999, 12_345, 20_000, 26_655])).toBe(whole);
    expect(run(Array.from({ length: 600 }, () => 100))).toBe(whole);
  });

  it('reads a fight with allies back from JSON, and a fight without allies as before', () => {
    const { fight, r } = summoned();
    fightAdvance(fight, sec(7), content, r);
    const back = parseFight(JSON.parse(JSON.stringify(fight)), content);
    expect(back).not.toBeNull();
    expect(back).toEqual(JSON.parse(JSON.stringify(fight)));
    // Playing on from the copy gives the same fight.
    fightAdvance(fight, sec(20), content, r);
    if (back) fightAdvance(back, sec(20), content, r);
    expect(back).toEqual(JSON.parse(JSON.stringify(fight)));
    const plain = createFight(scripted([DYNAMIC]), enemyAt(10), 1, content, rules);
    expect('allies' in plain).toBe(false);
    expect(parseFight(JSON.parse(JSON.stringify(plain)), content)).not.toBeNull();
  });

  it('refuses an ally that holds an item, takes a rest or casts a technique the kit lacks', () => {
    const { fight } = summoned();
    const raw = JSON.parse(JSON.stringify(fight)) as { allies: { act: unknown; phase: string }[] };
    const bad = (mutate: (a: { act: unknown; phase: string }) => void) => {
      const copy = JSON.parse(JSON.stringify(raw)) as typeof raw;
      const a = copy.allies[0];
      if (a) mutate(a);
      return parseFight(copy, content);
    };
    expect(
      bad((a) => ((a.phase = 'rest'), (a.act = { kind: 'rest', id: null, target: null }))),
    ).toBeNull();
    expect(
      bad((a) => ((a.phase = 'act'), (a.act = { kind: 'item', id: 'x', target: null }))),
    ).toBeNull();
    expect(
      bad(
        (a) => ((a.phase = 'act'), (a.act = { kind: 'technique', id: 'core:nope', target: null })),
      ),
    ).toBeNull();
  });
});

describe('in the game', () => {
  /** A genin who knows the clone technique and has it in the hand, in a zone fight. */
  function play(seed: number) {
    const state = fighter(seed, 50);
    state.known[CLONE] = true;
    state.mastery[CLONE] = { xp: 0 } as never;
    run(state, { type: 'loadout.prepare', encounter: 'core:zone_wolfmask' });
    return state;
  }

  it('carries the bodies through the saved state and pays the mastery of what they cast to the character', () => {
    const state = play(2);
    startFight(state, 'core:zone_wolfmask');
    for (let i = 0; i < 60 && !state.combat?.fight.allies; i++) advance(state, 1000, content);
    const fight = state.combat?.fight;
    expect(fight?.allies?.length).toBeGreaterThan(0);
    expect(fight?.tally.uses[CLONE]).toBe(1);
    const copy = deserialize(serialize(state, 0), content);
    // Whatever the fight held when it was saved, the copy plays on as the original does.
    advance(state, 60_000, content);
    advance(copy, 60_000, content);
    expect(copy.combat).toEqual(JSON.parse(JSON.stringify(state.combat)));
  });
});

describe('the analysis simulates the allies', () => {
  it('runs the same engine: the clone technique is cast and the bodies act in every simulated fight', () => {
    const snap = scripted([CLONE, DYNAMIC, GALE]);
    const without = scripted([DYNAMIC, GALE]);
    const enemy = enemyAt(30);
    const withClones = simulateFights(snap, enemy, 20, 7, content, rules);
    const alone = simulateFights(without, enemy, 20, 7, content, rules);
    expect(withClones.tally.uses[CLONE]).toBeGreaterThan(0.9);
    expect(alone.tally.uses[CLONE]).toBeUndefined();
    // The bodies strike too: the same enemy falls sooner with them than without.
    expect(withClones.timeAllMs).toBeLessThan(alone.timeAllMs);
    // Same inputs, same summary.
    expect(JSON.stringify(simulateFights(snap, enemy, 20, 7, content, rules))).toBe(
      JSON.stringify(withClones),
    );
    expect(K.combat.fightCapMs).toBeGreaterThan(0);
  });
});
