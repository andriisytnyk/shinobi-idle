import type { ContentDb, Enemy } from '@shinobi/content';
import { createStream, nextUint32 } from '../rng.ts';
import { createFight, fightAdvance, fightTimeMs } from './fight.ts';
import type { FightRules, FightTally } from './fight-types.ts';
import type { PlayerSnapshot } from './numbers.ts';
import { workOf } from './units.ts';

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

/**
 * Runs `n` fights of the player against the enemy and aggregates them. Every fight has its own
 * seed derived from `seed`. Reads its arguments only; no game state, no shared mutable state.
 */
export function simulateFights(
  snap: PlayerSnapshot,
  enemy: Enemy,
  n: number,
  seed: number,
  content: ContentDb,
  rules: FightRules,
): FightSummary {
  const cap = workOf(content.balance.K.combat.fightCapMs);
  const times: number[] = [];
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
  for (let i = 0; i < n; i++) {
    const fight = createFight(snap, enemy, fightSeed(seed, i), content, rules);
    fight.log = null;
    const startHp = fight.player.hp;
    fightAdvance(fight, cap, content, rules);
    const t: FightTally = fight.tally;
    addAll(tally.damage, t.damage, n);
    addAll(tally.uses, t.uses, n);
    addAll(tally.statuses, t.statuses, n);
    addAll(tally.combos, t.combos, n);
    tally.basic += t.basic / n;
    tally.interrupts += t.interrupts / n;
    tally.kills += t.kills / n;
    tally.taken += t.taken / n;
    if (fight.result !== 'victory') continue;
    times.push(fightTimeMs(fight));
    lost += startHp - fight.player.hp;
    share += (startHp - fight.player.hp) / fight.player.maxHp;
  }
  const wins = times.length;
  times.sort((a, b) => a - b);
  const mean = wins === 0 ? 0 : times.reduce((a, b) => a + b, 0) / wins;
  const p = (q: number) => percentile(times, q);
  return {
    fights: n,
    wins,
    winRate: n === 0 ? 0 : wins / n,
    timeMs: { mean, p50: p(1 / 2), p90: p(0.9), p99: p(0.99) },
    hpLost: { mean: wins === 0 ? 0 : lost / wins, share: wins === 0 ? 0 : share / wins },
    tally,
  };
}
