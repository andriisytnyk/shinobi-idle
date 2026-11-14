import { localeKey } from '@shinobi/content';
import { hasKey, t } from './i18n.ts';
import type { EntityRef } from './route.ts';

/** Localized display name of an entity; falls back to its id so a gap is visible, not blank. */
export function entityName(ref: EntityRef): string {
  const key = localeKey(ref.kind, ref.id, 'name');
  return hasKey(key) ? t(key) : ref.id;
}

/** Localized description, or `null` when the entity has none yet. */
export function entityDesc(ref: EntityRef): string | null {
  const key = localeKey(ref.kind, ref.id, 'desc');
  return hasKey(key) ? t(key) : null;
}
