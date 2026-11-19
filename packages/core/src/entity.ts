/** The id of an entity kind of the content (`content.entityKinds`): `skill`, `technique`, `item`, and the kinds that packs add. */
export type EntityKind = string;

/** A pointer to a content entity; the UI turns it into a link. */
export interface EntityRef {
  kind: EntityKind;
  id: string;
}
