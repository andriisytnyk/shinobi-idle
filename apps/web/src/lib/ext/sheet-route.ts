import type { ContentDb } from '@shinobi/content';
import { findEntity } from '../entity-data.ts';
import { revealLevel } from '../reveal.ts';
import { parseHash, type EntityRef } from '../route.ts';
import type { SheetEntry, UiRegistry } from './registry.ts';

/** How much of an entity the player may see; an id the content does not have reads like one that is not discovered: typing addresses tells nothing. */
export const levelOf = (content: ContentDb, ref: EntityRef): 'hidden' | 'name' | 'full' =>
  findEntity(content, ref) === null ? 'hidden' : revealLevel(ref);

export interface SheetRoute {
  spec: SheetEntry;
  ref: EntityRef;
  level: 'hidden' | 'name' | 'full';
  /** The hash of the page that is drawn under the sheet. */
  parent: string;
}

/** Runs the parent function of a pack; the app passes its guard so a function that throws is reported once and not asked again. */
export type ParentCall = <T>(spec: SheetEntry, fn: () => T) => T | null;

const direct: ParentCall = (_spec, fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/**
 * Whether an address opens the details of an entity as a sheet, and over which page. The parent of an
 * entity the player has not discovered is the fixed `home` of its kind: the real one would tell what the
 * entity belongs to. A parent that no page answers to leaves the entity on its generic page.
 */
export function sheetRoute(
  registry: UiRegistry,
  content: ContentDb,
  hash: string,
  call: ParentCall = direct,
): SheetRoute | null {
  const route = parseHash(hash);
  if (route.page !== 'entity') return null;
  const ref = route.ref;
  const spec = registry.sheet(ref.kind);
  if (!spec) return null;
  const level = levelOf(content, ref);
  const parent = spec.parent;
  let at: string | null = null;
  if (typeof parent === 'string') at = parent;
  else if (level !== 'hidden') at = call(spec, () => parent(ref, { content }));
  at ??= spec.home ?? null;
  if (at === null || registry.matchPage(at) === null) return null;
  return { spec, ref, level, parent: at };
}
