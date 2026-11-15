/** A6 and A7: statuses, combos, the nature wheel and habituation, with the balance numbers. */
import { content, type Technique } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addEffect,
  createFight,
  fightAdvance,
  findEffect,
  needOf,
  speedOf,
  statOf,
  type Effect,
  type FightState,
} from '../src/index.ts';
import {
  K,
  castAndHit,
  castOnce,
  castSeq,
  enemyAt,
  pacify,
  quiet,
  rules,
  scripted,
  sec,
  tech,
  withAi,
  withTechniques,
  runUntil,
} from './fight-helpers.ts';

const LEVEL = 34;
const idle = withAi(() => ({ type: 'basic' }));
const only = (f: FightState) => {
  const e = f.enemies[0];
  if (!e) throw new Error('no enemy');
  return e;
};

describe('Burning', () => {
  const fireball = 'core:great_fireball';
  const dragon = 'core:dragon_fire';

  it('adds the configured share of the technique damage over the configured time', () => {
    const { fight } = castAndHit(
      { known: [fireball], enemy: enemyAt(LEVEL), ai: () => castOnce(fireball) },
      fireball,
    );
    const base = tech(fight, fireball).damage;
    const burn = findEffect(only(fight), 'burn');
    expect(burn).toMatchObject({
      kind: 'periodic',
      mode: 'damage',
      suppresses: 'regen',
      src: fireball,
    });
    expect(burn?.until).toBe(fight.t + sec(K.burn.dur));
    expect(fight.tally.damage[fireball]).toBeCloseTo(base, 5);
    fightAdvance(fight, sec(K.burn.dur), content, idle);
    expect(fight.tally.damage[fireball]).toBeCloseTo(base * (1 + K.burn.share), 5);
    expect(findEffect(only(fight), 'burn')).toBeUndefined();
  });

  it('refreshes on a second hit and never stacks', () => {
    const { fight } = castAndHit(
      {
        known: [fireball, dragon],
        enemy: enemyAt(LEVEL),
        ai: () => castOnce(fireball, dragon),
        ok: (f) => f.tally.statuses.burn === 2,
      },
      dragon,
    );
    const burns = only(fight).effects.filter((e) => e.id === 'burn');
    expect(burns).toHaveLength(1);
    expect(burns[0]).toMatchObject({ src: dragon, until: fight.t + sec(K.burn.dur) });
    expect(burns[0]?.kind === 'periodic' && burns[0].amount).toBeCloseTo(
      (K.burn.share * tech(fight, dragon).damage) / K.burn.dur,
      6,
    );
  });
});

describe('Wet', () => {
  const wave = 'core:wild_water_wave';

  it('slows the target by the configured share for the configured time', () => {
    const { fight } = castAndHit(
      { known: [wave], enemy: enemyAt(LEVEL), ai: () => castOnce(wave) },
      wave,
    );
    pacify(fight);
    const e = only(fight);
    expect(findEffect(e, 'wet')?.until).toBe(fight.t + sec(K.wet.dur));
    expect(speedOf(e)).toBe(Math.round(1000 * (1 - K.wet.slow)));
    const before = e.timer.progress;
    fightAdvance(fight, sec(1), content, idle);
    expect(e.timer.progress - before).toBe(sec(1) * speedOf(e));
    fightAdvance(fight, sec(K.wet.dur), content, idle);
    expect(findEffect(e, 'wet')).toBeUndefined();
    expect(speedOf(e)).toBe(1000);
  });

  it('refreshes on a second hit and never stacks', () => {
    const { fight } = castAndHit(
      {
        known: [wave],
        enemy: enemyAt(LEVEL),
        ai: () => castSeq(wave),
        ok: (f) => f.tally.statuses.wet === 2,
      },
      wave,
      2,
    );
    const wets = only(fight).effects.filter((e) => e.id === 'wet');
    expect(wets).toHaveLength(1);
    expect(wets[0]?.until).toBe(fight.t + sec(K.wet.dur));
  });
});

