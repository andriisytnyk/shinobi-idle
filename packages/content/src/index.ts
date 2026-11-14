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
import generatedUk from './locales/uk.json' with { type: 'json' };
import enGenerated from './locales/en.json' with { type: 'json' };
import uiUk from './locales/ui.uk.json' with { type: 'json' };
import { contentDbSchema, type ContentDb } from './schema.ts';

/** The validated content database. Parsing fails loudly if the generated data drifts from the schemas. */
export const content: ContentDb = contentDbSchema.parse({
  skills,
  seals,
  techniques,
  exercises,
  practices,
  obstacles,
  herbs,
  pools,
  items,
  market,
  recipes,
  missions,
  regions,
  cells,
  enemies,
  bosses,
  buildings,
  gear,
  balance,
});

/** Ukrainian strings: generated entity names and descriptions plus hand-written UI strings. */
export const ukLocale: Readonly<Record<string, string>> = { ...generatedUk, ...uiUk };

/** English technique names (canonical). Not used by the UI, which reads Ukrainian only. */
export const enLocale: Readonly<Record<string, string>> = enGenerated;

export * from './constants.ts';
export * from './icons.ts';
export * from './keys.ts';
export * from './schema.ts';
