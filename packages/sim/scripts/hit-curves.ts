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
}

const NATURES = ['katon', 'futon', 'raiton', 'doton', 'suiton'] as never[];
export const LEVELS = [1, 2, 3, 5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 33, 36, 39, 40, 42, 45, 48, 50];

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
    const hits = (snap: ReturnType<typeof at>) => hitChance(eAcc, evasionOf(snap, content), content);
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
    };
  });
}

export const BANDS = { enemyHits: [0.5, 0.7], playerHits: [0.75, 0.9] } as const;

if (process.argv[1]?.endsWith('hit-curves.ts')) {
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  console.log('| Рівень | Ранг (тір) | Ворог (тір ШІ) | Ворог влучає: без захисних технік / типово / повна Майстерність | Гравець влучає | Усі п\'ять природ: типово / повна |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const p of curves()) {
    console.log(
      `| ${p.level} | ${p.tier} | ${p.enemyTier} | ${pct(p.enemyHits.neglect)} / ${pct(p.enemyHits.typical)} / ${pct(p.enemyHits.max)} | ${pct(p.playerHits)} | ${pct(p.allNatures.typical)} / ${pct(p.allNatures.max)} |`,
    );
  }
}