describe('Stun', () => {
  const fang = 'core:lightning_beast_tracking_fang';
  const dark = 'core:false_darkness';
  const stunD = {
    ...content.techniques.find((t) => t.id === fang),
    id: 'core:test_stun_d',
    rank: 'D',
  } as Technique;
  const c = withTechniques([stunD]);

  it.each([
    [fang, K.stun.C],
    [dark, K.stun.B],
    [stunD.id, K.stun.D],
  ])('%s stops the target for the time of its rank, and cancels its cast', (id, seconds) => {
    const caster = enemyAt(LEVEL, ['caster']);
    const { fight } = castAndHit(
      {
        known: [id],
        enemy: caster,
        ai: () => castOnce(id),
        content: c,
        setup: (f) => {
          pacify(f);
          const e = only(f);
          e.data['caster.cast'] = 1;
          e.timers.caster = { progress: 1, need: needOf(K.trait.casterCast * 1000) };
        },
      },
      id,
    );
    const e = only(fight);
    expect(findEffect(e, 'stun')?.until).toBe(fight.t + sec(seconds));
    expect(speedOf(e)).toBe(0);
    expect(e.data['caster.cast']).toBe(0);
    expect(e.timers.caster).toMatchObject({ progress: 0 });
    // A stunned enemy skips time: its timers do not move.
    const progress = e.timer.progress;
    fightAdvance(fight, sec(seconds / 2), content, idle);
    expect(e.timer.progress).toBe(progress);
    fightAdvance(fight, sec(seconds), content, idle);
    expect(findEffect(e, 'stun')).toBeUndefined();
    expect(speedOf(e)).toBe(1000);
  });

  it('refreshes on a second stun and never stacks', () => {
    const { fight } = castAndHit(
      {
        known: [fang, dark],
        enemy: enemyAt(LEVEL),
        ai: () => castOnce(fang, dark),
        ok: (f) => f.tally.statuses.stun === 2,
      },
      dark,
    );
    expect(only(fight).effects.filter((e) => e.id === 'stun')).toHaveLength(1);
  });
});

describe('Bind', () => {
  const paralysis = 'core:temporary_paralysis';
  const snake = 'core:hidden_shadow_snake_hands';

  it('multiplies evasion down for the configured time, and refreshes without stacking', () => {
    const { fight } = castAndHit(
      {
        known: [paralysis, snake],
        enemy: enemyAt(LEVEL),
        ai: () => castOnce(paralysis, snake),
        ok: (f) => f.tally.statuses.bind === 2,
      },
      snake,
    );
    const e = only(fight);
    expect(e.effects.filter((x) => x.id === 'bind')).toHaveLength(1);
    expect(findEffect(e, 'bind')?.until).toBe(fight.t + sec(K.bind.dur));
    expect(statOf(e, 'evasion', 100)).toBeCloseTo(100 * K.bindEva, 9);
  });
});

describe('Poison on an enemy or the player', () => {
  it('refreshes an effect with the same id instead of adding another', () => {
    const fight = createFight(scripted([]), enemyAt(LEVEL), 1, content, rules);
    const e = only(fight);
    const poison = (until: number, next: number): Effect => ({
      kind: 'periodic',
      id: 'poison',
      src: 'test',
      until,
      mode: 'damage',
      amount: 1,
      every: sec(1),
      next,
    });
    addEffect(e, poison(sec(8), sec(1)));
    addEffect(e, poison(sec(12), sec(5)));
    const all = e.effects.filter((x) => x.id === 'poison');
    expect(all).toHaveLength(1);
    // The new end time is taken; the running tick schedule is kept.
    expect(all[0]).toMatchObject({ until: sec(12), next: sec(1) });
  });
});

// ---------- combos ----------

const wetEffect = (): Effect => ({
  kind: 'modifier',
  id: 'wet',
  src: 'test',
  until: sec(1000),
  stat: 'speed',
  op: 'mul',
  value: 1 - K.wet.slow,
});
const burnEffect = (): Effect => ({
  kind: 'periodic',
  id: 'burn',
  src: 'test',
  until: sec(1000),
  suppresses: 'regen',
  mode: 'damage',
  amount: 10,
  every: sec(1),
  next: sec(1),
});

