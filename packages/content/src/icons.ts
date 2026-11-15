/**
 * Icon registry: maps every game entity (`kind` + `id`) to an icon name of the
 * game-icons.net collection (`@iconify-json/game-icons`, CC BY 3.0).
 *
 * The map is hand-written. A test fails when a content entity has no entry or an entry names an
 * icon that the collection does not contain. `pnpm icons:build` extracts the used icons.
 */
import { CORE_ICONS } from './packs/core/icons.ts';

/** Entity kinds that carry an icon. `status`, `trait`, `nature` and `currency` are not content tables. */
export const ICON_KINDS = [
  'skill',
  'technique',
  'item',
  'status',
  'trait',
  'nature',
  'currency',
  'enemy',
  'boss',
  'building',
  'region',
  'gear',
] as const;

export type IconKind = (typeof ICON_KINDS)[number];

export interface IconRef {
  kind: IconKind;
  id: string;
}

/**
 * Currency ids as they appear in `state.currencies`.
 * @deprecated Read `content.currencies`.
 */
export const CURRENCY_IDS = ['ryo', 'rep', 'intel'] as const;

/**
 * Icon names of the built-in pack.
 * @deprecated Read `content.icons`, which merges the icon tables of every pack.
 */
export const ICON_MAP = CORE_ICONS as Readonly<Record<IconKind, Readonly<Record<string, string>>>>;

/** The game-icons name for an entity, or `undefined` when it has no entry. */
export function iconFor(kind: IconKind, id: string): string | undefined {
  return Object.hasOwn(ICON_MAP[kind], id) ? ICON_MAP[kind][id] : undefined;
}

/** Every game-icons name the mapping uses, sorted and de-duplicated. */
export function mappedIconNames(): string[] {
  const names = new Set<string>();
  for (const kind of ICON_KINDS) for (const name of Object.values(ICON_MAP[kind])) names.add(name);
  return [...names].sort();
}
