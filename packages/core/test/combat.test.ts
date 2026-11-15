import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  basicAttack,
  createState,
  dispatch,
  enemyStats,
  hitChance,
  playerMaxChakra,
  playerMaxHp,
  playerMaxStamina,
  rate,
  serialize,
  techniqueNumbers,
  xpAt,
  defaultRules,
  type GameState,
} from '../src/index.ts';
import { HOUR, genin, openWorld, setLevel } from './helpers.ts';

const DUMMY = 'core:dummy';
const fight = (id = DUMMY) => ({ type: 'action.start', slot: 0, kind: 'fight', id }) as const;
const K = content.balance.K;

/** Fights the dummy until it falls or the player does; returns the time of the first kill. */
function firstKill(seed: number): number | null {
  const state = createState(seed, content);
  dispatch(state, fight(), content);
  for (let i = 0; i < 600; i++) {
    advance(state, 1000, content);
    if ((state.counters[`kills.${DUMMY}`] ?? 0) > 0) return state.now;
    if (!state.slots[0]?.action) return null;
  }
  return null;
}

describe('combat formulas', () => {
  const state = createState(1, content);

  it('derives player pools from the balance object', () => {
    expect(playerMaxHp(state, content)).toBe(K.hpBase + K.hpPerVit * 1);
    expect(playerMaxChakra(state, content)).toBeCloseTo(K.chakraBase * (1 + K.chakraPerMed));
    expect(playerMaxStamina(state, content)).toBeCloseTo(K.staminaBase * (1 + K.staminaPerAth));
    const basic = basicAttack(state, content);
    expect(basic.damage).toBeCloseTo(K.basicDmg[0] + K.basicDmg[1]);
    expect(basic.intervalMs).toBe(Math.round(K.basicInterval * 1000));
  });

  it('uses the higher of Taijutsu and Ninjutsu for a basic attack', () => {
    const s = createState(1, content);
    setLevel(s, 'nin', 20);
    expect(basicAttack(s, content).accuracy).toBe(K.accBase + K.accPerLevel * 20);
  });

  it('scales an enemy from its combat level', () => {
    const dummy = content.enemies.find((e) => e.id === DUMMY);
    if (!dummy) throw new Error('no dummy');
    const e = enemyStats(dummy, content);
    expect(e.maxHp).toBeCloseTo(K.eHp[0] + K.eHp[1] * dummy.cl);
    expect(e.damage).toBeCloseTo(K.eDmg[0] + K.eDmg[1] * dummy.cl);
    expect(e.accuracy).toBeCloseTo(K.eAcc[0] + K.eAcc[1] * dummy.cl);
    expect(e.evasion).toBeCloseTo(K.eEva[0] + K.eEva[1] * dummy.cl);
    expect(e.intervalMs).toBe(Math.round(K.eInterval * 1000));
  });

  it('gives the Melvor hit chance, clamped', () => {
    expect(hitChance(50, 100, content)).toBeCloseTo(0.25);
    expect(hitChance(100, 50, content)).toBeCloseTo(0.75);
    expect(hitChance(1, 1000, content)).toBe(K.hitMin);
    expect(hitChance(1000, 1, content)).toBe(K.hitMax);
  });

  it('matches the documented technique numbers', () => {
    // Dynamic Entry at level 10 (no mastery): 13.5 damage, 0.4 s cast, 6 s cooldown.
    const s = genin();
    setLevel(s, 'tai', 10);
    const entry = content.techniques.find(
      (t) => t.skill === 'tai' && t.level === 10 && t.role === 'projectile',
    );
    if (!entry) throw new Error('no Dynamic Entry');
    const n = techniqueNumbers(s, entry, content, defaultRules);
    s.mastery[entry.id] = { xp: 0 };
    expect(n.damage).toBeCloseTo(
      K.power.D * (1 + K.levelScale * 10) * (1 + K.masteryDmg / K.masteryCap),
    );
    expect(n.cooldownMs).toBe(6000);
    expect(n.pool).toBe('stamina');
    // Mastery 99 raises damage by the full masteryDmg and cuts cost by masteryCost.
    s.mastery[entry.id] = { xp: xpAt(K.masteryCap) };
    const max = techniqueNumbers(s, entry, content, defaultRules);
    expect(max.damage / n.damage).toBeGreaterThan(1.09);
    expect(max.cost).toBeLessThan(n.cost);
  });

  it('lets Chakra Control cut chakra cost but not stamina cost', () => {
    const s = genin();
    const fire = content.techniques.find((t) => t.skill === 'katon' && t.role === 'projectile');
    if (!fire) throw new Error('no katon projectile');
    const before = techniqueNumbers(s, fire, content, defaultRules);
    setLevel(s, 'cc', 40);
    const after = techniqueNumbers(s, fire, content, defaultRules);
    expect(after.cost).toBeCloseTo(before.cost * (1 - K.ccCostPerLevel * 39));
    expect(before.pool).toBe('chakra');
  });
});

