import type { Poi } from '@shinobi/content';
import type { ReqResult } from '@shinobi/core';
import { entityRefsIn } from './entity-data.ts';
import type { EntityRef, Route } from './route.ts';
import { game } from './store.ts';

/** The icon of a point of interest whose kind no UI pack has a renderer for. */
export const GENERIC_POI_ICON = 'lucide:map-pin';

/** The icon of a cell key; a key that has none here shows the lock. */
export const keyIcon = (key: string): string => KEY_ICON[key] ?? 'lucide:lock';

const KEY_ICON: Readonly<Record<string, string>> = {
  rock: 'lucide:mountain',
  water: 'lucide:waves',
  brush: 'lucide:trees',
  mist: 'lucide:cloud-fog',
  rubble: 'lucide:shovel',
};

export const keyNameKey = (key: string): string => `world.key.${key}`;
export const poiKindKey = (kind: string): string => `world.poi.kind.${kind}`;

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
    return { cell: id, region: game.content.cells.find((c) => c.id === id)?.region ?? null };
  }
  if (kind === 'poi') {
    const cell = game.content.cells.find((c) => c.pois.some((p) => p.id === id));
    return { cell: cell?.id ?? null, region: cell?.region ?? null };
  }
  return { cell: null, region: null };
}

/** The cell a point of interest lies in. */
export const cellOfPoi = (poiId: string): string | null =>
  game.content.cells.find((c) => c.pois.some((p) => p.id === poiId))?.id ?? null;

/** The fight zone a point of interest opens, when it is a zone. */
export const zoneOf = (poi: Poi): { zone: string; enemy: string } | null => {
  if (poi.kind !== 'zone') return null;
  const zone = game.content.zones.find((z) => z.id === poi.zone);
  return zone ? { zone: zone.id, enemy: zone.enemy } : null;
};

/** The unmet leaf rows of a requirement result, in tree order; a tree that holds has none. */
export function unmetLeaves(node: ReqResult): ReqResult[] {
  if (node.met) return [];
  if (node.children.length === 0) return [node];
  return node.children.flatMap(unmetLeaves);
}

/** The region whose id ends with `slug` (a flag names the region without its pack prefix). */
export function regionBySlug(slug: string): EntityRef | null {
  const found = game.content.regions.find((r) => r.id.slice(r.id.lastIndexOf(':') + 1) === slug);
  return found ? { kind: 'region', id: found.id } : null;
}

/** The entity a map flag (`poi.<id>`, `region.<slug>.unlocked`) points at, or null for other flags. */
export function flagEntity(flag: string): EntityRef | null {
  if (flag.startsWith('poi.')) return { kind: 'poi', id: flag.slice('poi.'.length) };
  const region = /^region\.([^.]+)\.unlocked$/.exec(flag);
  return region ? regionBySlug(region[1] ?? '') : null;
}

/** The cell where a region is entered: the first one with an outpost, to which the trip is free. */
export function entryCellOf(regionId: string): string | null {
  return (
    game.content.cells.find(
      (c) => c.region === regionId && c.pois.some((p) => p.kind === 'outpost'),
    )?.id ?? null
  );
}

/** Whether a cell has an outpost, which the grid marks as an entry. */
export const isEntryCell = (cellId: string): boolean =>
  game.content.cells.some((c) => c.id === cellId && c.pois.some((p) => p.kind === 'outpost'));

const reqKey = (n: ReqResult): string => {
  const r = n.req;
  switch (r.t) {
    case 'skill':
      return `skill:${r.skill}`;
    case 'technique':
    case 'flag':
    case 'quest':
    case 'building':
      return `${r.t}:${r.id}`;
    case 'item':
      return `item:${r.id}`;
    case 'rank':
      return `rank:${r.rank}`;
    case 'nature':
      return `nature:${r.nature}`;
    default:
      return `${r.t}:${JSON.stringify(r)}`;
  }
};

/** A requirement tree with its nested "all" groups merged and a row asked twice shown once (the higher level wins). */
export function uniqueReq(node: ReqResult): ReqResult {
  if (node.req.t !== 'all') return node;
  const rows = new Map<string, ReqResult>();
  const walk = (n: ReqResult): void => {
    if (n.req.t === 'all') {
      n.children.forEach(walk);
      return;
    }
    const key = reqKey(n);
    const have = rows.get(key);
    if (!have || n.target > have.target) rows.set(key, n);
  };
  walk(node);
  return { ...node, children: [...rows.values()] };
}

/** The entities a point of interest names in its fields, as links (for a kind that has no renderer). */
export const poiLinks = (poi: Record<string, unknown>): EntityRef[] =>
  entityRefsIn(poi, game.content);
