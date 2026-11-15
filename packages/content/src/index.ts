import balance from './data/generated/balance.json' with { type: 'json' };
import bosses from './data/generated/bosses.json' with { type: 'json' };
import buildings from './data/generated/buildings.json' with { type: 'json' };
import cells from './data/generated/cells.json' with { type: 'json' };
import enemies from './data/generated/enemies.json' with { type: 'json' };
import exercises from './data/generated/exercises.json' with { type: 'json' };
import gear from './data/generated/gear.json' with { type: 'json' };
import herbs from './data/generated/herbs.json' with { type: 'json' };
import items from './data/generated/items.json' with { type: 'json' };
import market from './data/generated/market.json' with { type: 'json' };
import missions from './data/generated/missions.json' with { type: 'json' };
import obstacles from './data/generated/obstacles.json' with { type: 'json' };
import pools from './data/generated/pools.json' with { type: 'json' };
import practices from './data/generated/practices.json' with { type: 'json' };
import recipes from './data/generated/recipes.json' with { type: 'json' };
import regions from './data/generated/regions.json' with { type: 'json' };
import seals from './data/generated/seals.json' with { type: 'json' };
import skills from './data/generated/skills.json' with { type: 'json' };
import techniques from './data/generated/techniques.json' with { type: 'json' };
import handBossSpecials from './data/hand/boss-specials.json' with { type: 'json' };
import handCombos from './data/hand/combos.json' with { type: 'json' };
import handEnemyCombat from './data/hand/enemy-combat.json' with { type: 'json' };
import handCoat from './data/hand/coat.json' with { type: 'json' };
import handExams from './data/hand/exams.json' with { type: 'json' };
import handGearFx from './data/hand/gear-fx.json' with { type: 'json' };
import handHerbReqs from './data/hand/herb-reqs.json' with { type: 'json' };
import handItemEcon from './data/hand/item-econ.json' with { type: 'json' };
import handItemFx from './data/hand/item-fx.json' with { type: 'json' };
import handItems from './data/hand/items.json' with { type: 'json' };
import handShopTools from './data/hand/shop-tools.json' with { type: 'json' };
import handOperations from './data/hand/operations.json' with { type: 'json' };
import handQuests from './data/hand/quests.json' with { type: 'json' };
import handStatuses from './data/hand/statuses.json' with { type: 'json' };
import handTechniqueCombat from './data/hand/technique-combat.json' with { type: 'json' };
import handTraits from './data/hand/traits.json' with { type: 'json' };
import handZones from './data/hand/zones.json' with { type: 'json' };
import contentUk from './locales/content.uk.json' with { type: 'json' };
import generatedUk from './locales/uk.json' with { type: 'json' };
import enGenerated from './locales/en.json' with { type: 'json' };
import uiUk from './locales/ui.uk.json' with { type: 'json' };
import { z } from 'zod';
import {
  bossSpecialMapSchema,
  coatListSchema,
  enemyCombatMapSchema,
  gearFxMapSchema,
  herbReqMapSchema,
  itemEconMapSchema,
  itemFxMapSchema,
  layerBosses,
  layerEnemies,
  layerGear,
  layerHerbs,
  layerShop,
  layerTechniques,
  shopToolsSchema,
  techniqueCombatMapSchema,
} from './overlay.ts';
import {
  balanceSchema,
  bossBaseSchema,
  contentDbSchema,
  enemyBaseSchema,
  gearBaseSchema,
  herbBaseSchema,
  marketEntrySchema,
  techniqueBaseSchema,
  type ContentDb,
} from './schema.ts';

const bal = balanceSchema.parse(balance);
const itemEcon = itemEconMapSchema.parse(handItemEcon);
const enemyCombat = enemyCombatMapSchema.parse(handEnemyCombat);
const itemFx = itemFxMapSchema.parse(handItemFx);

/** The validated content database. Parsing fails loudly if the generated data drifts from the schemas. */
export const content: ContentDb = contentDbSchema.parse({
  skills,
  seals,
  techniques: layerTechniques(
    z.array(techniqueBaseSchema).parse(techniques),
    techniqueCombatMapSchema.parse(handTechniqueCombat),
  ),
  exercises,
  practices,
  obstacles,
  herbs: layerHerbs(z.array(herbBaseSchema).parse(herbs), herbReqMapSchema.parse(handHerbReqs)),
  pools,
  items: [...items, ...handItems].map((i) => ({
    ...i,
    ...itemEcon[i.id],
    ...(itemFx[i.id] ? { fx: itemFx[i.id] } : {}),
  })),
  market,
  shop: layerShop(z.array(marketEntrySchema).parse(market), shopToolsSchema.parse(handShopTools)),
  coat: coatListSchema.parse(handCoat),
  recipes,
  missions,
  regions,
  cells,
  enemies: layerEnemies(z.array(enemyBaseSchema).parse(enemies), enemyCombat, bal.K),
  bosses: layerBosses(
    z.array(bossBaseSchema).parse(bosses),
    enemyCombat,
    bossSpecialMapSchema.parse(handBossSpecials),
    bal.K,
  ),
  buildings,
  gear: layerGear(z.array(gearBaseSchema).parse(gear), gearFxMapSchema.parse(handGearFx)),
  balance,
  quests: handQuests,
  exams: handExams,
  zones: handZones,
  operations: handOperations,
  statuses: handStatuses,
  traits: handTraits,
  combos: handCombos,
});

/** Ukrainian strings: generated entity names and descriptions plus hand-written content descriptions and UI strings. Hand-written content texts win over generated ones. */
export const ukLocale: Readonly<Record<string, string>> = { ...generatedUk, ...contentUk, ...uiUk };

/** English technique names (canonical). Not used by the UI, which reads Ukrainian only. */
export const enLocale: Readonly<Record<string, string>> = enGenerated;

export * from './constants.ts';
export * from './icons.ts';
export * from './keys.ts';
export * from './overlay.ts';
export * from './schema.ts';
