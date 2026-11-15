import type { Boss, ContentDb, Enemy, Operation, Zone } from '@shinobi/content';
import { setFlag } from '../flags.ts';
import { indexOf } from '../lookup.ts';
import { cellLevel } from '../world.ts';

import { evalReq, type Req } from '../requirements.ts';
import type { GameState } from '../state.ts';

/** Whether the zone's cell is explored to level 1; a zone tied to no cell is always explored. */
export function zoneExplored(state: GameState, zoneId: string, content: ContentDb): boolean {
  const cell = indexOf(content).zoneCell.get(zoneId);
  return cell ? cellLevel(state, cell, content) >= 1 : true;
}

/** The enemy or boss entry with this id. */
export function entryOf(content: ContentDb, id: string): Enemy | Boss | undefined {
  const index = indexOf(content);
  return index.enemies.get(id) ?? index.bosses.get(id);
}

/**
 * What must hold to fight in a zone: its flag (a region zone: the region is open; a boss zone:
 * the boss was unlocked; the Academy yard has none). A region zone also needs its cell explored,
 * which `zoneBlocked` checks.
 */
export function zoneRequirement(zone: Zone): Req | null {
  // The content names a rank by an open string; the core's requirement still types it by its own list of ranks.
  return zone.unlock as Req | null;
}

/** Why a zone cannot be fought for a reason that is no flag: its cell is not explored yet. Null when nothing is in the way. */
export function zoneBlocked(state: GameState, zone: Zone, content: ContentDb): string | null {
  return zoneExplored(state, zone.id, content) ? null : 'error.zoneNotExplored';
}

/**
 * Unlocks a boss for fighting: raises the flag its zone names. This is the one way quests and
 * missions open a boss. Returns false for an id that is no boss or whose zone has no flag.
 */
export function unlockBoss(state: GameState, boss: string, content: ContentDb): boolean {
  const index = indexOf(content);
  const zone = index.bosses.has(boss) ? index.zoneByEnemy.get(boss) : index.zones.get(boss);
  if (!zone || !index.bosses.has(zone.enemy) || zone.unlock?.t !== 'flag') return false;
  setFlag(state, zone.unlock.id, zone.unlock.n ?? true);
  return true;
}

/** What a `fight` action id names: a zone, or an enemy fought without one. Null when it names neither. */
export function fightTarget(
  content: ContentDb,
  id: string,
): { enemy: Enemy | Boss; zone: Zone | null } | null {
  const index = indexOf(content);
  const zone = index.zones.get(id);
  if (zone) {
    const enemy = entryOf(content, zone.enemy);
    return enemy ? { enemy, zone } : null;
  }
  // An enemy that belongs to no zone (a mission enemy) is fought through its mission or operation only.
  const enemy = index.enemies.get(id);
  return enemy && index.zoneByEnemy.has(id) ? { enemy, zone: null } : null;
}

/** One step of an operation once its stages are laid out: the approach, a fight with a named enemy, or one drawn from a pool. */
export type OpStep =
  { t: 'approach' } | { t: 'fight'; enemy: string } | { t: 'draw'; pool: readonly string[] };

/** The stages of an operation as a flat list of steps; a stage of days becomes its fights and then the finale. */
export function opSteps(op: Operation): OpStep[] {
  const steps: OpStep[] = [];
  for (const stage of op.stages) {
    if (stage.t === 'approach') steps.push({ t: 'approach' });
    else if (stage.t === 'fight') steps.push({ t: 'fight', enemy: stage.enemy });
    else {
      for (let i = 0; i < stage.days * stage.fightsPerDay; i++) {
        steps.push({ t: 'draw', pool: stage.pool });
      }
      steps.push({ t: 'fight', enemy: stage.finale });
    }
  }
  return steps;
}

/** Length of the approach stage in ms: shorter when the stage's requirement holds. */
export function approachMs(state: GameState, op: Operation, content: ContentDb): number {
  const K = content.balance.K;
  const stage = op.stages.find((s) => s.t === 'approach');
  if (!stage || stage.t !== 'approach') return 0;
  const short = evalReq(state, stage.shortenedBy as Req, content).met;
  return Math.round(K.operation.approachMs * (short ? K.operation.approachShort : 1));
}
