/**
 * Layers hand-written data over the generated database at load: technique combat data, enemy
 * loot and combat style, boss specials and the item economy. Every number that depends on the
 * balance object is derived here, so the hand-written files hold keys and structure only.
 */
import { z } from 'zod';
import { modSchema, obstacleModSchema } from './modifiers.ts';
import {
  bossBaseSchema,
  poiSchema,
  type CellBase,
  type Poi,
  coatSchema,
  coreId,
  enemyBaseSchema,
  enemyCombatDataSchema,
  bossSpecialSchema,
  buildingFxSchema,
  gearFxSchema,
  itemFxSchema,
  itemSchema,
  reqSchema,
  techniqueBaseSchema,
  techniqueCombatSchema,
  type Building,
  type BuildingBase,
  type BuildingFx,
  type GearBase,
  type HerbBase,
  type K,
  type MarketEntry,
  type ObstacleBase,
  type PoolCheckpointBase,
  type PracticeBase,
  type ShopEntry,
} from './schema.ts';

export const techniqueCombatMapSchema = z.record(coreId, techniqueCombatSchema);
export const enemyCombatMapSchema = z.record(coreId, enemyCombatDataSchema);
/** Points of interest by cell id. */
export const cellPoiMapSchema = z.record(coreId, z.array(poiSchema));

/** Gives every cell its points of interest; a cell the map does not name has none. */
export function layerCells(
  cells: readonly CellBase[],
  pois: Readonly<Record<string, readonly Poi[]>>,
): (CellBase & { pois: Poi[] })[] {
  for (const id of Object.keys(pois)) {
    if (!cells.some((c) => c.id === id))
      throw new Error(`Points of interest for unknown cell ${id}`);
  }
  return cells.map((c) => ({ ...c, pois: [...(pois[c.id] ?? [])] }));
}

export const buildingFxMapSchema = z.record(coreId, buildingFxSchema);

/** Gives every building its role, effects and products; a building without an entry is a data error. */
export function layerBuildings(
  base: readonly BuildingBase[],
  fx: Readonly<Record<string, BuildingFx>>,
): Building[] {
  for (const id of Object.keys(fx)) {
    if (!base.some((b) => b.id === id)) throw new Error(`Building data for unknown building ${id}`);
  }
  return base.map((b) => {
    const own = fx[b.id];
    if (own === undefined) throw new Error(`No data for building ${b.id}`);
    return {
      ...b,
      ...own,
      effects: [...own.effects],
      capstone: [...own.capstone],
      produces: [...own.produces],
    };
  });
}

export const bossSpecialMapSchema = z.record(coreId, bossSpecialSchema);
/** The economy fields of an item that the generated data does not know. */
export const itemEconMapSchema = z.record(
  coreId,
  itemSchema.pick({ buy: true, sell: true, pouch: true, medic: true, use: true }),
);

type TechniqueBase = z.infer<typeof techniqueBaseSchema>;
type EnemyBase = z.infer<typeof enemyBaseSchema>;
type BossBase = z.infer<typeof bossBaseSchema>;
type CombatMap = z.infer<typeof techniqueCombatMapSchema>;
type EnemyMap = z.infer<typeof enemyCombatMapSchema>;
type SpecialMap = z.infer<typeof bossSpecialMapSchema>;

const slug = (id: string): string => id.slice(id.indexOf(':') + 1);

/** The scroll-part item of a technique carried by an enemy or boss. */
export const scrollPartId = (technique: string): string =>
  `${technique.slice(0, technique.indexOf(':'))}:scrollpart_${slug(technique)}`;

/** Adds `combat` to each technique; training drills have none. */
export function layerTechniques(base: TechniqueBase[], combat: CombatMap) {
  return base.map((t) => ({ ...t, combat: combat[t.id] ?? null }));
}

function loot(e: EnemyBase | BossBase, data: EnemyMap[string] | undefined, k: K) {
  if (data === undefined) throw new Error(`No combat data for ${e.id}`);
  const first = k.bounty[slug(e.id)];
  return {
    style: data.style,
    drops: data.drops.map((d) => ({ item: d.item, chance: k.dropChance[d.chance] })),
    ryo: [Math.round(e.cl * k.ryoDrop[0]), Math.round(e.cl * k.ryoDrop[1])] as [number, number],
    bounty: first === undefined ? null : { first, repeatShare: k.bountyRepeat },
  };
}

export function layerEnemies(base: EnemyBase[], data: EnemyMap, k: K) {
  return base.map((e) => ({
    ...e,
    ...loot(e, data[e.id], k),
    scrollPart:
      e.carries === null
        ? null
        : { item: scrollPartId(e.carries), technique: e.carries, chance: k.partDrop.carrier },
  }));
}

