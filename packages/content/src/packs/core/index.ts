import balance from './data/generated/balance.json' with { type: 'json' };
import bosses from './data/generated/bosses.json' with { type: 'json' };
import buildings from './data/generated/buildings.json' with { type: 'json' };
import cells from './data/generated/cells.json' with { type: 'json' };
import countries from './data/generated/countries.json' with { type: 'json' };
import enemies from './data/generated/enemies.json' with { type: 'json' };
import exercises from './data/generated/exercises.json' with { type: 'json' };
import gear from './data/generated/gear.json' with { type: 'json' };
import herbs from './data/generated/herbs.json' with { type: 'json' };
import hexes from './data/generated/hexes.json' with { type: 'json' };
import items from './data/generated/items.json' with { type: 'json' };
import market from './data/generated/market.json' with { type: 'json' };
import missions from './data/generated/missions.json' with { type: 'json' };
import obstacles from './data/generated/obstacles.json' with { type: 'json' };
import places from './data/generated/places.json' with { type: 'json' };
import pools from './data/generated/pools.json' with { type: 'json' };
import practices from './data/generated/practices.json' with { type: 'json' };
import recipes from './data/generated/recipes.json' with { type: 'json' };
import regions from './data/generated/regions.json' with { type: 'json' };
import seals from './data/generated/seals.json' with { type: 'json' };
import skills from './data/generated/skills.json' with { type: 'json' };
import techniques from './data/generated/techniques.json' with { type: 'json' };
import handAi from './data/hand/ai.json' with { type: 'json' };
import handBossSpecials from './data/hand/boss-specials.json' with { type: 'json' };
import handBuildings from './data/hand/buildings.json' with { type: 'json' };
import handCellKeys from './data/hand/cell-keys.json' with { type: 'json' };
import handCellPois from './data/hand/cell-pois.json' with { type: 'json' };
import handPlaceWorth from './data/hand/place-worth.json' with { type: 'json' };
import handCombos from './data/hand/combos.json' with { type: 'json' };
import handEnemyCombat from './data/hand/enemy-combat.json' with { type: 'json' };
import handCoat from './data/hand/coat.json' with { type: 'json' };
import handExams from './data/hand/exams.json' with { type: 'json' };
import handRaids from './data/hand/raids.json' with { type: 'json' };
import handRenownRanks from './data/hand/renown-ranks.json' with { type: 'json' };
import handGearFx from './data/hand/gear-fx.json' with { type: 'json' };
import handHerbReqs from './data/hand/herb-reqs.json' with { type: 'json' };
import handItemEcon from './data/hand/item-econ.json' with { type: 'json' };
import handItemFx from './data/hand/item-fx.json' with { type: 'json' };
import handItems from './data/hand/items.json' with { type: 'json' };
import handModsObstacles from './data/hand/mods-obstacles.json' with { type: 'json' };
import handModsPools from './data/hand/mods-pools.json' with { type: 'json' };
import handModsPractices from './data/hand/mods-practices.json' with { type: 'json' };
import handObstacleReqs from './data/hand/obstacle-reqs.json' with { type: 'json' };
import handResources from './data/hand/resources.json' with { type: 'json' };
import handShopTools from './data/hand/shop-tools.json' with { type: 'json' };
import handMissions from './data/hand/missions.json' with { type: 'json' };
import handTeam from './data/hand/team.json' with { type: 'json' };
import handOperations from './data/hand/operations.json' with { type: 'json' };
import handQuests from './data/hand/quests.json' with { type: 'json' };
import handSkillFight from './data/hand/skill-fight.json' with { type: 'json' };
import handStatuses from './data/hand/statuses.json' with { type: 'json' };
import handTechniqueCombat from './data/hand/technique-combat.json' with { type: 'json' };
import handTechniqueSlots from './data/hand/technique-slots.json' with { type: 'json' };
import handTraits from './data/hand/traits.json' with { type: 'json' };
import handZones from './data/hand/zones.json' with { type: 'json' };
import contentUk from './locales/content.uk.json' with { type: 'json' };
import generatedUk from './locales/uk.json' with { type: 'json' };
import enGenerated from './locales/en.json' with { type: 'json' };
import storyUk from './locales/story.uk.json' with { type: 'json' };
import uiUk from './locales/ui.uk.json' with { type: 'json' };
import { z } from 'zod';
import {
  bossSpecialMapSchema,
  buildingFxMapSchema,
  cellPoiMapSchema,
  coatListSchema,
  enemyCombatMapSchema,
  gearFxMapSchema,
  herbReqMapSchema,
  itemEconMapSchema,
  itemFxMapSchema,
  obstacleModMapSchema,
  obstacleReqMapSchema,
  poolModMapSchema,
  practiceModMapSchema,
  layerBosses,
  layerBuildings,
  layerCells,
  layerEnemies,
  layerGear,
  layerObstacles,
  layerPlaces,
  placeWorthMapSchema,
  layerPools,
  layerPractices,
  layerHerbs,
  layerShop,
  layerTechniques,
  shopToolsSchema,
  techniqueCombatMapSchema,
  techniqueSlotMapSchema,
} from '../../overlay.ts';
import { layerMissions, missionExtraMapSchema } from '../../overlay-missions.ts';
import {
  balanceSchema,
  bossBaseSchema,
  buildingBaseSchema,
  cellBaseSchema,
  enemyBaseSchema,
  gearBaseSchema,
  obstacleBaseSchema,
  poolCheckpointBaseSchema,
  practiceBaseSchema,
  herbBaseSchema,
  marketEntrySchema,
  missionBaseSchema,
  techniqueBaseSchema,
} from '../../schema.ts';

