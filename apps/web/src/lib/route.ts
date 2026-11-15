/** Entity kinds that have a page. Exercises, practices and obstacles are the action entities of the training skills. */
export const ENTITY_KINDS = [
  'skill',
  'technique',
  'item',
  'recipe',
  'mission',
  'enemy',
  'boss',
  'region',
  'building',
  'gear',
  'seal',
  'exercise',
  'practice',
  'obstacle',
  'status',
  'trait',
  'quest',
  'exam',
  'cell',
  'combo',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/** Pages with a route of their own and no id: `#/quests`, `#/rank`, `#/combat`, `#/bank`, `#/help`, `#/nature`. */
export const PAGES = ['quests', 'rank', 'combat', 'bank', 'help', 'nature'] as const;
export type PageName = (typeof PAGES)[number];

export type Route =
  | { page: 'home' }
  | { page: 'skills' }
  | { page: 'entity'; ref: EntityRef }
  | { page: 'tab'; tab: string }
  | { page: PageName }
  | { page: 'credits' }
  | { page: 'settings' }
  | { page: 'notFound'; hash: string };

const TABS = ['missions', 'village', 'more'];

const isKind = (s: string): s is EntityKind => (ENTITY_KINDS as readonly string[]).includes(s);
const isPage = (s: string): s is PageName => (PAGES as readonly string[]).includes(s);

/** Parses a location hash such as `#/skill/tai` or `#/technique/core:great_fireball`. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === '') return { page: 'home' };
  const [first = '', ...rest] = path.split('/');
  if (first === 'skills' && rest.length === 0) return { page: 'skills' };
  if (first === 'credits' && rest.length === 0) return { page: 'credits' };
  if (first === 'settings' && rest.length === 0) return { page: 'settings' };
  if (isPage(first) && rest.length === 0) return { page: first };
  if (TABS.includes(first) && rest.length === 0) return { page: 'tab', tab: first };
  const id = rest.join('/');
  if (isKind(first) && id !== '') {
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
