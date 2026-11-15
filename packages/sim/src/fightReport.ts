import {
  content as defaultContent,
  type Boss,
  type ContentDb,
  type Enemy,
  type NatureId,
} from '@shinobi/content';
import { defaultRules, type Rank, type Rules } from '@shinobi/core';
import { buildCharacter, equipFor, rankForLevel, TYPICAL_MASTERY } from './character.ts';
import { encounterOf, fightSnapshot, runFights, type FightStats } from './fights.ts';
import { modelExpectation, type ModelExpectation } from './model.ts';

/** The engine/model ratio inside which a row is not marked. */
export const RATIO_BAND: readonly [number, number] = [0.6, 1.6];

export interface FightRow {
  enemy: string;
  boss: boolean;
  /** The enemy's combat level. */
  cl: number;
  level: number;
  rank: Rank;
  natures: NatureId[];
  loadout: string[];
  stats: FightStats;
  model: ModelExpectation | null;
  /** Mean fight time of the engine over the model's time to kill; null when either is missing. */
  ratio: number | null;
  /** True when the ratio is missing or outside `RATIO_BAND`. */
  flagged: boolean;
}

export interface FightReportOptions {
  /** Enemy and boss entry ids to run. */
  entries: readonly string[];
  /** Skill level of the character; default is each entry's own combat level (up to the skill cap). */
  level?: number;
  natures?: readonly NatureId[];
  rank?: Rank;
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

/** One row: a typical character built by the engine's own means, fights run on the engine's fight loop, the model beside it. */
export function fightRow(entry: Enemy | Boss, o: FightReportOptions): FightRow {
  const content = o.content ?? defaultContent;
  const rules = o.rules ?? defaultRules;
  const K = content.balance.K;
  const level = Math.min(K.cap, Math.max(1, o.level ?? entry.cl));
  const rank = o.rank ?? rankForLevel(level, content);
  const natures = [...(o.natures ?? [defaultNature(content)])];
  const state = buildCharacter(content, rules, { seed: o.seed, level, rank, natures });
  equipFor(state, entry.id, content, rules);
  const stats = runFights(
    fightSnapshot(state, entry.id, content, rules),
    encounterOf(state, entry, content),
    o.runs,
    o.seed,
    content,
    rules,
  );
  const model = modelExpectation(entry, level, natures, TYPICAL_MASTERY, content);
  const ratio = model && stats.timeSec ? stats.timeSec.mean / model.ttkSec : null;
  return {
    enemy: entry.id,
    boss: !('region' in entry),
    cl: entry.cl,
    level,
    rank,
    natures,
    loadout:
      state.loadouts.active.length > 0
        ? [...state.loadouts.active]
        : Object.keys(stats.damageShare),
    stats,
    model,
    ratio,
    flagged: ratio === null || ratio < RATIO_BAND[0] || ratio > RATIO_BAND[1],
  };
}

/** The nature a typical character has when none is given: the first the content lists. */
export function defaultNature(content: ContentDb): NatureId {
  const first = content.skills.find((s) => s.unlockReq?.t === 'nature');
  return (first?.unlockReq?.t === 'nature' ? first.unlockReq.nature : 'katon') as NatureId;
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

/** A row as plain, rounded JSON for `--json`. */
export function rowJson(row: FightRow): unknown {
  const s = row.stats;
  return {
    enemy: row.enemy,
    boss: row.boss,
    cl: row.cl,
    level: row.level,
    rank: row.rank,
    natures: row.natures,
    loadout: row.loadout,
    runs: s.runs,
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
    model: row.model && {
      ttkSec: round(row.model.ttkSec, 2),
      hpLossShare: round(row.model.hpLossShare),
      playerDps: round(row.model.playerDps, 2),
    },
    ratio: row.ratio === null ? null : round(row.ratio),
    flagged: row.flagged,
  };
}
