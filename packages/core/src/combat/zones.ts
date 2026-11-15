import type { Boss, ContentDb, Enemy, Operation, Zone } from '@shinobi/content';
import { indexOf } from '../lookup.ts';
import { evalReq, type Req } from '../requirements.ts';
import type { GameState } from '../state.ts';

/** The enemy or boss entry with this id. */
export function entryOf(content: ContentDb, id: string): Enemy | Boss | undefined {
  const index = indexOf(content);
  return index.enemies.get(id) ?? index.bosses.get(id);
}

/**
 * What must hold to fight in a zone. A region zone is open from the rank the balance extension
 * names (until exploration supplies the region flags); the Academy yard is always open, and a
 * boss zone opens with its flag.
 */
export function zoneRequirement(zone: Zone, content: ContentDb): Req | null {
  const open = content.balance.K.regionZones;
  // The regions that open with their flag are named in the balance extension.
  if (open.openFromRank !== 'off' && open.regions.includes(zone.region)) {
    return { t: 'rank', rank: open.openFromRank };
  }
  return zone.unlock;
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
  const short = evalReq(state, stage.shortenedBy, content).met;
  return Math.round(K.operation.approachMs * (short ? K.operation.approachShort : 1));
}