interface Combo {
  name: string;
  key: 'fanBurn' | 'shockWet' | 'mudEva' | 'steam';
  tech: string;
  prime: () => Effect;
}
const combos: Combo[] = [
  { name: 'Futon on Burning', key: 'fanBurn', tech: 'core:gale_palm', prime: burnEffect },
  {
    name: 'Raiton on Wet',
    key: 'shockWet',
    tech: 'core:lightning_beast_tracking_fang',
    prime: wetEffect,
  },
  {
    name: 'Doton on Wet',
    key: 'mudEva',
    tech: 'core:tearing_earth_turning_palm',
    prime: wetEffect,
  },
  { name: 'Katon on Wet', key: 'steam', tech: 'core:great_fireball', prime: wetEffect },
];

/** Casts `id` once at a primed enemy across many seeds; counts the hits and the combos among them. */
function trials(
  id: string,
  prime: (() => Effect) | null,
  key: Combo['key'],
  n = 2000,
  c = content,
) {
  let hits = 0;
  let fired = 0;
  let chance = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = withAi(castOnce(id));
    const fight = quiet(createFight(scripted([id]), enemyAt(LEVEL), seed, c, r));
    chance = tech(fight, id).comboChance;
    if (prime) addEffect(only(fight), prime());
    runUntil(fight, (f) => (f.tally.uses[id] ?? 0) > 0, r, c);
    if ((fight.tally.damage[id] ?? 0) > 0) {
      hits++;
      if ((fight.tally.combos[key] ?? 0) > 0) fired++;
    }
  }
  return { hits, fired, chance };
}

describe('Combos', () => {
  for (const combo of combos) {
    describe(combo.name, () => {
      it('fires at base + per level x nature level + per mastery x technique mastery', () => {
        const { hits, fired, chance } = trials(combo.tech, combo.prime, combo.key);
        const skill = content.techniques.find((t) => t.id === combo.tech)?.skill ?? 'tai';
        expect(chance).toBeCloseTo(
          Math.min(K.combo.cap, K.combo.base + K.combo.perLevel * 40 + K.combo.perMastery * 20),
          9,
        );
        expect(skill).not.toBe('tai');
        expect(hits).toBeGreaterThan(1000);
        expect(Math.abs(fired / hits - chance)).toBeLessThan(0.04);
      });

      it('does not fire when the target is not in the state', () => {
        const { hits, fired } = trials(combo.tech, null, combo.key, 300);
        expect(hits).toBeGreaterThan(100);
        expect(fired).toBe(0);
      });
    });
  }

  it('caps the chance', () => {
    const lowCap = {
      ...content,
      balance: { ...content.balance, K: { ...K, combo: { ...K.combo, cap: 0.2 } } },
    };
    const fight = createFight(scripted(['core:gale_palm']), enemyAt(LEVEL), 1, lowCap, rules);
    expect(tech(fight, 'core:gale_palm').comboChance).toBe(0.2);
  });

  const scene = (combo: Combo) => ({
    known: [combo.tech],
    enemy: enemyAt(LEVEL),
    ai: () => castOnce(combo.tech),
    setup: (f: FightState) => {
      pacify(f);
      addEffect(only(f), combo.prime());
    },
    ok: (f: FightState) => (f.tally.combos[combo.key] ?? 0) === 1,
  });

  it('Futon on Burning makes the burn stronger and starts it over', () => {
    const combo = combos[0];
    if (!combo) throw new Error('no combo');
    const { fight } = castAndHit(scene(combo), combo.tech);
    const burn = findEffect(only(fight), 'burn');
    expect(burn?.kind === 'periodic' && burn.amount).toBe(10 * K.combo.fanBurn);
    expect(burn?.until).toBe(fight.t + sec(K.burn.dur));
  });

  it('Raiton on Wet doubles the stun', () => {
    const combo = combos[1];
    if (!combo) throw new Error('no combo');
    const { fight } = castAndHit(scene(combo), combo.tech);
    expect(findEffect(only(fight), 'stun')?.until).toBe(fight.t + sec(K.stun.C) * K.combo.shockWet);
  });

  it('Doton on Wet binds with the mud evasion multiplier', () => {
    const combo = combos[2];
    if (!combo) throw new Error('no combo');
    const { fight } = castAndHit(scene(combo), combo.tech);
    const e = only(fight);
    expect(findEffect(e, 'bind')?.until).toBe(fight.t + sec(K.bind.dur));
    expect(statOf(e, 'evasion', 100)).toBeCloseTo(100 * K.combo.mudEva, 9);
  });

  it('Katon on Wet removes Wet and adds a share of the technique damage', () => {
    const combo = combos[3];
    if (!combo) throw new Error('no combo');
    const { fight } = castAndHit(scene(combo), combo.tech);
    expect(findEffect(only(fight), 'wet')).toBeUndefined();
    expect(fight.tally.damage[combo.tech]).toBeCloseTo(
      tech(fight, combo.tech).damage * (1 + K.combo.steam),
      5,
    );
  });

  it('always fires for a technique the data marks as guaranteed', () => {
    const id = 'core:wave_of_inspiration';
    const { hits, fired } = trials(id, wetEffect, 'shockWet', 300);
    expect(hits).toBeGreaterThan(100);
    expect(fired).toBe(hits);
  });
});

