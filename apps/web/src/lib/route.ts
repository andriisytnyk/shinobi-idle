import { tryActiveContent } from './active.ts';

/**
 * An entity kind: one of `content.entityKinds` of the running game. The kinds are data, so the type is
 * a plain string; `isEntityKind` tells whether a name is one of them.
 */
export type EntityKind = string;

/** Whether `kind` is an entity kind of the running game (its route is `#/<kind>/<id>`). */
export function isEntityKind(kind: string): boolean {
  return tryActiveContent()?.entityKinds.some((k) => k.id === kind) ?? false;
}

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/** Pages with a route of their own and no id: `#/quests`, `#/rank`, `#/combat`, `#/bank`, `#/shop`, `#/help`, `#/nature`, `#/world`. */
export const PAGES = [
  'quests',
  'rank',
  'combat',
  'bank',
  'shop',
  'help',
  'nature',
  'world',
] as const;
export type PageName = (typeof PAGES)[number];

export type Route =
  | { page: 'home' }
  | { page: 'skills' }
  | { page: 'entity'; ref: EntityRef }
  /** A tab page; the village page may also name the building it should focus: `#/village/core:forge`. */
  | { page: 'tab'; tab: string; focus?: string }
  | { page: PageName }
  /** The shop with its sell section brought into view: `#/shop/sell`. */
  | { page: 'shop'; section: 'sell' }
  | { page: 'credits' }
  | { page: 'settings' }
  | { page: 'notFound'; hash: string };

const TABS = ['missions', 'village', 'more'];

const isPage = (s: string): s is PageName => (PAGES as readonly string[]).includes(s);

/** Parses a location hash such as `#/skill/tai` or `#/technique/core:great_fireball`. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === '') return { page: 'home' };
  const [first = '', ...rest] = path.split('/');
  if (first === 'skills' && rest.length === 0) return { page: 'skills' };
  if (first === 'credits' && rest.length === 0) return { page: 'credits' };
  if (first === 'settings' && rest.length === 0) return { page: 'settings' };
  if (first === 'shop' && rest.length === 1 && rest[0] === 'sell') {
    return { page: 'shop', section: 'sell' };
  }
  if (isPage(first) && rest.length === 0) return { page: first };
  if (TABS.includes(first) && rest.length === 0) return { page: 'tab', tab: first };
  if (first === 'village' && rest.length > 0) {
    try {
      return { page: 'tab', tab: first, focus: decodeURIComponent(rest.join('/')) };
    } catch {
      return { page: 'notFound', hash };
    }
  }
  const id = rest.join('/');
  if (isEntityKind(first) && id !== '') {
    try {
      return { page: 'entity', ref: { kind: first, id: decodeURIComponent(id) } };
    } catch {
      // Malformed percent escape: treat the hash as an unknown route.
      return { page: 'notFound', hash };
    }
  }
  return { page: 'notFound', hash };
}

/** The hash that opens an entity's page. */
export function hrefFor(ref: EntityRef): string {
  return `#/${ref.kind}/${encodeURIComponent(ref.id).replace(/%3A/gi, ':')}`;
}
