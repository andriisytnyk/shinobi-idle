/**
 * Icons the app shell uses directly, outside the entity mapping. `pnpm icons:build` bundles them
 * together with the mapped entity icons, so every name here must exist in its collection.
 */

/** General UI icons from Lucide (ISC). Referenced as `lucide:<name>`. */
export const UI_ICON_NAMES = [
  'arrow-left',
  'book-open',
  'check',
  'chevron-down',
  'chevron-right',
  'circle-dot',
  'circle-help',
  'clipboard-list',
  'cloud-fog',
  'coins',
  'dumbbell',
  'ellipsis',
  'external-link',
  'footprints',
  'gift',
  'hammer',
  'hourglass',
  'info',
  'key-round',
  'landmark',
  'locate-fixed',
  'lock',
  'map',
  'map-pin',
  'menu',
  'minus',
  'mountain',
  'package',
  'panel-right',
  'pickaxe',
  'pin',
  'plus',
  'scroll-text',
  'search',
  'settings',
  'shovel',
  'square',
  'store',
  'swords',
  'tent',
  'trees',
  'users',
  'waves',
  'wheat',
  'x',
] as const;

/** game-icons names the shell uses by name (tab bar, rank mark) rather than through an entity. */
export const SHELL_GAME_ICONS = [
  'crossed-swords',
  'fist',
  'huts-village',
  'rank-3',
  'tied-scroll',
] as const;

export type UiIconName = (typeof UI_ICON_NAMES)[number];
