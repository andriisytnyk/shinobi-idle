/**
 * A10: every regular enemy at the player's own level, against a genin with the automatic loadout
 * (4 slots, one nature) and an empty pouch, as a Katon player and as a Doton player.
 */
import { content, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { pct, playerFor, simulate } from './prep-helpers.ts';

const N = 400;
const regular = content.enemies.filter((e) => e.id !== 'core:dummy');

describe('A10: regular enemies at the level of the player', () => {
  it('has the 23 regular types and the training dummy', () => {
    expect(regular).toHaveLength(23);
    expect(content.enemies).toHaveLength(24);
  });

  const natures: NatureId[] = ['katon', 'doton'];
  const results = regular.map((enemy) => ({
    enemy,
    byNature: natures.map((nature) => ({
      nature,
      r: simulate(
        enemy,
        playerFor(enemy, nature, { prep: 'auto', tier: 1, knowsAll: false }),
        N,
        1,
      ),
    })),
  }));

  it('prints the table', () => {
    const lines = results.map(
      ({ enemy, byNature }) =>
        `| ${enemy.id.replace('core:', '')} | ${enemy.cl} | ${enemy.traits.join(', ') || '-'} | ${byNature
          .map(({ r }) => `${pct(r.winRate)} / ${(r.timeMs.mean / 1000).toFixed(0)} s`)
          .join(' | ')} |`,
    );
    console.log(
      `A10 (genin, automatic loadout, ${N} fights per cell)\n| enemy | level | traits | Katon | Doton |\n| --- | --- | --- | --- | --- |\n${lines.join('\n')}`,
    );
    expect(lines).toHaveLength(23);
  });

  for (const { enemy, byNature } of results) {
    for (const { nature, r } of byNature) {
      it(`${enemy.id.replace('core:', '')} (${nature}): wins at least 85% in at most 60 s`, () => {
        expect(r.winRate).toBeGreaterThanOrEqual(0.85);
        expect(r.timeMs.mean / 1000).toBeLessThanOrEqual(60);
      });
    }
  }
});
