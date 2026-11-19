import type { ContentDb } from '@shinobi/content';
import type { Req } from '@shinobi/core';
import type { EntityRef } from './route.ts';

/*
 * Reading entities of any kind out of the content without knowing the kind: the generic entity
 * page and the generic point-of-interest row use this.
 */

type Lists = Record<string, readonly { id: string }[] | undefined>;

/** The entity a reference names, as the content has it, or null when there is none. */
export function findEntity(
  content: ContentDb,
  ref: EntityRef,
): ({ id: string } & Record<string, unknown>) | null {
  const kind = content.entityKinds.find((k) => k.id === ref.kind);
  if (!kind) return null;
  if (kind.list !== null) {
    const found = (content as unknown as Lists)[kind.list]?.find((e) => e.id === ref.id);
    return (found as ({ id: string } & Record<string, unknown>) | undefined) ?? null;
  }
  // A kind that lives inside another list: the points of interest are nested in the cells.
  if (ref.kind === 'poi') {
    for (const cell of content.cells) {
      const poi = cell.pois.find((p) => p.id === ref.id);
      if (poi) return poi as unknown as { id: string } & Record<string, unknown>;
    }
  }
  return null;
}

/** Entity id -> its kind, for every kind that has a list; built once per content. */
const kindIndex = new WeakMap<ContentDb, Map<string, string>>();
function kindsById(content: ContentDb): Map<string, string> {
  let index = kindIndex.get(content);
  if (!index) {
    index = new Map();
    const lists = content as unknown as Lists;
    for (const kind of content.entityKinds) {
      if (kind.list === null) continue;
      for (const e of lists[kind.list] ?? []) if (!index.has(e.id)) index.set(e.id, kind.id);
    }
    for (const cell of content.cells) for (const poi of cell.pois) index.set(poi.id, 'poi');
    kindIndex.set(content, index);
  }
  return index;
}

/**
 * The entities that a piece of content data names: every string inside it (to a shallow depth)
 * that is the id of an entity, once each, in reading order. `self` is left out.
 */
export function entityRefsIn(value: unknown, content: ContentDb, self?: EntityRef): EntityRef[] {
  const kinds = kindsById(content);
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  const walk = (v: unknown, depth: number, field: string): void => {
    if (typeof v === 'string') {
      const kind = kinds.get(v);
      if (!kind || seen.has(v) || (self && self.kind === kind && self.id === v)) return;
      // The id of the entity itself and its group or region fields are shown elsewhere or are not links.
      if (field === 'id') return;
      seen.add(v);
      out.push({ kind, id: v });
    } else if (Array.isArray(v) && depth > 0) {
      for (const item of v) walk(item, depth - 1, field);
    } else if (v !== null && typeof v === 'object' && depth > 0) {
      for (const [key, item] of Object.entries(v)) walk(item, depth - 1, key);
    }
  };
  walk(value, 3, '');
  return out;
}

/** The requirement tree an entity carries, when it has one: its `unlockReq`, `unlock` or `req`. */
export function reqOf(entity: Record<string, unknown>): Req | null {
  for (const field of ['unlockReq', 'unlock', 'req']) {
    const v = entity[field];
    if (v !== null && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string') {
      return v as Req;
    }
  }
  return null;
}
