/**
 * Sustained zone fighting: two game hours without a break, each regular enemy at the level of the
 * player, genin tactics, the automatic loadout and no healing items at all. The player restarts
 * the zone after a defeat, as a player coming back would. Defeats and Wounds are printed.
 */
import { content, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  dispatch,
  refreshUnlocks,
  teamFor,
  updateQuests,
} from '../src/index.ts';
import { levelsFor } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';

const HOURS = 2;
// The thief is a mission enemy: no zone, fought only through its mission, so not here.
const regular = content.enemies.filter(
  (e) => e.id !== 'core:dummy' && content.zones.some((z) => z.enemy === e.id),
);

function grind(
  enemyId: string,
  nature: NatureId,
): { defeats: number; wounds: number; kills: number } {
  const enemy = content.enemies.find((e) => e.id === enemyId);
  const zone = content.zones.find((z) => z.enemy === enemyId);
  if (!enemy) throw new Error(enemyId);
  const state = createState(77, content);
  state.player.rank = 'genin';
  state.player.natures = [nature];
  state.team = teamFor(nature);
  const levels = levelsFor(enemy.cl, nature);
  for (const skill of Object.keys(levels) as (keyof typeof levels)[])
    setLevel(state, skill, levels[skill]);
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  let defeats = 0;
  let wounds = 0;
  const start = () =>
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'fight', id: zone?.id ?? enemyId },
      content,
    );
  start();
  const total = HOURS * 3_600_000;
  for (let t = 0; t < total; t += 60_000) {
    const before = state.wounds.stacks;
    advance(state, 60_000, content);
    if (!state.slots[0]?.action) {
      defeats++;
      start();
    }
    wounds = Math.max(wounds, state.wounds.stacks, before);
  }
  return { defeats, wounds, kills: state.counters[`kills.${enemyId}`] ?? 0 };
}

describe('two hours of continuous zone fighting without healing items', () => {
  const natures: NatureId[] = ['katon', 'doton'];
  const rows = regular.map((enemy) => ({
    enemy,
    results: natures.map((n) => ({ n, r: grind(enemy.id, n) })),
  }));

  it('prints defeats and peak Wounds per enemy', () => {
    const lines = rows.map(
      ({ enemy, results }) =>
        `| ${enemy.id.replace('core:', '')} | ${enemy.cl} | ${enemy.traits.join(', ') || '-'} | ${results
          .map(({ r }) => `${r.defeats} / ${r.wounds} / ${r.kills}`)
          .join(' | ')} |`,
    );
    console.log(
      `Sustained (${HOURS} h, genin, auto loadout, no items): defeats / peak wounds / kills\n| enemy | level | traits | Katon | Doton |\n| --- | --- | --- | --- | --- |\n${lines.join('\n')}`,
    );
    expect(lines).toHaveLength(22);
  });

  for (const { enemy, results } of rows) {
    for (const { n, r } of results) {
      it(`${enemy.id.replace('core:', '')} (${n}): ${enemy.traits.length === 0 ? 'no defeats' : 'at most 2 defeats'}`, () => {
        expect(r.defeats).toBeLessThanOrEqual(enemy.traits.length === 0 ? 0 : 2);
      });
    }
  }
});
