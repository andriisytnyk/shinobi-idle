import type { Building, ContentDb } from '@shinobi/content';
import { indexOf, shopEntries } from './lookup.ts';
import type { Req } from './requirements.ts';
import type { GameState } from './state.ts';
import {
  buildCheck,
  villageBuildCost,
  civilCap,
  currentStage,
  depositsOf,
  effectiveLevel,
  maxBuildingLevel,
  shinobiCap,
  reputationOf,
  stageCap,
  stageRep,
  tickMs,
  treasuryIncome,
} from './village.ts';
import type { VillageCost } from './village-state.ts';

/*
 * Read-only views of the village for the UI and bots. Nothing here changes the state.
 */

/** One line of what a build needs, with how much the player has. */
export interface BuildNeed {
  kind: 'civil' | 'shinobi' | 'treasury' | 'stage' | 'queue';
  /** Resource id for `civil` and `shinobi`; null otherwise. */
  id: string | null;
  current: number;
  target: number;
  met: boolean;
}

/** One modifier a building level gives, at the size of ONE level times the level shown. */
export interface BuildingEffect {
  key: string;
  op: 'add' | 'mul';
  value: number;
}

/** Something a building level opens in a shop or in the gear lines. */
export interface BuildingUnlock {
  kind: 'good' | 'tool' | 'scroll' | 'gear';
  /** Item id, or the gear line id for `gear`. */
  ref: string;
  /** The building level that opens it. */
  level: number;
  /** The tier name of a gear line, e.g. `III`; null for items. */
  tier: string | null;
  /** Whether the current level already opens it. */
  open: boolean;
}

export interface BuildingInfo {
  id: string;
  role: Building['role'];
  level: number;
  /** For a producer: the level it works at with deposits counted. Equal to `level` otherwise. */
  effectiveLevel: number;
  deposits: number;
  maxLevel: number;
  /** The level a build would reach; null at the top. */
  nextLevel: number | null;
  /** Cost of the next level; null at the top. */
  cost: VillageCost | null;
  /** What the next level needs and what the player has of it. */
  needs: BuildNeed[];
  /** Whether the next level can be started now, and why not. */
  build: { ok: true } | { ok: false; reason: string };
  /** The modifiers the building gives at its current level and at the next one. */
  effectsNow: BuildingEffect[];
  effectsNext: BuildingEffect[];
  /** Civil resources it produces per tick at its current effective level. */
  perTick: Record<string, number>;
  /** What each level opens in the shops and the gear lines, lowest level first. */
  unlocks: BuildingUnlock[];
  /** Whether the construction job is on this building. */
  building: boolean;
}

function buildingLeaves(req: Req, id: string, out: number[]): void {
  if (req.t === 'building') {
    if (req.id === id) out.push(req.level);
  } else if (req.t === 'all' || req.t === 'any') {
    for (const r of req.of) buildingLeaves(r, id, out);
  }
}

/** Everything a building opens: shop goods, tools and scrolls by the level in their requirement, and gear tiers. */
export function buildingUnlocks(
  state: GameState,
  buildingId: string,
  content: ContentDb,
): BuildingUnlock[] {
  const index = indexOf(content);
  const level = state.village?.levels[buildingId] ?? 0;
  const out: BuildingUnlock[] = [];
  for (const entry of shopEntries(content)) {
    const levels: number[] = [];
    buildingLeaves(entry.req, buildingId, levels);
    const item = index.items.get(entry.item);
    const at = levels[0];
    if (at === undefined) continue;
    const kind = item?.scroll ? 'scroll' : item?.kind === 'tool' ? 'tool' : 'good';
    out.push({ kind, ref: entry.item, level: at, tier: null, open: level >= at });
  }
  for (const line of content.gear) {
    for (const tier of line.tiers) {
      if (tier.building?.id !== buildingId) continue;
      out.push({
        kind: 'gear',
        ref: line.id,
        level: tier.building.level,
        tier: tier.tier,
        open: level >= tier.building.level,
      });
    }
  }
  return out.sort((a, b) => a.level - b.level);
}

/** The modifiers of one building at `level`. */
export function buildingEffectsAt(building: Building, level: number): BuildingEffect[] {
  if (level < 1) return [];
  return building.effects.map((e) => ({ key: e.key, op: e.op, value: e.value * level }));
}