describe('A3: a fresh player against the training dummy', () => {
  const kills: number[] = [];
  let wins = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const t = firstKill(seed);
    if (t !== null) {
      wins++;
      kills.push(t);
    }
  }

  it('wins at least 95% of 200 seeded fights', () => {
    expect(wins / 200).toBeGreaterThanOrEqual(0.95);
  });

  it('takes 8 to 30 seconds on average', () => {
    const mean = kills.reduce((a, b) => a + b, 0) / kills.length / 1000;
    console.log(`A3: ${wins}/200 wins, mean fight ${mean.toFixed(1)} s`);
    expect(mean).toBeGreaterThan(8);
    expect(mean).toBeLessThan(30);
  });
});

describe('fight action', () => {
  it('only holds a slot and stops cleanly', () => {
    const state = createState(3, content);
    expect(dispatch(state, fight('core:nobody'), content)).toEqual({
      ok: false,
      reason: 'error.unknownAction',
    });
    expect(dispatch(state, fight(), content)).toEqual({ ok: true });
    expect(state.combat?.enemy).toBe(DUMMY);
    advance(state, 5000, content);
    expect(state.combat?.fight.player.hp).toBeGreaterThan(0);
    dispatch(state, { type: 'action.stop', slot: 0 }, content);
    expect(state.combat).toBeNull();
  });

  it('stops with a defeated event when the player falls', () => {
    const state = createState(4, content);
    state.player.rank = 'genin';
    openWorld(state);
    const boss = content.enemies.reduce((a, b) => (a.cl > b.cl ? a : b));
    dispatch(state, fight(boss.id), content);
    advance(state, 10 * 60 * 1000, content);
    const stopped = state.events.find((e) => e.type === 'actionStopped' && e.reason === 'defeated');
    expect(stopped).toBeDefined();
    expect(state.events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.combat).toBeNull();
  });

  it('respawns the enemy after a pause and counts every kill', () => {
    const state = genin(5);
    setLevel(state, 'vit', 30);
    dispatch(state, fight(), content);
    advance(state, 5 * 60 * 1000, content);
    expect(state.counters[`kills.${DUMMY}`]).toBeGreaterThan(5);
    expect(state.events.filter((e) => e.type === 'enemyDefeated')).toHaveLength(
      state.counters[`kills.${DUMMY}`] ?? -1,
    );
    expect(state.counters['actions.fight']).toBeGreaterThan(200);
  });

  it('uses only the combat and loot streams', () => {
    const state = createState(6, content);
    const others = (s: GameState) => JSON.stringify([s.rng.action, s.rng.world]);
    const before = others(state);
    const combatBefore = JSON.stringify(state.rng.combat);
    dispatch(state, fight(), content);
    advance(state, 60_000, content);
    expect(others(state)).toBe(before);
    expect(JSON.stringify(state.rng.combat)).not.toBe(combatBefore);
  });

  it('casts the technique, pays its cost and puts it on cooldown', () => {
    const state = createState(7, content);
    dispatch(state, fight(), content);
    advance(state, 1, content);
    const player = state.combat?.fight.player;
    expect(player?.cast).toBe('core:leaf_whirlwind');
    expect(player?.stamina).toBeLessThan(playerMaxStamina(state, content));
    advance(state, 1000, content);
    expect(state.combat?.fight.player.cd['core:leaf_whirlwind']).toBeGreaterThan(
      state.combat?.fight.t ?? Infinity,
    );
  });
});

