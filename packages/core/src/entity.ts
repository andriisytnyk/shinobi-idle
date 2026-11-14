export type EntityKind =
  | 'skill'
  | 'technique'
  | 'item'
  | 'recipe'
  | 'mission'
  | 'enemy'
  | 'region'
  | 'building'
  | 'quest'
  | 'gear'
  | 'seal';

/** A pointer to a content entity; the UI turns it into a link. */
export interface EntityRef {
  kind: EntityKind;
  id: string;
}
