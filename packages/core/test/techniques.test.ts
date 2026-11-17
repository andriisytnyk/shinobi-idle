/** A4: what a technique does besides damage, read from its combat data. One test per kind of effect. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  addEffect,
  createFight,
  findEffect,
  needOf,
  statOf,
  type FightState,
} from '../src/index.ts';
import {
  castAndHit,
  castOnce,
  castSeq,
  enemyAt,
  pacify,
  quiet,
  runUntil,
  scripted,
  sec,
  fig,
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
    runUntil(fight, (f) => f.player.phase === 'act' && f.player.act?.id === next, ai);
    expect(fight.player.timer.need).toBe(
      needOf(Math.round(tech(fight, next).castMs * fig('techFx.nextCast.castMult'))),
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
      (e) =>
        findEffect(e, 'revealed')?.until === fight.t + sec(fig('techFx.reveal.durationMs') / 1000),
    );
    expect(revealed).toBe(true);
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
      mult: fig('techFx.gateOpening.taiDamage'),
      drain: fig('techFx.gateOpening.staminaPerSec'),
    });
    runUntil(fight, cast(opening), ai);
    expect(statOf(fight.player, 'taiDamage', 1)).toBeCloseTo(
      1 + fig('techFx.gateOpening.taiDamage'),
      9,
    );
    const start = fight.player.stamina;
    const at = fight.t;
    runUntil(fight, (f) => f.t >= at + sec(5), ai);
    // The stance drains by the second; every plain strike struck meanwhile costs its own stamina.
    const extra = start - fight.player.stamina - 5 * fig('techFx.gateOpening.staminaPerSec');
    expect(extra).toBeGreaterThanOrEqual(0);
    // (A rest between actions gives stamina back, so the extra is no longer a whole number of strikes.)
    fight.player.stamina = fig('techFx.gateOpening.staminaPerSec');
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
    expect(statOf(fight.player, 'taiDamage', 1)).toBeCloseTo(
      1 + fig('techFx.gateHealing.taiDamage'),
      9,
    );
    expect(fight.tally.wounds).toBe(
      fig('techFx.gateOpening.woundsAfter') + fig('techFx.gateHealing.woundsAfter'),
    );
  });

  it('is counted once however often it is cast', () => {
    const { fight } = scene([opening], enemyAt(LEVEL), 1);
    const ai = withAi(castSeq(opening));
    runUntil(fight, (f) => (f.tally.uses[opening] ?? 0) >= 3, ai, content, sec(120));
    expect(fight.tally.uses[opening]).toBeGreaterThanOrEqual(3);
    expect(fight.tally.wounds).toBe(fig('techFx.gateOpening.woundsAfter'));
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