// ---------- wheel and habituation ----------

describe('A7: the nature wheel', () => {
  const palm = 'core:gale_palm'; // Futon, no state of its own

  const damageAgainst = (nature: 'raiton' | 'katon' | null) =>
    castAndHit({ known: [palm], enemy: enemyAt(LEVEL, [], nature), ai: () => castOnce(palm) }, palm)
      .fight.tally.damage[palm] ?? 0;

  it('deals (1 + wheel) : 1 : (1 - wheel) against a beaten, neutral and beating nature', () => {
    // Futon beats Raiton and loses to Katon.
    const favourable = damageAgainst('raiton');
    const neutral = damageAgainst(null);
    const unfavourable = damageAgainst('katon');
    expect(favourable / neutral).toBeCloseTo(1 + K.wheel, 9);
    expect(unfavourable / neutral).toBeCloseTo(1 - K.wheel, 9);
  });

  it('leaves a technique without a nature alone', () => {
    const dyn = 'core:dynamic_entry';
    const damage = (n: 'katon' | null) =>
      castAndHit({ known: [dyn], enemy: enemyAt(LEVEL, [], n), ai: () => castOnce(dyn) }, dyn).fight
        .tally.damage[dyn];
    expect(damage('katon')).toBeCloseTo(damage(null) ?? 0, 9);
  });

  it('gives a wheel enemy the nature that beats the first nature of the player', () => {
    const snap = { ...scripted([]), natures: ['katon' as const, 'doton' as const] };
    const fight = createFight(snap, enemyAt(LEVEL, [], 'wheel'), 1, content, rules);
    expect(only(fight).nature).toBe('suiton');
    const none = createFight(
      { ...snap, natures: [] },
      enemyAt(LEVEL, [], 'wheel'),
      1,
      content,
      rules,
    );
    expect(only(none).nature).toBeNull();
  });
});

describe('A7: habituation', () => {
  const palm = 'core:gale_palm';

  /** Damage dealt by each of the first `casts` casts (0 for a miss). */
  function perCast(casts: number): { fight: FightState; damage: number[] } {
    const r = withAi(castSeq(palm));
    const fight = quiet(pacify(createFight(scripted([palm]), enemyAt(LEVEL), 3, content, r)));
    only(fight).evasion = 0;
    const damage: number[] = [];
    let before = 0;
    for (let n = 1; n <= casts; n++) {
      runUntil(fight, (f) => (f.tally.uses[palm] ?? 0) >= n, r);
      const total = fight.tally.damage[palm] ?? 0;
      damage.push(total - before);
      before = total;
    }
    return { fight, damage };
  }

  it('cuts the n-th repeat to base x (1 - min(cap, step x (n - 1)))', () => {
    const { fight, damage } = perCast(8);
    const base = tech(fight, palm).damage;
    let hits = 0;
    damage.forEach((d, i) => {
      if (d === 0) return;
      hits++;
      expect(d / base).toBeCloseTo(1 - Math.min(K.habituationCap, K.habituation * i), 5);
    });
    expect(hits).toBeGreaterThanOrEqual(6);
    // The cap is reached within the eight casts.
    expect(K.habituation * 7).toBeGreaterThan(K.habituationCap);
  });

  it('starts over against a new enemy', () => {
    const { fight } = perCast(3);
    expect(fight.uses[palm]).toBe(3);
    const next = createFight(scripted([palm]), enemyAt(LEVEL), 4, content, rules);
    expect(next.uses).toEqual({});
  });
});
