import type { ContentDb } from '@shinobi/content';
import { makeCtx, speed } from './fight.ts';
import type { Combatant, FightAct, FightRules, FightState, LastAct } from './fight-types.ts';
import { WORK_PER_MS } from './units.ts';

/*
 * What an interface needs to draw a fight: for every combatant, what it is doing and for how long,
 * and what its last action came to. Read from the fight; it changes nothing. Times are in game ms
 * of the fight clock.
 */

/** The last action of a combatant, with its time in ms. */
export interface LastActStatus extends Omit<LastAct, 'at'> {
  /** The fight time at which it was resolved or broken off. */
  atMs: number;
}

export interface CombatantStatus {
  id: string;
  side: 'player' | 'enemy';
  /** `wait` (waiting for the moment), `act` (doing something) or `rest` (the player catching its breath). */
  phase: Combatant['phase'];
  /** The effect (a stun, a bind) or hook that stops the phase's clock now; null while it runs. */
  suspendedBy: string | null;
  /** What it is doing: a technique id, the basic strike, an item id, an enemy's attack, or a rest; null while it waits. */
  action: FightAct | null;
  /** The fight time at which the phase began. */
  startedMs: number;
  /** The fight time at which the phase ends at the speed it has now; null while it is stopped. */
  endsMs: number | null;
  /** The action that ended last; null before the first. */
  last: LastActStatus | null;
}

/** The status of one combatant of a fight. */
export function combatantStatus(
  fight: FightState,
  c: Combatant,
  content: ContentDb,
  rules: FightRules,
): CombatantStatus {
  const rate = speed(makeCtx(fight, content, rules), c);
  const left = Math.max(0, c.timer.need - c.timer.progress);
  const stopper = c.effects.find((e) => e.kind === 'modifier' && e.stat === 'speed');
  return {
    id: c.id,
    side: c.side,
    phase: c.phase,
    suspendedBy: rate > 0 ? null : (stopper?.id ?? 'hook'),
    action: c.act === null ? null : { ...c.act },
    startedMs: Math.floor(c.phaseAt / WORK_PER_MS),
    endsMs: rate > 0 ? Math.floor((fight.t + Math.ceil(left / rate)) / WORK_PER_MS) : null,
    last:
      c.last === null
        ? null
        : {
            kind: c.last.kind,
            id: c.last.id,
            outcome: c.last.outcome,
            damage: c.last.damage,
            statuses: [...c.last.statuses],
            combos: [...c.last.combos],
            atMs: Math.floor(c.last.at / WORK_PER_MS),
          },
  };
}

/** The status of the player and of every living enemy. */
export function fightStatus(
  fight: FightState,
  content: ContentDb,
  rules: FightRules,
): { player: CombatantStatus; enemies: CombatantStatus[] } {
  return {
    player: combatantStatus(fight, fight.player, content, rules),
    enemies: fight.enemies
      .filter((e) => e.hp > 0)
      .map((e) => combatantStatus(fight, e, content, rules)),
  };
}
