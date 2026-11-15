import { content, type CellKey, type Poi, type PoiKind } from '@shinobi/content';
import type { ReqResult } from '@shinobi/core';
import type { EntityRef, Route } from './route.ts';

/** The icon (a Lucide name) of each kind of point of interest. */
export const POI_ICON: Readonly<Record<PoiKind, string>> = {
  outpost: 'lucide:tent',
  training: 'lucide:dumbbell',
  zone: 'lucide:swords',
  story: 'lucide:scroll-text',
  deposit: 'lucide:pickaxe',
  cache: 'lucide:gift',
  vault: 'lucide:key-round',
  mission: 'lucide:clipboard-list',
};

/** The icon of each kind of cell key. */
export const KEY_ICON: Readonly<Record<CellKey, string>> = {
  rock: 'lucide:mountain',
  water: 'lucide:waves',
  brush: 'lucide:trees',
  mist: 'lucide:cloud-fog',
  rubble: 'lucide:shovel',
};

export const keyNameKey = (key: CellKey): string => `world.key.${key}`;
export const poiKindKey = (kind: PoiKind): string => `world.poi.kind.${kind}`;

/** Whether a route shows the map: the world page, or the page of a cell, a region or a point of interest. */
export function isWorldRoute(route: Route): boolean {
  return (
    route.page === 'world' ||
    (route.page === 'entity' && ['cell', 'region', 'poi'].includes(route.ref.kind))
  );
}

/** The cell or region a route asks the map to focus on; a point of interest focuses its cell. */
export function worldFocus(route: Route): { cell: string | null; region: string | null } {
  if (route.page !== 'entity') return { cell: null, region: null };
  const { kind, id } = route.ref;
  if (kind === 'region') return { cell: null, region: id };
  if (kind === 'cell') {
    return { cell: id, region: content.cells.find((c) => c.id === id)?.region ?? null };
  }
  if (kind === 'poi') {
    const cell = content.cells.find((c) => c.pois.some((p) => p.id === id));
    return { cell: cell?.id ?? null, region: cell?.region ?? null };
  }
  return { cell: null, region: null };
}

/** The cell a point of interest lies in. */
export const cellOfPoi = (poiId: string): string | null =>
  content.cells.find((c) => c.pois.some((p) => p.id === poiId))?.id ?? null;

/** The fight zone a point of interest opens, when it is a zone. */
export const zoneOf = (poi: Poi): { zone: string; enemy: string } | null => {
  if (poi.kind !== 'zone') return null;
  const zone = content.zones.find((z) => z.id === poi.zone);
  return zone ? { zone: zone.id, enemy: zone.enemy } : null;
};

/** The unmet leaf rows of a requirement result, in tree order; a tree that holds has none. */
export function unmetLeaves(node: ReqResult): ReqResult[] {
  if (node.met) return [];
  if (node.children.length === 0) return [node];
  return node.children.flatMap(unmetLeaves);
}

/** The entity a map flag (`poi.<id>`, `region.<slug>.unlocked`) points at, or null for other flags. */
export function flagEntity(flag: string): EntityRef | null {
  if (flag.startsWith('poi.')) return { kind: 'poi', id: flag.slice('poi.'.length) };
  const region = /^region\.([^.]+)\.unlocked$/.exec(flag);
  return region ? { kind: 'region', id: `core:${region[1]}` } : null;
}
