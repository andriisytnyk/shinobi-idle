/**
 * The defensive techniques count for more or less by the level of their skill against the combat level of the attacker:
 * contribution = value x mastery share x clamp(1 + k x (skill level - attacker level), min, max). Enemies are unchanged.
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

const L = content.balance.K.evaLevel;
const snapAt = (nin: number) => {
  const snap = playerFor(30, 'katon');
  return { ...snap, levels: { ...snap.levels, nin } };
};
const techPart = (parts: ReturnType<typeof evasionParts>, id = 'core:clone') =>
  parts.find((p) => p.source === 'technique' && p.id === id);

describe('level of the skill against the level of the attacker', () => {
  it('is 1 at equal levels, 1 + k per level, and clamped between min and max', () => {
    expect(levelScale(0, content)).toBe(1);
    expect(levelScale(5, content)).toBeCloseTo(1 + 5 * L.k, 9);
    expect(levelScale(-5, content)).toBeCloseTo(1 - 5 * L.k, 9);
    expect(levelScale(1000, content)).toBe(L.max);
    expect(levelScale(-1000, content)).toBe(L.min);
  });

  it('carries the skill level of each defensive technique on its part', () => {
    const part = techPart(evasionParts(snapAt(17), content));
    expect(part?.skillLevel).toBe(17);
  });

  it('gives more from a technique whose skill is higher, against the same attacker', () => {
    const low = techPart(partsAgainst(evasionParts(snapAt(10), content), 30, content));
    const high = techPart(partsAgainst(evasionParts(snapAt(40), content), 30, content));
    expect(high!.value).toBeGreaterThan(low!.value);
  });

  it('gives less against an attacker of a higher level, and names the adjustment on the part', () => {
    const parts = evasionParts(snapAt(30), content);
    const weak = techPart(partsAgainst(parts, 20, content))!;
    const even = techPart(partsAgainst(parts, 30, content))!;
    const strong = techPart(partsAgainst(parts, 40, content))!;
    expect(weak.value).toBeGreaterThan(even.value);
    expect(even.value).toBeGreaterThan(strong.value);
    expect(even.levelAdj).toBe(0);
    expect(strong.levelAdj).toBeCloseTo(techPart(parts)!.value * (levelScale(-10, content) - 1), 9);
    expect(strong.levelAdj).toBeLessThan(0);
    // The value is the raw contribution plus the adjustment; the other parts are untouched.
    expect(strong.value).toBeCloseTo(techPart(parts)!.value + strong.levelAdj!, 9);
    const base = partsAgainst(parts, 40, content).find((p) => p.source === 'base');
    expect(base?.levelAdj).toBeUndefined();
  });

  it('stops at the clamp however far apart the levels are', () => {
    const parts = evasionParts(snapAt(1), content);
    const raw = techPart(parts)!.value;
    expect(techPart(partsAgainst(parts, 1000, content))!.value).toBeCloseTo(raw * L.min, 9);
    const high = evasionParts(snapAt(1000 > 99 ? 99 : 1000), content);
    expect(techPart(partsAgainst(high, 1, content))!.value).toBeCloseTo(
      techPart(high)!.value * L.max,
      9,
    );
  });

  it('applies in the fight: the player is harder to hit for a lower-level enemy, and enemies are unchanged', () => {
    const rating = (cl: number) => {
      const fight = createFight(playerFor(30, 'katon'), enemyAt(cl), 1, content, rules);
      const enemy = fight.enemies[0]!;
      return {
        player: evasionAgainst(makeCtx(fight, content, rules), fight.player, enemy),
        fight,
      };
    };
    const low = rating(10);
    const high = rating(50);
    expect(low.player).toBeGreaterThan(high.player);
    // An enemy's evasion comes from its own level and tier, not from the skills of the player.
    const weakPlayer = createFight(playerFor(10, 'katon'), enemyAt(30), 1, content, rules);
    const strongPlayer = createFight(playerFor(40, 'katon'), enemyAt(30), 1, content, rules);
    expect(weakPlayer.enemies[0]!.evasion).toBe(strongPlayer.enemies[0]!.evasion);
    // The fight view shows the adjustment per technique.
    const parts = fightStatus(high.fight, content, rules).player.evasion?.parts ?? [];
    const clone = parts.find((p) => p.id === 'core:clone');
    expect(clone?.levelAdj).toBeLessThan(0);
  });
});
