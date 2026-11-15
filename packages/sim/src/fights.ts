import type { Boss, ContentDb, Enemy } from '@shinobi/content';
import {
  bossNature,
  createFight,
  createStream,
  encounterFor,
  fightAdvance,
  fightTimeMs,
  nextUint32,
  snapshotPlayer,
  type Encounter,
  type FightResult,
  type GameState,
  type PlayerSnapshot,
  type Rules,
} from '@shinobi/core';

export type Outcome = 'victory' | 'defeat' | 'fled' | 'timeout';
const OUTCOMES: readonly Outcome[] = ['victory', 'defeat', 'fled', 'timeout'];

/** What many fights of one snapshot against one encounter add up to. */
export interface FightStats {
  runs: number;
  /** Victories and fled enemies over all runs (the same count `simulateFights` calls wins). */
  winRate: number;
  outcomes: Record<Outcome, number>;
  /** Fight time in seconds over the won fights; null when none was won. */
  timeSec: { mean: number; p10: number; p90: number } | null;
  /** Player health left at the end of the won fights; null when none was won. */
  hpLeft: { mean: number; share: number } | null;
  maxHp: number;
  /** Share of all damage dealt, by technique id (`basic` for basic attacks), largest first. */
  damageShare: Record<string, number>;
}

/** The seed of fight `i`, the same stream `simulateFights` draws its fights' seeds from. */
const fightSeed = (seed: number, i: number): number => nextUint32(createStream(seed, `sim.${i}`));

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}

/** The encounter the game builds for this entry and this state (a boss takes the nature the state gives it). */
export function encounterOf(state: GameState, entry: Enemy | Boss, content: ContentDb): Encounter {
  return encounterFor(entry, content, [], 'special' in entry ? bossNature(state, entry) : null);
}

/** The snapshot the game takes of the player when a fight with `entryId` begins. */
export function fightSnapshot(
  state: GameState,
  entryId: string,
  content: ContentDb,
  rules: Rules,
): PlayerSnapshot {
  return snapshotPlayer(state, content, rules, undefined, [entryId]);
}

/** Runs `runs` fights through the engine's own fight loop and condenses them. Pure in its arguments. */
export function runFights(
  snap: PlayerSnapshot,
  encounter: Encounter,
  runs: number,
  seed: number,
  content: ContentDb,
  rules: Rules,
): FightStats {
  const outcomes: Record<Outcome, number> = { victory: 0, defeat: 0, fled: 0, timeout: 0 };
  const times: number[] = [];
  const damage: Record<string, number> = {};
  let hpLeft = 0;
  let share = 0;
  let maxHp = 0;
  for (let i = 0; i < runs; i++) {
    const fight = createFight(snap, encounter, fightSeed(seed, i), content, rules);
    fight.log = null;
    maxHp = fight.player.maxHp;
    fightAdvance(fight, fight.cap + 1, content, rules);
    const result: FightResult = fight.result;
    if (OUTCOMES.includes(result as Outcome)) outcomes[result as Outcome]++;
    else outcomes.timeout++;
    for (const [id, dealt] of Object.entries(fight.tally.damage)) {
      damage[id] = (damage[id] ?? 0) + dealt;
    }
    if (result === 'victory' || result === 'fled') {
      times.push(fightTimeMs(fight) / 1000);
      hpLeft += fight.player.hp;
      share += fight.player.hp / fight.player.maxHp;
    }
  }
  times.sort((a, b) => a - b);
  const wins = times.length;
  const total = Object.values(damage).reduce((a, b) => a + b, 0);
  const damageShare = Object.fromEntries(
    Object.entries(damage)
      .filter(([, dealt]) => dealt > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([id, dealt]) => [id, dealt / total]),
  );
  return {
    runs,
    winRate: runs === 0 ? 0 : wins / runs,
    outcomes,
    timeSec:
      wins === 0
        ? null
        : {
            mean: times.reduce((a, b) => a + b, 0) / wins,
            p10: percentile(times, 0.1),
            p90: percentile(times, 0.9),
          },
    hpLeft: wins === 0 ? null : { mean: hpLeft / wins, share: share / wins },
    maxHp,
    damageShare,
  };
}