export function layerBosses(base: BossBase[], data: EnemyMap, specials: SpecialMap, k: K) {
  return base.map((b) => {
    const special = specials[b.id];
    if (special === undefined) throw new Error(`No special for boss ${b.id}`);
    return {
      ...b,
      ...loot(b, data[b.id], k),
      scrollPart:
        b.carries === null
          ? null
          : { item: scrollPartId(b.carries), technique: b.carries, count: k.partDrop.boss },
      special,
    };
  });
}

// ---------- field and crafts: herbs, items, shop, coating, gear ----------

export const herbReqMapSchema = z.record(coreId, reqSchema);
export const itemFxMapSchema = z.record(coreId, itemFxSchema);
export const gearFxMapSchema = z.record(coreId, gearFxSchema);
export const shopToolsSchema = z.array(
  z.strictObject({
    item: coreId,
    building: z.strictObject({ id: coreId, level: z.number().int().min(1) }),
  }),
);
export const coatListSchema = z.array(coatSchema);

/** The building id of the Market; its goods are listed in the generated market table. */
const MARKET = 'core:market';

/** Adds the extra requirement of each herb; `null` when it has none. */
export function layerHerbs(base: HerbBase[], reqs: z.infer<typeof herbReqMapSchema>) {
  return base.map((h) => ({ ...h, req: reqs[h.id] ?? null }));
}

/** Adds the per-tier effect to each gear line; a line without one is a data error. */
export function layerGear(base: GearBase[], fx: z.infer<typeof gearFxMapSchema>) {
  return base.map((g) => {
    const effect = fx[g.id];
    if (effect === undefined) throw new Error(`No gear effect for ${g.id}`);
    return { ...g, fx: effect };
  });
}

/**
 * Everything a shop sells, each with the requirement that opens it: the rank of Genin and the
 * level of the building that supplies it. Market goods come from the market table, tools from the
 * hand-written list.
 */
export function layerShop(
  market: MarketEntry[],
  tools: z.infer<typeof shopToolsSchema>,
): ShopEntry[] {
  const entry = (item: string, building: { id: string; level: number }): ShopEntry => ({
    item,
    req: {
      t: 'all',
      of: [
        { t: 'rank', rank: 'genin' },
        { t: 'building', id: building.id, level: building.level },
      ],
    },
  });
  return [
    ...market.map((m) => entry(m.item, { id: MARKET, level: m.marketLevel })),
    ...tools.map((t) => entry(t.item, t.building)),
  ];
}

// ---------- structured modifiers: pool checkpoints, practices, obstacles ----------

export const poolModMapSchema = z.record(coreId, z.array(modSchema));
export const practiceModMapSchema = z.record(
  coreId,
  z.strictObject({
    insight: z.array(z.array(modSchema).min(1)),
    enlight: z.array(z.array(modSchema).min(1)),
  }),
);
export const obstacleModMapSchema = z.record(coreId, z.array(obstacleModSchema).min(2));
export const obstacleReqMapSchema = z.record(coreId, reqSchema);

/** Adds the modifiers of each pool checkpoint; a checkpoint without an entry is a data error. */
export function layerPools(base: PoolCheckpointBase[], mods: z.infer<typeof poolModMapSchema>) {
  return base.map((p) => {
    const own = mods[p.id];
    if (own === undefined) throw new Error(`No modifiers for pool checkpoint ${p.id}`);
    return { ...p, mods: own };
  });
}

/** Adds the modifiers of each Insight and Enlightenment modifier; their counts must match the practice. */
export function layerPractices(base: PracticeBase[], mods: z.infer<typeof practiceModMapSchema>) {
  return base.map((p) => {
    const own = mods[p.id];
    if (own === undefined) throw new Error(`No modifiers for practice ${p.id}`);
    if (own.insight.length !== p.insight || own.enlight.length !== p.enlight) {
      throw new Error(`Modifier counts of practice ${p.id} differ from its text`);
    }
    return { ...p, insightMods: own.insight, enlightMods: own.enlight };
  });
}

/** Adds the requirement and the modifiers of each obstacle. */
export function layerObstacles(
  base: ObstacleBase[],
  mods: z.infer<typeof obstacleModMapSchema>,
  reqs: z.infer<typeof obstacleReqMapSchema>,
) {
  return base.map((o) => {
    const own = mods[o.id];
    if (own === undefined) throw new Error(`No modifiers for obstacle ${o.id}`);
    return { ...o, req: reqs[o.id] ?? null, mods: own };
  });
}
