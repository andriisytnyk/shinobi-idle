/**
 * The sustained-zone guard of `packages/core/test/sustained.test.ts` as a score: two game hours of zone
 * fighting without healing items against each regular enemy at its level, katon and doton, the player
 * restarting after a defeat; at most two defeats each. The penalty is the sum of the excess.
 */
import { content, type NatureId } from '@shinobi/content';
import {
  advance,
  createState,
  dispatch,
  refreshUnlocks,
  teamFor,
  updateQuests,
} from '@shinobi/core';
import { levelsFor } from '../../../core/test/fight-helpers.ts';
import { setLevel } from '../../../core/test/helpers.ts';
import { openWorld } from '../../../core/test/prep-state.ts';

const regular = content.enemies.filter(
  (e) => e.id !== 'core:dummy' && content.zones.some((z) => z.enemy === e.id),
);

function grind(enemyId: string, nature: NatureId, hours: number): number {
  const enemy = content.enemies.find((e) => e.id === enemyId)!;
  const zone = content.zones.find((z) => z.enemy === enemyId);
  const state = createState(77, content);
  state.player.rank = 'genin';
  openWorld(state);
  state.player.natures = [nature];
  state.team = teamFor(content, nature);
  const levels = levelsFor(enemy.cl, nature);
  for (const skill of Object.keys(levels) as (keyof typeof levels)[])
    setLevel(state, skill, levels[skill]!);
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  let defeats = 0;
  const start = () =>
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'fight', id: zone?.id ?? enemyId },
      content,
    );
  start();
  for (let t = 0; t < hours * 3_600_000; t += 60_000) {
    advance(state, 60_000, content);
    if (!state.slots[0]?.action) {
      defeats++;
      start();
    }
  }
  return defeats;
}

export function sustainedScore(hours = 2): { penalty: number; lines: string[] } {
  let penalty = 0;
  const lines: string[] = [];
  for (const e of regular) {
    const d = (['katon', 'doton'] as NatureId[]).map((n) => grind(e.id, n, hours));
    const excess = d.reduce((s, x) => s + Math.max(0, x - 2), 0);
    penalty += Math.min(excess, 30) * 0.05;
    lines.push(
      `SUSTAINED ${e.id.replace('core:', '').padEnd(14)} defeats katon ${d[0]} doton ${d[1]} ${excess > 0 ? '<<<' : ''}`,
    );
  }
  return { penalty, lines };
}
