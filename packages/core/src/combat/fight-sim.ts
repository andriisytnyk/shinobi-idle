import type { ContentDb } from '@shinobi/content';
import { createStream, nextUint32 } from '../rng.ts';
import { createFight, fightAdvance, fightTimeMs } from './fight.ts';
import type { Encounter, FightRules, FightTally } from './fight-types.ts';
import type { PlayerSnapshot } from './numbers.ts';

/** What many fights of one player against one enemy add up to. */
export interface FightSummary {
  fights: number;
  wins: number;
  /** Wins over fights, 0 to 1. A fight that hits the time cap counts as lost. */
  winRate: number;
  /** Fight time in ms over the won fights. */
  timeMs: { mean: number; p50: number; p90: number; p99: number };
  /** Health lost in the won fights: mean, and as a share of the player's maximum. */
  hpLost: { mean: number; share: number };
  /** Mean fight time in ms over all the fights, won or not. */
  timeAllMs: number;
  /** Per-fight average of the Wounds a fight costs (a defeat, a low finish, stances). */
  wounds: number;
  /** Per-fight averages of the pouch units used, by item id, and of the mastery work, by technique id. */
  items: Record<string, number>;
  masteryWork: Record<string, number>;
  /** Per-fight averages of the tally over all fights. */
  tally: {
    damage: Record<string, number>;
    uses: Record<string, number>;
    statuses: Record<string, number>;
    combos: Record<string, number>;
    basic: number;
    interrupts: number;
    kills: number;
    taken: number;
  };
}

/** The seed of fight `i` of a run, drawn from its own stream so fights are independent. */
function fightSeed(seed: number, i: number): number {
  return nextUint32(createStream(seed, `sim.${i}`));
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function addAll(into: Record<string, number>, from: Record<string, number>, n: number): void {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value / n;
}

/** A run of fights that can be advanced a few fights at a time; the result does not depend on how it was cut. */
export interface FightSim {
  /** Fights played so far. */
  readonly played: number;
  /** Fight time played so far, in ms. */
  readonly simulatedMs: number;
  /** Plays up to `fights` more fights (fewer when the run is over); true once all `n` are played. */
  step(fights: number): boolean;
  /** The summary of the fights played; complete once `step` has returned true. */
  summary(): FightSummary;
}

/**
 * Runs `n` fights of the player against the enemy and aggregates them. Every fight has its own
 * seed derived from `seed`. Reads its arguments only; no game state, no shared mutable state.
 */
export function simulateFights(
  snap: PlayerSnapshot,
  encounter: Encounter,
  n: number,
  seed: number,
  content: ContentDb,
  rules: FightRules,
): FightSummary {
  const sim = fightSim(snap, encounter, n, seed, content, rules);
  sim.step(n);
  return sim.summary();
}

/** The same run as `simulateFights`, advanced in steps of a few fights. */
export function fightSim(
  snap: PlayerSnapshot,
  encounter: Encounter,
  n: number,
  seed: number,
  content: ContentDb,
  rules: FightRules,
): FightSim {
  const times: number[] = [];
  const items: Record<string, number> = {};
  const masteryWork: Record<string, number> = {};
  let allMs = 0;
  let wounds = 0;
  let lost = 0;
  let share = 0;
  const tally: FightSummary['tally'] = {
    damage: {},
    uses: {},
    statuses: {},
    combos: {},
    basic: 0,
    interrupts: 0,
    kills: 0,
    taken: 0,
  };
  let played = 0;
  let simulatedMs = 0;
  const play = (i: number): void => {
    const fight = createFight(snap, encounter, fightSeed(seed, i), content, rules);
    fight.log = null;
    const startHp = fight.player.hp;
    fightAdvance(fight, fight.cap + 1, content, rules);
    const t: FightTally = fight.tally;
    addAll(tally.damage, t.damage, n);
    addAll(tally.uses, t.uses, n);
    addAll(tally.statuses, t.statuses, n);
    addAll(tally.combos, t.combos, n);
    tally.basic += t.basic / n;
    tally.interrupts += t.interrupts / n;
    tally.kills += t.kills / n;
    tally.taken += t.taken / n;
    addAll(masteryWork, t.masteryWork, n);
    snap.pouch?.forEach((slot, i) => {
      const spent = slot.n - (fight.pouch[i]?.n ?? slot.n);
      if (slot.id !== '' && spent > 0) items[slot.id] = (items[slot.id] ?? 0) + spent / n;
    });
    simulatedMs += fightTimeMs(fight);
    allMs += fightTimeMs(fight) / n;
    const won = fight.result === 'victory' || fight.result === 'fled';
    wounds +=
      ((fight.result === 'defeat' ? 1 : 0) +
        (won && fight.player.data.low === 1 ? 1 : 0) +
        t.wounds) /
      n;
    if (!won) return;
    times.push(fightTimeMs(fight));
    lost += startHp - fight.player.hp;
    share += (startHp - fight.player.hp) / fight.player.maxHp;
  };
  const summary = (): FightSummary => {
    const wins = times.length;
    const sorted = [...times].sort((a, b) => a - b);
    const mean = wins === 0 ? 0 : times.reduce((a, b) => a + b, 0) / wins;
    const p = (q: number) => percentile(sorted, q);
    return {
      fights: played,
      wins,
      winRate: played === 0 ? 0 : wins / played,
      timeMs: { mean, p50: p(1 / 2), p90: p(0.9), p99: p(0.99) },
      hpLost: { mean: wins === 0 ? 0 : lost / wins, share: wins === 0 ? 0 : share / wins },
      timeAllMs: allMs,
      wounds,
      items,
      masteryWork,
      tally,
    };
  };
  return {
    get played() {
      return played;
    },
    get simulatedMs() {
      return simulatedMs;
    },
    step(fights) {
      for (let k = 0; k < fights && played < n; k++) play(played++);
      return played >= n;
    },
    summary,
  };
}
