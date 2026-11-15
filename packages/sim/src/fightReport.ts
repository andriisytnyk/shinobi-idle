import {
  content as defaultContent,
  type Boss,
  type ContentDb,
  type Enemy,
  type NatureId,
} from '@shinobi/content';
import { defaultRules, type Rank, type Rules } from '@shinobi/core';
import {
  buildCharacter,
  equipFor,
  rankForLevel,
  type FoodMode,
  type PouchMode,
} from './character.ts';
import { defaultNature, REPORT } from './constants.ts';
import { encounterOf, fightSnapshot, runFights, type FightStats } from './fights.ts';
import { modelExpectation, type ModelExpectation } from './model.ts';

export type Reason = 'ratio' | 'win' | 'fewWins' | 'noWins';

export interface FightRow {
  enemy: string;
  boss: boolean;
  /** The enemy's combat level. */
  cl: number;
  /** Level the character really has (the asked level clamped to the skill cap). */
  level: number;
  requestedLevel: number;
  rank: Rank;
  natures: NatureId[];
  pouch: PouchMode;
  food: FoodMode;
  loadout: string[];
  /** The fights with the pouch and food above. */
  stats: FightStats;
  /** The same fights with the shop's pouch tools (equal to `stats` when `pouch` is `shop`); null when not run. */
  withPouch: FightStats | null;
  model: ModelExpectation | null;
  /** Won fights the mean time rests on. */
  wins: number;
  /** Mean fight time of the engine over the model's time to kill; null when either is missing. */
  ratio: number | null;
  /** Why the row is marked; empty when it is not. */
  reasons: Reason[];
  flagged: boolean;
}

export interface FightReportOptions {
  /** Enemy and boss entry ids to run. */
  entries: readonly string[];
  /** Skill level of the character; default is each entry's own combat level (up to the skill cap). */
  level?: number;
  natures?: readonly NatureId[];
  rank?: Rank;
  /** Pouch of the fights the ratio is computed on (default `none`). */
  pouch?: PouchMode;
  /** Meals: default `model` for a boss, `none` for an ordinary enemy. */
  food?: FoodMode;
  /** Also run the fights with the shop's pouch, as a second time column (default true). */
  comparePouch?: boolean;
  runs: number;
  seed: number;
  content?: ContentDb;
  rules?: Rules;
}

/** Every enemy and boss entry of the content, enemies first, in content order. */
export function allEntries(content: ContentDb): (Enemy | Boss)[] {
  return [...content.enemies, ...content.bosses];
}

const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;

/** Why a row is marked, by the report thresholds in `REPORT`. */
export function reasonsFor(
  boss: boolean,
  stats: FightStats,
  wins: number,
  ratio: number | null,
): Reason[] {
  const out: Reason[] = [];
  const [lo, hi] = REPORT.ratioBand;
  if (wins === 0) out.push('noWins');
  else if (wins < REPORT.minWinsForRatio) out.push('fewWins');
  if (ratio !== null && (ratio < lo || ratio > hi)) out.push('ratio');
  const [bossLo, bossHi] = REPORT.bossWinBand;
  const off = boss
    ? stats.winRate < bossLo || stats.winRate > bossHi
    : stats.winRate < REPORT.enemyMinWin;
  if (off) out.push('win');
  return out;
}

/** One row: a yardstick character built by the engine's own means, fights run on the engine's fight loop, the model beside it. */
export function fightRow(entry: Enemy | Boss, o: FightReportOptions): FightRow {
  const content = o.content ?? defaultContent;
  const rules = o.rules ?? defaultRules;
  const K = content.balance.K;
  const boss = !('region' in entry);
  const requestedLevel = o.level ?? entry.cl;
  const level = Math.min(K.cap, Math.max(1, requestedLevel));
  const rank = o.rank ?? rankForLevel(level, content);
  const natures = [...(o.natures ?? [defaultNature()])];
  const pouch = o.pouch ?? 'none';
  const food = o.food ?? (boss ? 'model' : 'none');

  const play = (mode: PouchMode) => {
    const state = buildCharacter(content, { seed: o.seed, level, rank, natures });
    equipFor(state, entry.id, content, rules, { pouch: mode, food }, level);
    const stats = runFights(
      fightSnapshot(state, entry.id, content, rules),
      encounterOf(state, entry, content),
      o.runs,
      o.seed,
      content,
      rules,
    );
    return { state, stats };
  };
  const main = play(pouch);
  const withPouch =
    pouch === 'shop' ? main.stats : o.comparePouch === false ? null : play('shop').stats;
  const model = modelExpectation(entry, main.state, content);
  const wins = main.stats.outcomes.victory + main.stats.outcomes.fled;
  const ratio = model && main.stats.timeSec ? main.stats.timeSec.mean / model.ttkSec : null;
  const reasons = reasonsFor(boss, main.stats, wins, ratio);
  return {
    enemy: entry.id,
    boss,
    cl: entry.cl,
    level,
    requestedLevel,
    rank,
    natures,
    pouch,
    food,
    loadout:
      main.state.loadouts.active.length > 0
        ? [...main.state.loadouts.active]
        : Object.keys(main.stats.damageShare),
    stats: main.stats,
    withPouch,
    model,
    wins,
    ratio,
    reasons,
    flagged: reasons.length > 0,
  };
}

export function fightReport(o: FightReportOptions): FightRow[] {
  const content = o.content ?? defaultContent;
  const index = new Map(allEntries(content).map((e) => [e.id, e] as const));
  return o.entries.map((id) => {
    const entry = index.get(id);
    if (!entry) throw new RangeError(`unknown enemy or boss «${id}»`);
    return fightRow(entry, o);
  });
}

const statsJson = (s: FightStats) => ({
  winRate: round(s.winRate),
  outcomes: s.outcomes,
  timeSec: s.timeSec && {
    mean: round(s.timeSec.mean, 2),
    p10: round(s.timeSec.p10, 2),
    p90: round(s.timeSec.p90, 2),
  },
  hpLeft: s.hpLeft && { mean: round(s.hpLeft.mean, 1), share: round(s.hpLeft.share) },
  maxHp: round(s.maxHp, 1),
  damageShare: Object.fromEntries(Object.entries(s.damageShare).map(([k, v]) => [k, round(v)])),
});

/** A row as plain, rounded JSON for `--json`. */
export function rowJson(row: FightRow): unknown {
  return {
    enemy: row.enemy,
    boss: row.boss,
    cl: row.cl,
    level: row.level,
    requestedLevel: row.requestedLevel,
    rank: row.rank,
    natures: row.natures,
    pouch: row.pouch,
    food: row.food,
    loadout: row.loadout,
    runs: row.stats.runs,
    ...statsJson(row.stats),
    withPouch: row.withPouch && statsJson(row.withPouch),
    model: row.model && {
      ttkSec: round(row.model.ttkSec, 2),
      hpLossShare: round(row.model.hpLossShare),
      playerDps: round(row.model.playerDps, 2),
    },
    wins: row.wins,
    ratio: row.ratio === null ? null : round(row.ratio),
    flagged: row.flagged,
    reasons: row.reasons,
  };
}