import { CORE_MODIFIER_KEYS } from '../../modifiers.ts';
import type { ContentPack, PackData } from '../../pack.ts';
import { CORE_ICONS } from './icons.ts';
import vocab from './data/hand/vocab.json' with { type: 'json' };

const bal = balanceSchema.parse(balance);
const itemEcon = itemEconMapSchema.parse(handItemEcon);
const enemyCombat = enemyCombatMapSchema.parse(handEnemyCombat);
const itemFx = itemFxMapSchema.parse(handItemFx);

/**
 * The entity lists of the pack, with the hand-written overlays applied. The lists are final
 * entities; `composeContent` validates them against the schemas.
 */
const data: Record<string, unknown> = {
  ...vocab,
  skills: skills.map((skill) => {
    const fight = (handSkillFight as Record<string, object>)[skill.id];
    return fight ? { ...skill, fight } : skill;
  }),
  seals,
  techniques: layerTechniques(
    z.array(techniqueBaseSchema).parse(techniques),
    techniqueCombatMapSchema.parse(handTechniqueCombat),
    techniqueSlotMapSchema.parse(handTechniqueSlots),
  ),
  exercises,
  practices: layerPractices(
    z.array(practiceBaseSchema).parse(practices),
    practiceModMapSchema.parse(handModsPractices),
  ),
  obstacles: layerObstacles(
    z.array(obstacleBaseSchema).parse(obstacles),
    obstacleModMapSchema.parse(handModsObstacles),
    obstacleReqMapSchema.parse(handObstacleReqs),
  ),
  herbs: layerHerbs(z.array(herbBaseSchema).parse(herbs), herbReqMapSchema.parse(handHerbReqs)),
  pools: layerPools(
    z.array(poolCheckpointBaseSchema).parse(pools),
    poolModMapSchema.parse(handModsPools),
  ),
  items: [...items, ...handItems].map((i) => ({
    ...i,
    ...itemEcon[i.id],
    ...(itemFx[i.id] ? { fx: itemFx[i.id] } : {}),
  })),
  market,
  shop: layerShop(z.array(marketEntrySchema).parse(market), shopToolsSchema.parse(handShopTools)),
  coat: coatListSchema.parse(handCoat),
  recipes,
  missions: layerMissions(
    z.array(missionBaseSchema).parse(missions),
    missionExtraMapSchema.parse(handMissions),
    bal.K.missionRateCap,
  ),
  team: handTeam,
  regions,
  cells: layerCells(z.array(cellBaseSchema).parse(cells), cellPoiMapSchema.parse(handCellPois)),
  hexes,
  countries,
  places: layerPlaces(places as never, placeWorthMapSchema.parse(handPlaceWorth)),
  cellKeys: handCellKeys,
  enemies: layerEnemies(z.array(enemyBaseSchema).parse(enemies), enemyCombat, bal.K),
  bosses: layerBosses(
    z.array(bossBaseSchema).parse(bosses),
    enemyCombat,
    bossSpecialMapSchema.parse(handBossSpecials),
    bal.K,
  ),
  buildings: layerBuildings(
    z.array(buildingBaseSchema).parse(buildings),
    buildingFxMapSchema.parse(handBuildings),
  ),
  resources: handResources,
  gear: layerGear(z.array(gearBaseSchema).parse(gear), gearFxMapSchema.parse(handGearFx)),
  quests: handQuests,
  exams: handExams,
  renownRanks: handRenownRanks,
  zones: handZones,
  raids: handRaids,
  operations: handOperations,
  statuses: handStatuses,
  traits: handTraits,
  combos: handCombos,
  ai: handAi,
};

/**
 * The built-in content as a pack. It is assembled by `composeContent` exactly like a mod; it owns
 * the bare ids (skills, natures, ranks, ...) and every `core:` id.
 */
export const corePack: ContentPack = {
  manifest: { id: 'core', version: '0.1.0', dependsOn: [], loadAfter: [] },
  data: data as PackData,
  balance: balance as ContentPack['balance'],
  /** Generated names and descriptions, hand-written descriptions (they win) and UI strings. */
  locales: { uk: { ...generatedUk, ...contentUk, ...uiUk, ...storyUk }, en: enGenerated },
  icons: CORE_ICONS,
  patches: [],
  modifierKeys: CORE_MODIFIER_KEYS,
};
