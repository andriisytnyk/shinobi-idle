/**
 * Layers hand-written data over the generated database at load: technique combat data, enemy
 * loot and combat style, boss specials and the item economy. Every number that depends on the
 * balance object is derived here, so the hand-written files hold keys and structure only.
 */
import { z } from 'zod';
import {
  bossBaseSchema,
  coreId,
  enemyBaseSchema,
  enemyCombatDataSchema,
  bossSpecialSchema,
  itemSchema,
  techniqueBaseSchema,
  techniqueCombatSchema,
  type K,
} from './schema.ts';

export const techniqueCombatMapSchema = z.record(coreId, techniqueCombatSchema);
export const enemyCombatMapSchema = z.record(coreId, enemyCombatDataSchema);
export const bossSpecialMapSchema = z.record(coreId, bossSpecialSchema);
/** The economy fields of an item that the generated data does not know. */
export const itemEconMapSchema = z.record(
  coreId,
  itemSchema.pick({ buy: true, sell: true, pouch: true }),
);

type TechniqueBase = z.infer<typeof techniqueBaseSchema>;
type EnemyBase = z.infer<typeof enemyBaseSchema>;
type BossBase = z.infer<typeof bossBaseSchema>;
type CombatMap = z.infer<typeof techniqueCombatMapSchema>;
type EnemyMap = z.infer<typeof enemyCombatMapSchema>;
type SpecialMap = z.infer<typeof bossSpecialMapSchema>;

const slug = (id: string): string => id.replace(/^core:/, '');

/** The scroll-part item of a technique carried by an enemy or boss. */
export const scrollPartId = (technique: string): string => `core:scrollpart_${slug(technique)}`;

/** Adds `combat` to each technique; training drills have none. */
export function layerTechniques(base: TechniqueBase[], combat: CombatMap) {
  return base.map((t) => ({ ...t, combat: combat[t.id] ?? null }));
}

function loot(e: EnemyBase | BossBase, data: EnemyMap[string] | undefined, k: K, boss: boolean) {
  if (data === undefined) throw new Error(`No combat data for ${e.id}`);
  const first = k.bounty[slug(e.id)];
  return {
    style: data.style,
    drops: data.drops.map((d) => ({ item: d.item, chance: k.dropChance[d.chance] })),
    ryo: [Math.round(e.cl * k.ryoDrop[0]), Math.round(e.cl * k.ryoDrop[1])] as [number, number],
    scrollPart:
      e.carries === null
        ? null
        : {
            item: scrollPartId(e.carries),
            technique: e.carries,
            ...(boss ? { count: k.partDrop.boss } : { chance: k.partDrop.carrier }),
          },
    bounty: first === undefined ? null : { first, repeatShare: k.bountyRepeat },
  };
}

export function layerEnemies(base: EnemyBase[], data: EnemyMap, k: K) {
  return base.map((e) => ({ ...e, ...loot(e, data[e.id], k, false) }));
}

export function layerBosses(base: BossBase[], data: EnemyMap, specials: SpecialMap, k: K) {
  return base.map((b) => {
    const special = specials[b.id];
    if (special === undefined) throw new Error(`No special for boss ${b.id}`);
    return { ...b, ...loot(b, data[b.id], k, true), special };
  });
}
