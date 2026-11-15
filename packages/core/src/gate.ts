import type { Req } from './requirements.ts';

/**
 * Whether village buildings exist in the game yet. Shop goods and gear tiers name the building
 * level they need as a plain `building` requirement; until the village stage supplies building
 * levels, those requirements count as met. The village stage turns this on and nothing else in
 * the shop or the gear rules has to change.
 */
export const BUILDINGS_ENABLED = false;

/** Replaces every building requirement in the tree with one that always holds, unless buildings exist. */
export function waiveBuildings(req: Req): Req {
  switch (req.t) {
    case 'building':
      return BUILDINGS_ENABLED ? req : { t: 'all', of: [] };
    case 'all':
    case 'any':
      return { t: req.t, of: req.of.map(waiveBuildings) };
    default:
      return req;
  }
}
