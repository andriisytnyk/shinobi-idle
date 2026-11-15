import type { Building, ContentDb } from '@shinobi/content';
import { removeCurrency } from './bank.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { MS_PER_MINUTE } from './formulas.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import type { System } from './system.ts';
import type { GameState } from './state.ts';
import { createVillage, type VillageCost, type VillageState } from './village-state.ts';
import { depositFlag } from './world.ts';

/*
 * The player's district. A tick every `K.tickMin` minutes of game time: producers fill the store,
 * the treasury earns, and the one construction job moves a tick closer. All time maths is whole ms.
 */

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;

/** The building that performs a duty of the village rules (the store, the Bureau, the Library), if the content has one. */
export function dutyBuilding(
  content: ContentDb,
  duty: NonNullable<Building['duty']>,
): Building | null {
  return content.buildings.find((b) => b.duty === duty) ?? null;
}

const levelOf = (village: VillageState, id: string): number => village.levels[id] ?? 0;

/** Length of one village tick in ms. */
export const tickMs = (content: ContentDb): number => content.balance.K.tickMin * MS_PER_MINUTE;

/** Level of the store; it sets the caps of every resource. */
function storeLevel(village: VillageState, content: ContentDb): number {
  const store = dutyBuilding(content, 'storage');
  return store ? levelOf(village, store.id) : 0;
}

/** Most of each civil resource the store holds. */
export function civilCap(village: VillageState, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.storeCap;
  return base + perLevel * storeLevel(village, content);
}

/** Most of each capped shinobi resource the store holds. */
export function shinobiCap(village: VillageState, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.shinobiCap;
  return base + perLevel * storeLevel(village, content);
}

/** Deposits found for a building of the village. */
export function depositsOf(state: GameState, buildingId: string): number {
  const found = state.flags[depositFlag(buildingId)];
  return typeof found === 'number' ? found : 0;
}

/** A producer works as if it were one level higher for each deposit found for it. */
export function effectiveLevel(state: GameState, building: Building): number {
  const village = state.village;
  if (!village) return 0;
  const level = levelOf(village, building.id);
  return building.produces.length > 0 ? level + depositsOf(state, building.id) : level;
}

/** Highest level a building can reach: the last row of the cost table only for buildings that name level-6 resources. */
export function maxBuildingLevel(building: Building, content: ContentDb): number {
  const rows = content.balance.K.costMult.length;
  return building.tier6 ? rows : rows - 1;
}

/** Highest building level the stage allows. */
export function stageCap(village: VillageState, content: ContentDb): number {
  return content.balance.K.towerStageMax[village.stage - 1] ?? 0;
}

/** What building `level` costs: civil resources, treasury ryo and, for the last level, the shinobi resources. */
export function villageBuildCost(
  building: Building,
  level: number,
  content: ContentDb,
): VillageCost {
  const K = content.balance.K;
  const mult = K.costMult[level - 1] ?? 0;
  const base = Math.round(K.costBase * mult);
  const res: Record<string, number> = {};
  for (const r of content.resources) {
    if (r.kind !== 'civil' || r.cost === undefined) continue;
    if (r.cost === 'base') res[r.id] = base;
    else if (level >= K.village.lateFromLevel) res[r.id] = Math.round(base * K.village.lateShare);
  }
  const shinobi: Record<string, number> = {};
  if (building.tier6 && level === K.costMult.length) {
    for (const id of Object.keys(building.tier6)) shinobi[id] = K.shinobiT6;
  }
  return { res, shinobi, ryo: Math.round(K.treasuryBase * mult) };
}

// ---------- creation and stage ----------

/**
 * Makes sure a Genin has a village and that its stage follows Reputation. A student has none.
 * Called after anything that may have changed the rank or the Reputation.
 */
export function syncVillage(state: GameState, content: ContentDb): void {
  if (state.player.rank === 'student') return;
  const village = (state.village ??= createVillage(content));
  if (village.stage < 2 && state.currencies.rep >= content.balance.K.rep.stage2) {
    village.stage = 2;
    emit(state, { type: 'villageStage', stage: 2 });
  }
}

