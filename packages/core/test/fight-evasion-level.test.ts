/**
 * A defensive technique works at its effective level, the lower of the level of its skill and its mastery times
 * K.defence.masteryToLevel; it adds its row of K.passiveFx times clamp(1 + k x (effective level - attacker level), min,
 * max). Enemies are unchanged.
 */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createFight,
  evasionAgainst,
  evasionParts,
  fightStatus,
  levelScale,
  makeCtx,
  partsAgainst,
} from '../src/index.ts';
import { enemyAt, playerFor, rules } from './fight-helpers.ts';

const K = content.balance.K;
const L = K.evaLevel;
const CLONE = 'core:clone';

const snapWith = (skill: number, mastery: number) => {
  const snap = playerFor(30, 'katon');
  return {
    ...snap,
    levels: { ...snap.levels, nin: skill },
    mastery: { ...snap.mastery, [CLONE]: mastery },
  };
};
const clone = (parts: ReturnType<typeof evasionParts>) => parts.find((p) => p.id === CLONE)!;
const against = (skill: number, mastery: number, attacker: number) =>
  clone(partsAgainst(evasionParts(snapWith(skill, mastery), content), attacker, content));

describe('the factor of an effective level against the level of the attacker', () => {
  it('is 1 at equal levels, 1 + k per level, and clamped between min and max', () => {
    expect(levelScale(0, content)).toBe(1);
    expect(levelScale(5, content)).toBeCloseTo(1 + 5 * L.k, 9);
    expect(levelScale(-5, content)).toBeCloseTo(1 - 5 * L.k, 9);
    expect(levelScale(1000, content)).toBe(L.max);
    expect(levelScale(-1000, content)).toBe(L.min);
  });
});

describe('the effective level of a defensive technique', () => {
  it('is the lower of its skill level and its mastery times masteryToLevel, and names the one that limits it', () => {
    const m = K.defence.masteryToLevel;
    const lowMastery = clone(evasionParts(snapWith(45, 12), content));
    expect(lowMastery.effectiveLevel).toBeCloseTo(12 * m, 9);
    expect(lowMastery.limit).toBe('mastery');
    const lowSkill = clone(evasionParts(snapWith(20, 99), content));
    expect(lowSkill.effectiveLevel).toBe(20);
    expect(lowSkill.limit).toBe('skill');
    expect(lowSkill.skillLevel).toBe(20);
    expect(lowSkill.masteryLevel).toBe(99);
  });

  it('gives as little at mastery 1 with skill 45 as with skill 5: a high skill does not defend an untrained technique', () => {
    const high = against(45, 1, 30);
    const low = against(5, 1, 30);
    expect(high.effectiveLevel).toBeCloseTo(low.effectiveLevel ?? 0, 0);
    expect(Math.abs(high.value - low.value)).toBeLessThan(0.1 * (high.full ?? 1));
    expect(high.value).toBeLessThan(0.3 * (high.full ?? 1));
  });

  it('is held by the skill when the mastery is high: mastery 99 with skill 20 is no better than mastery 40 with skill 20', () => {
    const maxed = against(20, 99, 20);
    const mid = against(20, 40, 20);
    expect(maxed.limit).toBe('skill');
    expect(maxed.value).toBeCloseTo(mid.value, 9);
  });

  it('adds more with more mastery while the mastery is the limit', () => {
    expect(against(45, 60, 30).value).toBeGreaterThan(against(45, 20, 30).value);
  });

  it('adds less against an attacker of a higher level, and names the adjustment on the part', () => {
    const weak = against(40, 80, 20);
    const even = against(40, 80, 40);
    const strong = against(40, 80, 60);
    expect(weak.value).toBeGreaterThan(even.value);
    expect(even.value).toBeGreaterThan(strong.value);
    expect(strong.levelAdj).toBeCloseTo(strong.value - (strong.full ?? 0), 9);
    expect(strong.levelAdj).toBeLessThan(0);
  });

  it('stops at the clamp however far apart the levels are', () => {
    const full = against(1, 1, 1).full ?? 0;
    expect(against(1, 1, 1000).value).toBeCloseTo(full * L.min, 9);
    expect(against(99, 99, 1).value).toBeCloseTo(full * L.max, 9);
  });

  it('leaves the other parts alone', () => {
    const parts = partsAgainst(evasionParts(snapWith(40, 80), content), 60, content);
    expect(parts.find((p) => p.source === 'base')?.levelAdj).toBeUndefined();
  });
});

describe('in the fight', () => {
  const rating = (cl: number) => {
    const fight = createFight(playerFor(30, 'katon'), enemyAt(cl), 1, content, rules);
    return {
      value: evasionAgainst(makeCtx(fight, content, rules), fight.player, fight.enemies[0]!),
      fight,
    };
  };

  it('makes the player harder to hit for a lower-level enemy', () => {
    expect(rating(10).value).toBeGreaterThan(rating(50).value);
  });

  it('leaves enemies as they are: their evasion comes from their own level and tier, not from the skills of the player', () => {
    const weak = createFight(playerFor(10, 'katon'), enemyAt(30), 1, content, rules);
    const strong = createFight(playerFor(40, 'katon'), enemyAt(30), 1, content, rules);
    expect(weak.enemies[0]!.evasion).toBe(strong.enemies[0]!.evasion);
  });

  it('shows each technique with its effective level, what limits it and its adjustment', () => {
    const parts = fightStatus(rating(50).fight, content, rules).player.evasion?.parts ?? [];
    const part = parts.find((p) => p.id === CLONE);
    expect(part?.effectiveLevel).toBeDefined();
    expect(['skill', 'mastery']).toContain(part?.limit);
    expect(part?.levelAdj).toBeDefined();
    const total = fightStatus(rating(50).fight, content, rules).player.evasion?.total ?? 0;
    expect(total).toBeCloseTo(
      parts.reduce((n, p) => n + p.value, 0),
      6,
    );
  });
});
