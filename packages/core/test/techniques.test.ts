/** A4: what a technique does besides damage, read from its combat data. One test per kind of effect. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addEffect,
  createFight,
  findEffect,
  needOf,
  rollHit,
  statOf,
  type FightState,
} from '../src/index.ts';
import {
  K,
  castAndHit,
  castOnce,
  castSeq,
  ctxOf,
  enemyAt,
  pacify,
  quiet,
  rules,
  runUntil,
  scripted,
  sec,
  tech,
  withAi,
} from './fight-helpers.ts';

const LEVEL = 34;

/** A quiet fight with the given techniques known and the AI casting them once each, in order. */
function scene(known: string[], enemy = enemyAt(LEVEL), seed = 1, setup?: (f: FightState) => void) {
  const ai = withAi(castOnce(...known));
  const fight = createFight(scripted(known), enemy, seed, content, ai);
  quiet(pacify(fight));
  // Nothing refills the pools during the checks.
  fight.kit.staminaRegen = 0;
  fight.kit.chakraRegen = 0;
  setup?.(fight);
  return { fight, ai };
}

const cast = (id: string) => (f: FightState) => (f.tally.uses[id] ?? 0) > 0;

describe('shield: a ward that absorbs damage for a while', () => {
  const wall = 'core:earth_style_wall';

  it('takes its strength from the rank power and the skill level, and lapses after the configured time', () => {
    const { fight, ai } = scene([wall]);
    const t = tech(fight, wall);
    expect(t.fx.kind).toBe('shield');
    expect(t.fx.amount).toBeCloseTo(
      K.power[t.rank] * K.techFx.shield.mult * (1 + K.levelScale * 40),
      9,
    );
    runUntil(fight, cast(wall), ai);
    expect(fight.player.ward).toBeCloseTo(t.fx.amount, 9);
    expect(fight.player.wardUntil).toBe(fight.t + sec(K.techFx.shield.durationMs / 1000));
    runUntil(fight, (f) => f.player.ward === 0, ai);
    expect(fight.t).toBeGreaterThanOrEqual(sec(K.techFx.shield.durationMs / 1000));
    expect(fight.player.wardUntil).toBeNull();
  });
});

describe('decoy: the next hits miss', () => {
  const clone = 'core:clone';

  it('turns the next hit into a miss, then lapses', () => {
    const { fight, ai } = scene([clone]);
    runUntil(fight, cast(clone), ai);
    expect(fight.player.decoys).toBe(K.techFx.decoy.charges);
    expect(rollHit(ctxOf(fight), fight.player, null)).toBe(false);
    expect(fight.player.decoys).toBe(0);
    expect(rollHit(ctxOf(fight), fight.player, null)).toBe(true);

    const other = scene([clone]);
    runUntil(other.fight, cast(clone), other.ai);
    const at = other.fight.t;
    runUntil(other.fight, (f) => f.player.decoys === 0, other.ai);
    expect(other.fight.t - at).toBe(sec(K.techFx.decoy.durationMs / 1000));
  });
});

describe('evasion buff', () => {
  it('multiplies the evasion for the configured time', () => {
    const mist = 'core:hiding_in_mist';
    const { fight, ai } = scene([mist]);
    expect(statOf(fight.player, 'evasion', 100)).toBe(100);
    runUntil(fight, cast(mist), ai);
    expect(statOf(fight.player, 'evasion', 100)).toBeCloseTo(100 * K.techFx.evasionBuff.mult, 9);
    runUntil(fight, (f) => !findEffect(f.player, 'evasionBuff'), ai);
    expect(statOf(fight.player, 'evasion', 100)).toBe(100);
  });
});