// ---------- the tick ----------

function finishJob(state: GameState, village: VillageState): void {
  const job = village.job;
  if (!job) return;
  const level = levelOf(village, job.building) + 1;
  village.levels[job.building] = level;
  village.job = null;
  emit(state, { type: 'buildingBuilt', building: job.building, level });
}

function tick(state: GameState, village: VillageState, content: ContentDb): void {
  const K = content.balance.K;
  const before = { ...village.res };
  for (const b of content.buildings) {
    if (b.produces.length === 0) continue;
    const level = effectiveLevel(state, b);
    if (level <= 0) continue;
    for (const id of b.produces) village.res[id] = (village.res[id] ?? 0) + K.prod * level;
  }
  const cap = civilCap(village, content);
  for (const id of Object.keys(village.res)) {
    const have = village.res[id] ?? 0;
    if (have >= cap && (before[id] ?? 0) < cap) emit(state, { type: 'storageFull', resource: id });
    if (have > cap) village.res[id] = cap;
  }
  village.treasury += treasuryIncome(state, content);
  if (village.job) {
    village.job.ticks -= 1;
    if (village.job.ticks <= 0) finishJob(state, village);
  }
}

export const villageSystem: System = {
  nextEventIn(state, content) {
    const village = state.village;
    return village ? Math.max(0, tickMs(content) - village.clock) : null;
  },
  elapse(state, dt) {
    if (state.village) state.village.clock += dt;
  },
  run(state, content) {
    syncVillage(state, content);
    const village = state.village;
    if (!village) return;
    const length = tickMs(content);
    while (village.clock >= length) {
      village.clock -= length;
      tick(state, village, content);
    }
  },
};

// ---------- commands ----------

/** Why `building` cannot be built now (a localization key), or the level it would reach and its cost. */
export function buildCheck(
  state: GameState,
  buildingId: string,
  content: ContentDb,
): { ok: true; level: number; cost: VillageCost } | { ok: false; reason: string } {
  const village = state.village;
  if (!village) return { ok: false, reason: 'error.noVillage' };
  const building = content.buildings.find((b) => b.id === buildingId);
  if (!building) return { ok: false, reason: 'error.unknownBuilding' };
  if (village.job) return { ok: false, reason: 'error.queueBusy' };
  const K = content.balance.K;
  const level = levelOf(village, building.id) + 1;
  const top = K.costMult.length;
  if (level > maxBuildingLevel(building, content)) {
    return {
      ok: false,
      reason: level >= top && !building.tier6 ? 'error.noLevelSix' : 'error.maxLevel',
    };
  }
  if (level > stageCap(village, content)) {
    return { ok: false, reason: level >= top ? 'error.stageNotReached' : 'error.stageCap' };
  }
  const cost = villageBuildCost(building, level, content);
  for (const [id, n] of Object.entries(cost.shinobi)) {
    if ((village.shinobi[id] ?? 0) < n) return { ok: false, reason: 'error.notEnoughShinobi' };
  }
  for (const [id, n] of Object.entries(cost.res)) {
    if ((village.res[id] ?? 0) < n) return { ok: false, reason: 'error.notEnoughResources' };
  }
  if (village.treasury < cost.ryo) return { ok: false, reason: 'error.notEnoughTreasury' };
  return { ok: true, level, cost };
}

/** Starts the next level of a building: the costs are taken now and the job waits for its ticks. */
export function startBuild(
  state: GameState,
  buildingId: string,
  content: ContentDb,
): CommandResult {
  const check = buildCheck(state, buildingId, content);
  const village = state.village;
  if (!check.ok || !village)
    return { ok: false, reason: check.ok ? 'error.noVillage' : check.reason };
  for (const [id, n] of Object.entries(check.cost.res))
    village.res[id] = (village.res[id] ?? 0) - n;
  for (const [id, n] of Object.entries(check.cost.shinobi)) {
    village.shinobi[id] = (village.shinobi[id] ?? 0) - n;
  }
  village.treasury -= check.cost.ryo;
  const ticks = Math.max(1, content.balance.K.buildTicks[check.level - 1] ?? 1);
  village.job = { building: buildingId, ticks, total: ticks, paid: check.cost };
  return { ok: true };
}

