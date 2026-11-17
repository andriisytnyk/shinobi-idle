import type { ContentDb } from '@shinobi/content';
import { hexKey, hexOfAddress, isSurveyed, type GameState } from '@shinobi/core';
import { tryActiveContent, tryActiveState } from './active.ts';
import { fallbackText, hasKey, reportMissing, t } from './i18n.ts';
import { MASK, revealLevel } from './reveal.ts';
import { isEntityKind, type EntityRef } from './route.ts';

export { isEntityKind };

/** The locale tables that may hold an entity kind's texts: statuses are stored as content states. */
function localeKinds(kind: string): string[] {
  return kind === 'status' ? ['state', 'status'] : [kind];
}

/** The first of an entity's text keys that has a text. */
function textKey(ref: EntityRef, field: string): string | null {
  for (const kind of localeKinds(ref.kind)) {
    const key = `${kind}.${ref.id}.${field}`;
    if (hasKey(key)) return key;
  }
  return null;
}

/** A readable name for an id that has no text: its last part, humanised. */
export function humanId(id: string): string {
  return fallbackText(`x.${id.slice(id.lastIndexOf(':') + 1)}`);
}

/**
 * Localized display name of an entity; a missing text shows the humanised id (and is reported once
 * in dev), never a key. An entity the player has not discovered reads «???» (the reveal rule).
 */
export function entityName(ref: EntityRef): string {
  if (revealLevel(ref) === 'hidden') return MASK;
  const key = textKey(ref, 'name');
  if (key) return t(key);
  reportMissing(`${localeKinds(ref.kind)[0] ?? ref.kind}.${ref.id}.name`);
  return humanId(ref.id);
}

/** Localized description, or `null` when the entity has none or the player may not read it yet. */
export function entityDesc(ref: EntityRef): string | null {
  if (revealLevel(ref) !== 'full') return null;
  // A map cell carries a short note instead of a description.
  const key = textKey(ref, ref.kind === 'cell' ? 'note' : 'desc');
  return key ? t(key) : null;
}

/** A core entity reference as a web one, or null when the kind has no page in this game. */
export function webRef(ref: { kind: string; id: string } | null): EntityRef | null {
  return ref && isEntityKind(ref.kind) ? { kind: ref.kind, id: ref.id } : null;
}

/** The pseudo kind of a place on the map that is no cell: a plain hex, named by its address (`"q,r"`). It links to the map. */
export const HEX_KIND = 'hex';

/** The entity kind that an action kind of the core trains, so a tile can link to its page. */
const ACTION_ENTITY: Readonly<Record<string, string>> = {
  practice: 'technique',
  drill: 'exercise',
  meditate: 'practice',
  course: 'skill',
  gather: 'item',
  craft: 'recipe',
  fight: 'enemy',
  mission: 'mission',
  senseiTest: 'exam',
  explore: 'cell',
  walk: 'cell',
};

/**
 * The entity an action names. A kind with no entry above is the pack's own: when its locale names
 * the action as `<kind>.<id>.name` (an operation does), that is the reference; else a technique.
 * A survey or walk to a hex in fog names the hex, not the cell on it.
 */
export function actionRef(action: { kind: string; id: string }, state?: GameState): EntityRef {
  // A hex that is no cell, and the auto-survey, have no page: the `hex` kind names them on the map.
  if (action.kind === 'autosurvey' || action.kind === 'stand') return { kind: HEX_KIND, id: '' };
  if (action.kind === 'explore' || action.kind === 'walk') {
    const content = tryActiveContent();
    const known = state ?? tryActiveState();
    const hex = content ? hexOfAddress(content, action.id) : null;
    const key = hex ? hexKey(hex.q, hex.r) : action.id;
    // A hex the player has not surveyed is only "a hex in fog": the cell on it is not named, nor linked.
    const fog = content && known && hex ? !isSurveyed(known, content, key) : false;
    if (fog) return { kind: HEX_KIND, id: key };
    if (!content?.cells.some((c) => c.id === action.id)) return { kind: HEX_KIND, id: action.id };
  }
  const mapped = ACTION_ENTITY[action.kind];
  if (mapped) return { kind: mapped, id: action.id };
  return {
    kind: hasKey(`${action.kind}.${action.id}.name`) ? action.kind : 'technique',
    id: action.id,
  };
}

/** The entity that owns a mastery key; masteries live on techniques, exercises, practices and obstacles. */
export function masteryRef(key: string, content: ContentDb): EntityRef {
  if (content.exercises.some((e) => e.id === key)) return { kind: 'exercise', id: key };
  if (content.practices.some((p) => p.id === key)) return { kind: 'practice', id: key };
  if (content.obstacles.some((o) => o.id === key)) return { kind: 'obstacle', id: key };
  return { kind: 'technique', id: key };
}