/** Every building of the village with its level, costs, requirements, effects and what it opens. */
export function villageBuildings(state: GameState, content: ContentDb): BuildingInfo[] {
  const village = state.village;
  const K = content.balance.K;
  return content.buildings.map((b) => {
    const level = village?.levels[b.id] ?? 0;
    const max = maxBuildingLevel(b, content);
    const next = level < max ? level + 1 : null;
    const cost = next === null ? null : villageBuildCost(b, next, content);
    const needs: BuildNeed[] = [];
    if (village && next !== null && cost) {
      needs.push({
        kind: 'queue',
        id: null,
        current: village.job ? 1 : 0,
        target: 0,
        met: !village.job,
      });
      needs.push({
        kind: 'stage',
        id: null,
        current: stageCap(state, content),
        target: next,
        met: stageCap(state, content) >= next,
      });
      for (const [id, n] of Object.entries(cost.res)) {
        const have = village.res[id] ?? 0;
        needs.push({ kind: 'civil', id, current: have, target: n, met: have >= n });
      }
      for (const [id, n] of Object.entries(cost.shinobi)) {
        const have = village.shinobi[id] ?? 0;
        needs.push({ kind: 'shinobi', id, current: have, target: n, met: have >= n });
      }
      needs.push({
        kind: 'treasury',
        id: null,
        current: village.treasury,
        target: cost.ryo,
        met: village.treasury >= cost.ryo,
      });
    }
    const effective = village ? effectiveLevel(state, b) : 0;
    const perTick: Record<string, number> = {};
    for (const id of b.produces) perTick[id] = K.prod * effective;
    const check = buildCheck(state, b.id, content);
    return {
      id: b.id,
      role: b.role,
      level,
      effectiveLevel: effective,
      deposits: b.produces.length > 0 ? depositsOf(state, b.id) : 0,
      maxLevel: max,
      nextLevel: next,
      cost,
      needs,
      build: check.ok ? { ok: true } : { ok: false, reason: check.reason },
      effectsNow: buildingEffectsAt(b, level),
      effectsNext: next === null ? [] : buildingEffectsAt(b, next),
      perTick,
      unlocks: buildingUnlocks(state, b.id, content),
      building: village?.job?.building === b.id,
    };
  });
}

export interface ResourceInfo {
  id: string;
  kind: 'civil' | 'shinobi' | 'workforce' | 'power';
  amount: number;
  /** Null for Shinobi Power, which has no cap. */
  cap: number | null;
  /** What the next tick adds for civil resources; 0 for the rest. */
  perTick: number;
}

/** Stores of the village: civil and shinobi resources with caps and income per tick, workforce, power. */
export function villageResources(state: GameState, content: ContentDb): ResourceInfo[] {
  const village = state.village;
  if (!village) return [];
  const K = content.balance.K;
  const perTick: Record<string, number> = {};
  for (const b of content.buildings) {
    const level = effectiveLevel(state, b);
    for (const id of b.produces) perTick[id] = (perTick[id] ?? 0) + K.prod * level;
  }
  return content.resources.map((r) => {
    switch (r.kind) {
      case 'civil':
        return {
          id: r.id,
          kind: r.kind,
          amount: village.res[r.id] ?? 0,
          cap: civilCap(village, content),
          perTick: perTick[r.id] ?? 0,
        };
      case 'shinobi':
        return {
          id: r.id,
          kind: r.kind,
          amount: village.shinobi[r.id] ?? 0,
          cap: shinobiCap(village, content),
          perTick: 0,
        };
      case 'workforce':
        return {
          id: r.id,
          kind: r.kind,
          amount: village.workforce,
          cap: shinobiCap(village, content),
          perTick: 0,
        };
      case 'power':
        return { id: r.id, kind: r.kind, amount: village.power, cap: null, perTick: 0 };
    }
  });
}

export interface TreasuryInfo {
  amount: number;
  /** Ryo added per tick: the Bureau plus Shinobi Power. */
  perTick: number;
}

export function villageTreasury(state: GameState, content: ContentDb): TreasuryInfo {
  return { amount: state.village?.treasury ?? 0, perTick: treasuryIncome(state, content) };
}

export interface QueueInfo {
  building: string;
  /** The level the job will give. */
  level: number;
  ticksLeft: number;
  ticksTotal: number;
  /** Game time until the job is done, counting the time to the next tick. */
  msLeft: number;
}

/** The construction job; null when the queue is empty. */
export function villageQueue(state: GameState, content: ContentDb): QueueInfo | null {
  const village = state.village;
  const job = village?.job;
  if (!village || !job) return null;
  return {
    building: job.building,
    level: (village.levels[job.building] ?? 0) + 1,
    ticksLeft: job.ticks,
    ticksTotal: job.total,
    msLeft: (job.ticks - 1) * tickMs(content) + Math.max(0, tickMs(content) - village.clock),
  };
}

export interface StageInfo {
  /** The stage, counted from 1 in the order of `content.villageStages`. */
  stage: number;
  /** The highest building level the stage allows. */
  levelCap: number;
  /** Reputation the player has and what the next stage needs (the last stage's own when it is reached). */
  rep: number;
  repNeeded: number;
  /** Whether the last stage is reached. */
  reached: boolean;
}

export function villageStage(state: GameState, content: ContentDb): StageInfo {
  const village = state.village;
  const stage = currentStage(state, content);
  const last = content.villageStages.length;
  return {
    stage,
    levelCap: village ? stageCap(state, content) : (content.balance.K.towerStageMax[0] ?? 0),
    rep: reputationOf(state, content),
    repNeeded: stageRep(content, Math.min(stage + 1, last)),
    reached: stage >= last,
  };
}
