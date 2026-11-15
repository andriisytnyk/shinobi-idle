/** Collections that own localized display strings. */
export type LocaleKind =
  | 'skill'
  | 'technique'
  | 'seal'
  | 'exercise'
  | 'practice'
  | 'obstacle'
  | 'item'
  | 'recipe'
  | 'mission'
  | 'region'
  | 'cell'
  | 'poi'
  | 'enemy'
  | 'boss'
  | 'building'
  | 'gear'
  | 'pool'
  | 'resource'
  | 'trait'
  | 'tag'
  | 'role'
  | 'state'
  | 'status'
  | 'combo'
  | 'operation'
  | 'exam'
  | 'quest'
  | 'group';

/** Localization key of an entity string, e.g. `technique.core:great_fireball.name`. */
export function localeKey(kind: LocaleKind, id: string, field: string): string {
  return `${kind}.${id}.${field}`;
}
