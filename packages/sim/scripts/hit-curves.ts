/**
 * The hit-chance curves: for a typical character against a regular enemy of its own level, across levels 1-50,
 * how often the enemy hits the player (with the defensive techniques neglected, typical and maxed) and how often
 * the player hits the enemy. The bands: the enemy hits a typical player 50-70%, the player hits 75-90%.
 * Run: `pnpm --filter @shinobi/sim exec tsx scripts/hit-curves.ts`.
 */
import { content as defaultContent } from '@shinobi/content';
import {
  accuracyOf,
  accuracyTierTerm,
  defaultRules,
  enemyStats,
  evasionOf,
  evasionTierTerm,
  hitChance,
  snapshotPlayer,
} from '@shinobi/core';
import type { ContentDb } from '@shinobi/content';
import { buildCharacter, rankForLevel } from '../src/character.ts';
import { defaultNature } from '../src/constants.ts';

export interface CurvePoint {
  level: number;
  tier: number;
  enemyTier: number;
  enemyHits: { neglect: number; typical: number; max: number };
  /** A character of all five natures, who knows every defensive technique, at typical and full mastery. */
  allNatures: { typical: number; max: number };
  playerHits: number;
  /** The same two chances on dev at 3f559af: a typical character with the Evasion skill at its level. */
  baseline: { enemyHits: number; playerHits: number };
}

/** The hit roll of dev at 3f559af: accuracy against evasion, as in Melvor, clamped to 5-95%. */
const oldHit = (acc: number, eva: number): number =>
  Math.min(0.95, Math.max(0.05, acc < eva ? (0.5 * acc) / eva : 1 - (0.5 * eva) / acc));
/** What dev at 3f559af gave a character of this level against an enemy of its level (Evasion skill 30 + 5 x level; enemy 40 + 4.5 x level and 30 + 4.2 x level; accuracy 40 + 5 x level). */
export const baselineAt = (level: number): { enemyHits: number; playerHits: number } => ({
  enemyHits: oldHit(40 + 4.5 * level, 30 + 5 * level),
  playerHits: oldHit(40 + 5 * level, 30 + 4.2 * level),
});

const NATURES = ['katon', 'futon', 'raiton', 'doton', 'suiton'] as never[];
export const LEVELS = [
  1, 2, 3, 5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 33, 36, 39, 40, 42, 45, 48, 50,
];

/** The AI tier index a regular enemy of this combat level gets (the thresholds of `K.ai.enemyTier`). */
function enemyTierIndex(level: number, content: ContentDb): number {
  const from: Record<string, number> = content.balance.K.ai.enemyTier;
  let chosen = 0;
  let at = -1;
  content.ai.tiers.forEach((t, i) => {
    const l = from[t.id];
    if (l !== undefined && level >= l && l > at) [chosen, at] = [t.minTier, l];
    else if (i === 0 && at < 0) chosen = t.minTier;
  });
  return chosen;
}

export function curves(content: ContentDb = defaultContent): CurvePoint[] {
  const K = content.balance.K;
  return LEVELS.map((level) => {
    const at = (mastery: number | undefined, all = false) => {
      const state = buildCharacter(content, {
        seed: 1,
        level,
        rank: rankForLevel(level, content),
        natures: all ? [...NATURES] : [defaultNature(content)],
        ...(mastery === undefined ? {} : { mastery }),
      });
      return snapshotPlayer(state, content, defaultRules);
    };
    const enemy = enemyStats({ cl: level }, content);
    const et = enemyTierIndex(level, content);
    const eAcc = enemy.accuracy + accuracyTierTerm(et, content, true);
    const eEva = enemy.evasion + evasionTierTerm(et, content, true);
    const typical = at(undefined);
    const tier = typical.tier ?? 0;
    const hits = (snap: ReturnType<typeof at>) =>
      hitChance(eAcc, evasionOf(snap, content), content);
    const pAcc = accuracyOf(typical.levels, 'tai', content) + accuracyTierTerm(tier, content);
    return {
      level,
      tier,
      enemyTier: et,
      enemyHits: {
        neglect: hits(at(1)),
        typical: hits(typical),
        max: hits(at(K.masteryCap)),
      },
      allNatures: { typical: hits(at(undefined, true)), max: hits(at(K.masteryCap, true)) },
      playerHits: hitChance(pAcc, eEva, content),
      baseline: baselineAt(level),
    };
  });
}

const out = (x: number, lo: number, hi: number): number => Math.max(0, lo - x, x - hi);
const TOL = 0.04;
/** The typical character's two curves stay within TOL of dev's; neglecting the defence is worse, maxing it clearly better. */
export function curveLoss(): number {
  let l = 0;
  for (const c of curves()) {
    l += out(c.enemyHits.typical, c.baseline.enemyHits - TOL, c.baseline.enemyHits + TOL) * 4;
    l += out(c.playerHits, c.baseline.playerHits - TOL, c.baseline.playerHits + TOL) * 4;
    if (c.level >= 8) l += Math.max(0, 0.1 - (c.enemyHits.typical - c.enemyHits.max));
    l += Math.max(0, c.enemyHits.typical - c.enemyHits.neglect);
    l += Math.max(0, 0.3 - c.allNatures.typical);
  }
  return l;
}
if (process.argv[1]?.endsWith('hit-curves.ts')) {
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  console.log(
    "| Рівень | Ранг (тір) | Ворог (тір ШІ) | Ворог влучає: без захисних технік / типово / повна Майстерність (було) | Гравець влучає (було) | Усі п'ять природ: типово / повна |",
  );
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const p of curves()) {
    console.log(
      `| ${p.level} | ${p.tier} | ${p.enemyTier} | ${pct(p.enemyHits.neglect)} / ${pct(p.enemyHits.typical)} / ${pct(p.enemyHits.max)} (${pct(p.baseline.enemyHits)}) | ${pct(p.playerHits)} (${pct(p.baseline.playerHits)}) | ${pct(p.allNatures.typical)} / ${pct(p.allNatures.max)} |`,
    );
  }
}