/** Cancels the job and returns everything it cost. */
export function cancelBuild(state: GameState): CommandResult {
  const village = state.village;
  if (!village) return { ok: false, reason: 'error.noVillage' };
  const job = village.job;
  if (!job) return { ok: false, reason: 'error.noJob' };
  for (const [id, n] of Object.entries(job.paid.res)) village.res[id] = (village.res[id] ?? 0) + n;
  for (const [id, n] of Object.entries(job.paid.shinobi)) {
    village.shinobi[id] = (village.shinobi[id] ?? 0) + n;
  }
  village.treasury += job.paid.ryo;
  village.job = null;
  return { ok: true };
}

/** Spends one workforce charge to take one tick off the job. */
export function spendWorkforce(state: GameState): CommandResult {
  const village = state.village;
  if (!village) return { ok: false, reason: 'error.noVillage' };
  if (!village.job) return { ok: false, reason: 'error.noJob' };
  if (village.workforce < 1) return { ok: false, reason: 'error.noWorkforce' };
  village.workforce -= 1;
  village.job.ticks -= 1;
  if (village.job.ticks <= 0) finishJob(state, village);
  return { ok: true };
}

/** Moves ryo from the player's purse to the treasury. */
export function donateToTreasury(state: GameState, ryo: number): CommandResult {
  const village = state.village;
  if (!village) return { ok: false, reason: 'error.noVillage' };
  if (!isCount(ryo)) return { ok: false, reason: 'error.invalidAmount' };
  if (!removeCurrency(state, 'ryo', ryo)) return { ok: false, reason: 'error.notEnoughRyo' };
  village.treasury += ryo;
  return { ok: true };
}

/**
 * Brings shinobi resources home (the mission stage calls this). Capped resources stop at the
 * store's limit, Workforce adds charges (also capped), Shinobi Power is not capped.
 * Returns how many units were actually added.
 */
export function addShinobiResource(
  state: GameState,
  kind: string,
  n: number,
  content: ContentDb,
): number {
  const village = state.village;
  const resource = content.resources.find((r) => r.id === kind);
  if (!village || !resource || !Number.isSafeInteger(n) || n < 1) return 0;
  if (resource.kind === 'power') {
    village.power += n;
    return n;
  }
  if (resource.kind === 'workforce') {
    const added = Math.max(0, Math.min(n, shinobiCap(village, content) - village.workforce));
    village.workforce += added;
    return added;
  }
  if (resource.kind !== 'shinobi') return 0;
  const have = village.shinobi[kind] ?? 0;
  const added = Math.max(0, Math.min(n, shinobiCap(village, content) - have));
  village.shinobi[kind] = have + added;
  return added;
}

// ---------- bonuses ----------

/** Each building's level multiplies its per-level effects; the building is the visible source. */
export const villageProvider: ModifierProvider = (state, content) => {
  const village = state.village;
  if (!village) return [];
  const out: Modifier[] = [];
  for (const b of content.buildings) {
    const level = levelOf(village, b.id);
    if (level < 1) continue;
    for (const e of b.effects) {
      out.push({
        key: e.key,
        op: e.op,
        value: e.value * level,
        group: 'village',
        source: { kind: 'building', id: b.id },
      });
    }
  }
  return out;
};

/** Ryo the Bureau, plus Shinobi Power, put into the treasury each tick. */
export function treasuryIncome(state: GameState, content: ContentDb): number {
  const village = state.village;
  if (!village) return 0;
  const bureau = dutyBuilding(content, 'treasury');
  return (
    content.balance.K.bureauIncome * (bureau ? levelOf(village, bureau.id) : 0) + village.power
  );
}
