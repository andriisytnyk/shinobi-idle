/**
 * Icon lookup: an icon is an icon name of the game-icons.net collection
 * (`@iconify-json/game-icons`, CC BY 3.0) by entity kind and id. Every pack brings its own table;
 * `composeContent` merges them into `content.icons`, which is what the UI reads.
 *
 * Tests fail when an entity of the pack `core` has no entry or an entry names an icon that the
 * collection does not contain. `pnpm icons:build` extracts the icons of the app bundle (`core`).
 */
import type { IdTypes } from '@shinobi/content/typing';
import vocab from './packs/core/data/hand/vocab.json' with { type: 'json' };
import { CORE_ICONS } from './packs/core/icons.ts';
import type { IconTable } from './schema.ts';

/** The kind of an icon: an entity kind or one of the vocabularies (`status`, `trait`, `nature`, `currency`). */
export type IconKind = IdTypes['iconKind'];

/**
 * Icon kinds of the pack `core`.
 * @deprecated The kinds are whatever the composed icon tables name: read `Object.keys(content.icons)`.
 */
export const ICON_KINDS = Object.keys(CORE_ICONS) as readonly IconKind[];

export interface IconRef {
  kind: IconKind;
  id: string;
}

/**
 * Currency ids as they appear in `state.currencies`.
 * @deprecated Read `content.currencies`.
 */
export const CURRENCY_IDS = vocab.currencies.map((c) => c.id) as readonly string[] as readonly (
  'ryo' | 'rep' | 'intel'
)[];

/**
 * Icon names of the built-in pack.
 * @deprecated Read `content.icons`, which merges the icon tables of every pack.
 */
export const ICON_MAP = CORE_ICONS as Readonly<Record<IconKind, Readonly<Record<string, string>>>>;

/**
 * The game-icons name for an entity, or `undefined` when it has no entry (the caller falls back to
 * a generic icon). `icons` is the table to read: pass `content.icons` to include the icons of
 * every pack; it defaults to the table of the pack `core`.
 */
export function iconFor(
  kind: IconKind,
  id: string,
  icons: Readonly<IconTable> = ICON_MAP,
): string | undefined {
  const table = Object.hasOwn(icons, kind) ? icons[kind] : undefined;
  return table !== undefined && Object.hasOwn(table, id) ? table[id] : undefined;
}

/** Every game-icons name the table uses, sorted and de-duplicated (default: the pack `core`). */
export function mappedIconNames(icons: Readonly<IconTable> = ICON_MAP): string[] {
  const names = new Set<string>();
  for (const table of Object.values(icons))
    for (const name of Object.values(table)) names.add(name);
  return [...names].sort();
}
