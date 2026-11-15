/**
 * The named parts of the interface: every meaningful rendered element carries `data-ui="<part>"`.
 * An element that represents an entity also carries `data-entity="<kind>:<id>"`, and one that
 * stands for a numbered place carries `data-slot-index`. With the slot names these are the
 * public contract for packs: `api.dom.observe({ part, kind?, id? }, …)` finds elements by them.
 * Adding a part is a compatible change; renaming one is not.
 */
export const UI_PARTS = [
  /** The root of a page; `data-page` is the page's registry key. */
  'page',
  /** A link of the sidebar menu or of the phone tab bar. */
  'nav-item',
  /** A skill's row in the sidebar. */
  'skill-row',
  /** The tile of one action: a technique, a herb, a recipe. */
  'action-tile',
  /** The cycle progress bar of a running tile. */
  'action-progress',
  /** The XP-per-hour figure of a tile. */
  'action-xp',
  /** The cycle length figure of a tile. */
  'action-interval',
  'mastery-ring',
  /** The pool bar of a skill page. */
  'pool-bar',
  /** One requirement row; it has `data-entity` when the requirement names an entity. */
  'req-row',
  /** A running slot in the «Зараз» bar; carries `data-slot-index`. */
  'now-slot',
  'goal-panel',
  'goal-row',
  /** The root of an entity page. */
  'entity-page',
  'entity-header',
  'entity-section',
  'ingredient-row',
  'shop-good',
  'bank-item',
  'building-card',
  /** A cell of the world map. */
  'world-cell',
  /** A point-of-interest row of the cell panel. */
  'poi-row',
  /** A mission's card on the board; carries `data-entity="mission:<id>"`. */
  'mission-card',
  /** One stage of a mission on its page; `data-stage` is its index. */
  'mission-stage',
  /** One thing a mission pays: a currency, an item, a village resource. */
  'mission-reward',
  /** A currency figure of the top bar. */
  'topbar-currency',
  'modal',
  /** A toast of the toast host. */
  'toast',
  /** The theme picker of the settings page. */
  'theme-select',
  /** The settings that packs registered. */
  'pack-settings',
  /** The notice about packs that were switched off because of an error. */
  'disabled-packs',
  /** The «Застосунок» section of the settings page. */
  'pwa-section',
] as const;

export type UiPart = (typeof UI_PARTS)[number];

/** Parts that always carry `data-entity`. */
export const ENTITY_PARTS: readonly UiPart[] = [
  'skill-row',
  'action-tile',
  'pool-bar',
  'now-slot',
  'entity-page',
  'ingredient-row',
  'shop-good',
  'bank-item',
  'building-card',
  'world-cell',
  'poi-row',
  'mission-card',
  'mission-stage',
  'mission-reward',
  'topbar-currency',
];