describe('cleanse: removes the statuses it names', () => {
  it('lets Rope Escape free the player from a bind, and only that', () => {
    const escape = 'core:rope_escape';
    const { fight, ai } = scene([escape], enemyAt(LEVEL), 1, (f) => {
      const until = f.t + sec(60);
      addEffect(f.player, {
        kind: 'modifier',
        id: 'bind',
        src: 'x',
        until,
        stat: 'evasion',
        op: 'mul',
        value: 0.3,
      });
      addEffect(f.player, {
        kind: 'modifier',
        id: 'illusion',
        src: 'x',
        until,
        stat: 'accuracy',
        op: 'mul',
        value: 0.5,
      });
    });
    runUntil(fight, cast(escape), ai);
    expect(findEffect(fight.player, 'bind')).toBeUndefined();
    expect(findEffect(fight.player, 'illusion')).toBeDefined();
  });
});

describe('next-cast modifier', () => {
  it('shortens the cast of the next technique once', () => {
    const flicker = 'core:body_flicker';
    const next = 'core:dynamic_entry';
    const { fight, ai } = scene([flicker, next]);
    // The player starts the next cast the moment the flicker ends, and that cast is the short one.
    runUntil(fight, (f) => f.player.phase === 'cast' && f.player.cast === next, ai);
    expect(fight.player.timer.need).toBe(
      needOf(Math.round(tech(fight, next).castMs * K.techFx.nextCast.castMult)),
    );
    expect(fight.player.data.hasten).toBe(0);
  });
});

describe('reveal', () => {
  it('removes the hidden effect of the player and keeps every body from hiding for a while', () => {
    const sensing = 'core:sensing';
    const { fight, ai } = scene([sensing], enemyAt(LEVEL, ['hidden']));
    expect(findEffect(fight.player, 'hidden')).toBeDefined();
    runUntil(fight, cast(sensing), ai);
    expect(findEffect(fight.player, 'hidden')).toBeUndefined();
    const revealed = fight.enemies.every(
      (e) => findEffect(e, 'revealed')?.until === fight.t + sec(K.techFx.reveal.durationMs / 1000),
    );
    expect(revealed).toBe(true);
  });
});

describe('passive negate (Body Replacement)', () => {
  const body = 'core:body_replacement';

  it('needs no slot, and every N seconds negates one hit', () => {
    // Nothing is cast: the technique is in the kit only because it is out of the loadout.
    const snap = { ...scripted([body]), loadout: [] };
    const fight = quiet(pacify(createFight(snap, enemyAt(LEVEL), 1, content, rules)));
    expect(fight.player.specials).toContain('passiveNegate');
    expect(fight.player.decoys).toBe(0);
    const ai = withAi(() => ({ type: 'wait' }));
    runUntil(fight, (f) => f.player.decoys === 1, ai);
    expect(fight.t).toBe(sec(K.techFx.passiveNegate.everyMs / 1000));
    expect(rollHit(ctxOf(fight), fight.player, null)).toBe(false);
    // The charge comes back at the next period, not before.
    expect(fight.player.decoys).toBe(0);
    runUntil(fight, (f) => f.player.decoys === 1, ai);
    expect(fight.t).toBe(2 * sec(K.techFx.passiveNegate.everyMs / 1000));
  });
});

