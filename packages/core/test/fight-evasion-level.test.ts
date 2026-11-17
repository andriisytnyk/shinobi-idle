/**
 * A defensive technique works at its effective level, its skill level times its mastery over the mastery cap, and adds
 * its row of K.passiveFx times clamp(effective level / attacker combat level, min, max). Enemies are unchanged.
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
  it('is their ratio, clamped between min and max', () => {
    expect(levelScale(20, 40, content)).toBeCloseTo(0.5, 9);
    expect(levelScale(40, 40, content)).toBe(1);
    expect(levelScale(0.001, 40, content)).toBe(L.min);
    expect(levelScale(1000, 40, content)).toBe(L.max);
  });
});

describe('the effective level of a defensive technique', () => {
  it('is the share of its skill that its mastery realises', () => {
    expect(clone(evasionParts(snapWith(20, K.masteryCap), content)).effectiveLevel).toBeCloseTo(
      20,
      9,
    );
    expect(clone(evasionParts(snapWith(80, 80), content)).effectiveLevel).toBeCloseTo(
      (80 * 80) / K.masteryCap,
      9,
    );
    expect(clone(evasionParts(snapWith(45, 1), content)).effectiveLevel).toBeCloseTo(
      45 / K.masteryCap,
      9,
    );
  });

  it('carries the skill, the mastery, the effective level, the ratio and the adjustment on the part', () => {
    const part = against(40, 50, 60);
    expect(part.skillLevel).toBe(40);
    expect(part.masteryLevel).toBe(50);
    expect(part.effectiveLevel).toBeCloseTo((40 * 50) / K.masteryCap, 9);
    expect(part.ratio).toBeCloseTo(part.effectiveLevel! / 60, 9);
    expect(part.levelAdj).toBeCloseTo(part.value - part.full!, 9);
  });

  it('grows with the skill and with the mastery', () => {
    expect(against(40, 60, 40).value).toBeGreaterThan(against(20, 60, 40).value);
    expect(against(40, 80, 40).value).toBeGreaterThan(against(40, 30, 40).value);
  });

  it('adds almost nothing at mastery 1, at any skill', () => {
    for (const skill of [5, 25, 45, 80]) {
      expect(against(skill, 1, 40).value).toBeLessThan(
        0.05 * 40 * (against(skill, 1, 40).full ?? 1),
      );
    }
  });

  it('adds less against an attacker of a higher level', () => {
    const weak = against(40, 80, 50);
    const even = against(40, 80, 100);
    const strong = against(40, 80, 200);
    expect(weak.value).toBeGreaterThan(even.value);
    expect(even.value).toBeGreaterThan(strong.value);
    expect(strong.levelAdj).toBeLessThan(0);
  });

  it('keeps its contribution when the skill and the attacker level both double', () => {
    expect(against(20, 60, 25).value).toBeCloseTo(against(40, 60, 50).value, 9);
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

  it('shows each technique with its effective level, the ratio and the adjustment', () => {
    const view = fightStatus(rating(50).fight, content, rules).player.evasion;
    const parts = view?.parts ?? [];
    const part = parts.find((p) => p.id === CLONE);
    expect(part?.effectiveLevel).toBeDefined();
    expect(part?.ratio).toBeDefined();
    expect(part?.levelAdj).toBeDefined();
    expect(view?.total ?? 0).toBeCloseTo(
      parts.reduce((n, p) => n + p.value, 0),
      6,
    );
  });
});
