/**
 * A content pack: the unit in which all content is delivered. The built-in content is the pack
 * `core`; DLC and mods are packs of the same shape. A pack is a plain data object built from static
 * imports at build time; `composeContent` (compose.ts) assembles packs into one `ContentDb`.
 */
import type { ModifierKeyInfo } from './modifiers.ts';
import type { ContentDb, ContentDbMeta, IconTable, PackManifest } from './schema.ts';

export type { PackManifest } from './schema.ts';

/** The entity lists a pack can contribute: every list of `ContentDb` except the balance object. */
type Lists = Omit<ContentDb, keyof ContentDbMeta>;
export type EntityListKey = {
  [K in keyof Lists]: Lists[K] extends readonly { id: string }[] ? K : never;
}[keyof Lists];

/**
 * The data of a pack, as final entities (hand-written overlays are applied when the pack is
 * built, see `overlay.ts`). Every list is optional; a pack adds only what it has.
 */
export type PackData = {
  [K in EntityListKey]?: ContentDb[K];
} & {
  /** What each kind of key cell needs; the keys are vocabulary ids. */
  cellKeys?: ContentDb['cellKeys'];
  /** The player AI: traits visible from the first sight and tiers; both lists are appended. */
  ai?: ContentDb['ai'];
  /** Lists without ids that belong to the pack as a whole (the market, the shop, coating). */
  market?: ContentDb['market'];
  shop?: ContentDb['shop'];
  coat?: ContentDb['coat'];
};

/** A balance fragment: the same shape as `ContentDb['balance']`, with only the leaves the pack sets. */
export type PackBalance = { K?: Record<string, unknown>; [key: string]: unknown };

/** A reference to one entity of the composed database: its list and its id. */
export interface PatchTarget {
  kind: EntityListKey;
  id: string;
}

/**
 * A change to an entity of another pack. `set` replaces top-level fields; `append` adds items to
 * top-level arrays. Patches run in load order after all packs are merged; a patch to an entity that
 * does not exist is an error naming the pack.
 */
export interface EntityPatch {
  target: PatchTarget;
  set?: Record<string, unknown>;
  append?: Record<string, readonly unknown[]>;
}

/**
 * A change to a balance leaf of another pack: `path` is the dotted path from the balance object
 * (`K.power.E`, `pace.tai`); the leaf must exist and `set` replaces it (a number, a string, a
 * boolean or a list; never an object). Applied in load order with the entity patches; two packs
 * may not set the same path.
 */
export interface BalancePatch {
  balance: { path: string; set: number | string | boolean | readonly unknown[] };
}

export type Patch = EntityPatch | BalancePatch;

/**
 * The behaviour of a pack: a function that receives the base rules object and returns the extended
 * one (systems, action kinds, fight hooks, modifier providers, the AI). The type of the rules is
 * defined by `packages/core`; the content package only carries the function.
 * Declared here and not run: the core task implements it.
 */
export type PackRules = (base: Record<string, unknown>) => Record<string, unknown>;

export interface ContentPack {
  manifest: PackManifest;
  data: PackData;
  balance: PackBalance;
  /** Display strings by key (`<kind>.<id>.<field>`); `uk` is read by the UI, `en` is canonical names. */
  locales: { uk: Readonly<Record<string, string>>; en?: Readonly<Record<string, string>> };
  /** Icon names by entity kind and id. */
  icons: IconTable;
  patches: Patch[];
  /** Modifier keys the pack declares; each must start with `<pack id>:` unless the pack is `core`. */
  modifierKeys?: Readonly<Record<string, ModifierKeyInfo>>;
  /** Behaviour, see `PackRules`. Not run by `composeContent`. */
  rules?: PackRules;
  /** The id of a UI pack (in `apps/web`) that goes with this pack. Not read by `composeContent`. */
  ui?: string;
}
