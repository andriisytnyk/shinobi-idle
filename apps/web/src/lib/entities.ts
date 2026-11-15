import { content, localeKey, type LocaleKind } from '@shinobi/content';
import { hasKey, t } from './i18n.ts';
import { ENTITY_KINDS, type EntityKind, type EntityRef } from './route.ts';

/** The locale table that holds an entity kind's texts; statuses are stored as content states. */
function localeKind(kind: EntityKind): LocaleKind {
  return kind === 'status' ? 'state' : kind;
}

/** Localized display name of an entity; falls back to its id so a gap is visible, not blank. */
export function entityName(ref: EntityRef): string {
  const key = localeKey(localeKind(ref.kind), ref.id, 'name');
  return hasKey(key) ? t(key) : ref.id;
}

/** Localized description, or `null` when the entity has none yet. */
export function entityDesc(ref: EntityRef): string | null {
  const key = localeKey(localeKind(ref.kind), ref.id, 'desc');
  return hasKey(key) ? t(key) : null;
}

/** Whether a kind name from the core has a page in the web app. */
export function isEntityKind(kind: string): kind is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(kind);
}

/** A core entity reference as a web one, or null when the kind has no page here (for example a region before its page exists). */
export function webRef(ref: { kind: string; id: string } | null): EntityRef | null {
  return ref && isEntityKind(ref.kind) ? { kind: ref.kind, id: ref.id } : null;
}

/** The entity kind that an action kind of the core trains, so a tile can link to its page. */
const ACTION_ENTITY: Readonly<Record<string, EntityKind>> = {
  practice: 'technique',
  drill: 'exercise',
  meditate: 'practice',
  course: 'skill',
  fight: 'enemy',
  senseiTest: 'exam',
};

export function actionRef(action: { kind: string; id: string }): EntityRef {
  return { kind: ACTION_ENTITY[action.kind] ?? 'technique', id: action.id };
}

/** The entity that owns a mastery key; masteries live on techniques, exercises, practices and obstacles. */
export function masteryRef(key: string): EntityRef {
  if (content.exercises.some((e) => e.id === key)) return { kind: 'exercise', id: key };
  if (content.practices.some((p) => p.id === key)) return { kind: 'practice', id: key };
  if (content.obstacles.some((o) => o.id === key)) return { kind: 'obstacle', id: key };
  return { kind: 'technique', id: key };
}
