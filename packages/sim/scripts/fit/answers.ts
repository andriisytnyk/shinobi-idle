/**
 * The answer guards of `packages/core/test/fight-engine.test.ts` (A8) as a score: a level-34 fight against an enemy with
 * a trait is won at least 15% faster by a player who carries the answer to the trait than by one who does not.
 */
import { simulateFights, defaultRules } from '@shinobi/core';
import { enemyAt, playerFor } from '../../../core/test/fight-helpers.ts';

const CASES = [
  { trait: 'evasive', nature: 'doton', answer: (t: readonly string[]) => t.includes('bind') },
  {
    trait: 'regen',
    nature: 'katon',
    answer: (t: readonly string[], s: string | null) => t.includes('dot') || s === 'burn',
  },
  { trait: 'hidden', nature: 'futon', answer: (t: readonly string[]) => t.includes('reveal') },
] as const;

import { content } from '@shinobi/content';

export function answersScore(runs = 60): { penalty: number; lines: string[] } {
  let penalty = 0;
  const lines: string[] = [];
  for (const { trait, nature, answer } of CASES) {
    const enemy = enemyAt(34, [trait]);
    const withAnswer = simulateFights(playerFor(34, nature), enemy, runs, 7, content, defaultRules);
    const without = simulateFights(
      playerFor(34, nature, { without: answer }),
      enemy,
      runs,
      7,
      content,
      defaultRules,
    );
    const ratio = withAnswer.timeMs.mean / without.timeMs.mean;
    const p = Math.max(0, ratio - 0.85);
    penalty += p;
    lines.push(`ANSWER ${trait.padEnd(8)} with/without ${ratio.toFixed(2)} ${p > 0 ? '<<<' : ''}`);
  }
  return { penalty, lines };
}
