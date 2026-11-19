/**
 * The sustained-zone guard of `packages/core/test/sustained.test.ts` as a score: two game hours of zone
 * fighting without healing items against each regular enemy at its level, katon and doton, the player
 * restarting after a defeat; at most two defeats each. The penalty is the sum of the excess.
 */
import { readFileSync } from 'node:fs';
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

export function grindStats(
  enemyId: string,
  nature: NatureId,
  hours: number,
): { defeats: number; kills: number } {
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
  return { defeats, kills: state.counters[`kills.${enemyId}`] ?? 0 };
}

const PRE2 = JSON.parse(
  readFileSync(
    new URL(
      '../../../../docs/balance-evidence/baseline-dev-3f559af-sustained-kills.json',
      import.meta.url,
    ),
    'utf8',
  ),
).kills as Record<string, [number, number]>;
/** Kills must stay within this share of the pre-v2 numbers (the design asks for about 10%). */
export const KILLS_FLOOR = 0.9;

export function sustainedScore(hours = 2): { penalty: number; lines: string[] } {
  let penalty = 0;
  const lines: string[] = [];
  for (const e of regular) {
    const name = e.id.replace('core:', '');
    const r = (['katon', 'doton'] as NatureId[]).map((n) => grindStats(e.id, n, hours));
    const excess = r.reduce((s, x) => s + Math.max(0, x.defeats - 2), 0);
    penalty += Math.min(excess, 30) * 0.2;
    const ratio = r.map((x, i) => x.kills / PRE2[name]![i]!);
    const short = ratio.reduce((s, x) => s + Math.max(0, KILLS_FLOOR - x), 0);
    penalty += short * 4;
    lines.push(
      `SUSTAINED ${name.padEnd(14)} defeats katon ${r[0]!.defeats} doton ${r[1]!.defeats} kills x${ratio[0]!.toFixed(2)} x${ratio[1]!.toFixed(2)} ${excess > 0 || short > 0 ? '<<<' : ''}`,
    );
  }
  return { penalty, lines };
}