describe('A4: combat XP follows the formula', () => {
  it('pays style, Vitality and Evasion XP by the hour within 5%', () => {
    const state = genin(8);
    setLevel(state, 'vit', 40);
    setLevel(state, 'eva', 40);
    const before = { tai: state.skills.tai.xp, vit: state.skills.vit.xp, eva: state.skills.eva.xp };
    dispatch(state, fight(), content);
    advance(state, HOUR, content);
    const dummy = content.enemies.find((e) => e.id === DUMMY);
    const r = rate(dummy?.cl ?? 0, content);
    const near = (got: number, want: number) => {
      expect(got / want).toBeGreaterThan(0.95);
      expect(got / want).toBeLessThan(1.05);
    };
    // The dummy is beaten with Leaf Whirlwind (Taijutsu) and basic attacks (Taijutsu).
    near(state.skills.tai.xp - before.tai, K.combatXp.style * r);
    near(state.skills.vit.xp - before.vit, K.combatXp.vit * r);
    near(state.skills.eva.xp - before.eva, K.combatXp.eva * r);
  });

  it('pays mastery XP for time since the previous action, to techniques only', () => {
    const state = genin(9);
    dispatch(state, fight(), content);
    advance(state, 10 * 60 * 1000, content);
    const mastery = state.mastery['core:leaf_whirlwind']?.xp ?? 0;
    expect(mastery).toBeGreaterThan(0);
    // The XP per hour of fight time is at most the practice rate.
    expect(mastery).toBeLessThanOrEqual((K.masteryPerHour * 10) / 60 + 1);
    expect(Object.keys(state.mastery)).toEqual(['core:leaf_whirlwind']);
  });

  it('credits a technique of another skill to that skill', () => {
    const state = genin(10);
    setLevel(state, 'katon', 30);
    setLevel(state, 'vit', 30);
    state.known['core:great_fireball'] = true;
    dispatch(state, fight(), content);
    advance(state, 60_000, content);
    expect(state.combat?.style).toBeDefined();
    expect(state.skills.katon.xp).toBeGreaterThan(xpAt(30));
  });
});

describe('A2: determinism and split invariance with a fight running', () => {
  const run = (chunks: number[], seed = 11): string => {
    const state = createState(seed, content);
    setLevel(state, 'vit', 20);
    dispatch(state, fight(), content);
    let left = 5 * 60 * 1000;
    let i = 0;
    while (left > 0) {
      const step = Math.min(left, chunks[i++ % chunks.length] ?? left);
      advance(state, step, content);
      left -= step;
    }
    return serialize(state, 0);
  };

  it('gives byte-identical saves for any chunking', () => {
    const whole = run([5 * 60 * 1000]);
    for (const chunk of [1, 7, 999, 3600]) {
      expect(run([chunk])).toBe(whole);
    }
  });

  it('also holds for 1 ms steps over a shorter span', () => {
    const go = (step: number) => {
      const state = createState(12, content);
      dispatch(state, fight(), content);
      for (let t = 0; t < 42_000; t += step) advance(state, step, content);
      return serialize(state, 0);
    };
    expect(go(1)).toBe(go(42_000));
    expect(go(7)).toBe(go(1));
  });

  it('is deterministic for the same seed and different for another', () => {
    expect(run([1000], 11)).toBe(run([1000], 11));
    expect(run([1000], 11)).not.toBe(run([1000], 12));
  });
});