describe('stances', () => {
  const opening = 'core:gate_of_opening';
  const healing = 'core:gate_of_healing';
  const lotus = 'core:front_lotus';

  it('raise the Taijutsu damage, drain stamina every second and end when it runs out', () => {
    const { fight, ai } = scene([opening]);
    const fx = tech(fight, opening).fx;
    expect(fx).toMatchObject({
      kind: 'stance',
      mult: K.techFx.gateOpening.taiDamage,
      drain: K.techFx.gateOpening.staminaPerSec,
    });
    runUntil(fight, cast(opening), ai);
    expect(statOf(fight.player, 'taiDamage', 1)).toBeCloseTo(1 + K.techFx.gateOpening.taiDamage, 9);
    const start = fight.player.stamina;
    const at = fight.t;
    runUntil(fight, (f) => f.t >= at + sec(5), ai);
    expect(start - fight.player.stamina).toBeCloseTo(5 * K.techFx.gateOpening.staminaPerSec, 6);
    fight.player.stamina = K.techFx.gateOpening.staminaPerSec;
    runUntil(fight, (f) => !findEffect(f.player, 'stance'), ai);
    expect(fight.player.stamina).toBe(0);
    expect(findEffect(fight.player, 'stanceDrain')).toBeUndefined();
    expect(statOf(fight.player, 'taiDamage', 1)).toBe(1);
  });

  it('allow only one at a time, and cost one Wound after the fight for each one used', () => {
    const { fight, ai } = scene([opening, healing]);
    runUntil(fight, cast(opening), ai);
    expect(findEffect(fight.player, 'stance')?.src).toBe(opening);
    runUntil(fight, cast(healing), ai);
    const stances = fight.player.effects.filter((e) => e.id === 'stance');
    expect(stances).toHaveLength(1);
    expect(stances[0]?.src).toBe(healing);
    expect(statOf(fight.player, 'taiDamage', 1)).toBeCloseTo(1 + K.techFx.gateHealing.taiDamage, 9);
    expect(fight.tally.wounds).toBe(
      K.techFx.gateOpening.woundsAfter + K.techFx.gateHealing.woundsAfter,
    );
  });

  it('is counted once however often it is cast', () => {
    const { fight } = scene([opening], enemyAt(LEVEL), 1);
    const ai = withAi(castSeq(opening));
    runUntil(fight, (f) => (f.tally.uses[opening] ?? 0) >= 3, ai, content, sec(120));
    expect(fight.tally.uses[opening]).toBeGreaterThanOrEqual(3);
    expect(fight.tally.wounds).toBe(K.techFx.gateOpening.woundsAfter);
  });

  it('are needed by Front Lotus, which is refused without one', () => {
    const idle = scene([lotus]);
    runUntil(idle.fight, (f) => f.t >= sec(30), withAi(castSeq(lotus)));
    expect(idle.fight.tally.uses[lotus] ?? 0).toBe(0);

    const { fight, ai } = scene([opening, lotus]);
    runUntil(fight, (f) => (f.tally.uses[lotus] ?? 0) > 0, ai, content, sec(60));
    expect(fight.tally.uses[lotus]).toBe(1);
    expect(fight.tally.uses[opening]).toBe(1);
  });
});

describe('guaranteed combo and techniques that hit every enemy', () => {
  it('fires Shock-Wet on every hit of the Wave of Inspiration, with no roll', () => {
    const wave = 'core:wave_of_inspiration';
    const { fight } = castAndHit(
      {
        known: [wave],
        enemy: enemyAt(LEVEL),
        ai: () => castOnce(wave),
        setup: (f) => {
          for (const e of f.enemies) {
            addEffect(e, {
              kind: 'modifier',
              id: 'wet',
              src: 'x',
              until: f.t + sec(60),
              stat: 'speed',
              op: 'mul',
              value: 0.85,
            });
          }
        },
      },
      wave,
    );
    expect(fight.tally.combos.shockWet).toBe(1);
    expect(tech(fight, wave).guaranteedCombo).toBe('shockWet');
  });

  it('lets the Shadow Clone hit all enemies', () => {
    const clone = 'core:shadow_clone';
    const { fight, ai } = scene([clone], enemyAt(LEVEL, ['pack']));
    expect(fight.enemies.length).toBeGreaterThan(1);
    expect(tech(fight, clone).hitsAll).toBe(true);
    const before = fight.enemies.map((e) => e.hp);
    runUntil(fight, cast(clone), ai);
    // Every body that the clone hit lost health; with a hit chance below one, take several casts.
    const ai2 = withAi(castSeq(clone));
    runUntil(fight, (f) => (f.tally.uses[clone] ?? 0) >= 4, ai2, content, sec(120));
    const lost = fight.enemies.filter((e, i) => e.hp < (before[i] ?? 0));
    expect(lost.length).toBe(fight.enemies.length);
  });
});
