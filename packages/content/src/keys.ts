import type { IdTypes } from '@shinobi/content/typing';

/**
 * The kind of a localized entity string: an entity kind (`content.entityKinds`) or a vocabulary
 * (`tag`, `role`, `state`, ...). Open: a pack names its own.
 */
export type LocaleKind = IdTypes['localeKind'];

/** Localization key of an entity string, e.g. `technique.core:great_fireball.name`. */
export function localeKey(kind: LocaleKind, id: string, field: string): string {
  return `${kind}.${id}.${field}`;
}
