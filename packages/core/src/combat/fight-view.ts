import type { ContentDb } from '@shinobi/content';
import { evasionAgainst, makeCtx, speed } from './fight.ts';
import type { Combatant, FightAct, FightRules, FightState, LastAct } from './fight-types.ts';
import { KNOWLEDGE_MAX, knowledgeTerm, partsAgainst, type EvasionPart } from './numbers.ts';
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
  /** The player's evasion rating split by source (the base, the rank, every defensive technique, gear); absent for an enemy. */
  evasion?: { total: number; parts: EvasionPart[] };
}

/** Below this much a rating difference is rounding, not an effect. */
const EFFECT_EPS = Math.sqrt(Number.EPSILON);

/** The status of one combatant of a fight. */
export function combatantStatus(
  fight: FightState,
  c: Combatant,
  content: ContentDb,
  rules: FightRules,
): CombatantStatus {
  const rate = speed(makeCtx(fight, content, rules), c);
  const left = Math.max(0, c.timer.need - c.timer.progress);
  // The effect that stops the clock is the speed modifier that brings it to zero (a stun), not a slowing one (wet).
  const stopper = c.effects.find(
    (e) => e.kind === 'modifier' && e.stat === 'speed' && e.op === 'mul' && e.value <= 0,
  );
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
            avoidedBy: c.last.avoidedBy,
          },
    ...(c === fight.player ? { evasion: evasionView(fight, content, rules) } : {}),
  };
}

/**
 * The player's evasion rating and its parts, against the first living enemy. The total is what the hit roll uses
 * (`evasionAgainst`): the level of the player's skills against the level of the attacker adjusts every defensive
 * technique (named on the part as `levelAdj`), knowing the attacker adds a `knowledge` part, and what Wounds and
 * the timed modifiers (a smoke bomb, a bind) add or take away is the `effects` part, so the parts sum to the total.
 */
function evasionView(
  fight: FightState,
  content: ContentDb,
  rules: FightRules,
): { total: number; parts: EvasionPart[] } {
  const attacker = fight.enemies.find((e) => e.hp > 0);
  if (!attacker) {
    return { total: fight.player.evasion, parts: fight.kit.evasion.map((p) => ({ ...p })) };
  }
  const total = evasionAgainst(makeCtx(fight, content, rules), fight.player, attacker);
  const level = attacker.data['combat.level'];
  const parts =
    level === undefined
      ? fight.kit.evasion.map((p) => ({ ...p }))
      : partsAgainst(fight.kit.evasion, level, content);
  const known = fight.player.data[`know.${attacker.entry}`] ?? KNOWLEDGE_MAX;
  parts.push({
    source: 'knowledge',
    id: attacker.entry,
    value: knowledgeTerm(known, content),
    knowledgeLevel: known,
  });
  const rest = total - parts.reduce((n, p) => n + p.value, 0);
  if (Math.abs(rest) > EFFECT_EPS) parts.push({ source: 'effects', id: null, value: rest });
  return { total, parts };
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
