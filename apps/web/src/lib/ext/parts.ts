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
  /** The medallion of an action: its pictogram on a tinted disc, with the rank stamp of a technique. */
  'action-emblem',
  /** The cycle progress bar of a running tile. */
  'action-progress',
  /** The XP-per-hour figure of a tile. */
  'action-xp',
  /** The Mastery-XP-per-hour figure of a tile. */
  'action-mastery',
  /** The cycle length figure of a tile. */
  'action-interval',
  'mastery-ring',
  /** The pool bar of a skill page. */
  'pool-bar',
  /** One requirement row; it has `data-entity` when the requirement names an entity. */
  'req-row',
  /** A running slot in the «Зараз» bar; carries `data-slot-index`. */
  'now-slot',
  /** The mark of a clone's slot in the «Зараз» bar. */
  'clone-tag',
  /** The «Новий клон для цієї дії» item of the performer menu: starts the action in a new clone. */
  'clone-start',
  /** The squad panel «Загін» (the side column, or the phone's strip of chips). */
  'squad',
  /** One performer of the panel; carries `data-performer` (0 is the character), `data-slot-index` and `data-state` (`idle`, `working`, `fighting`, `standing`). */
  'squad-row',
  /** The chip of a performer in the phone's strip. */
  'squad-chip',
  /** The sheet that a tap on the phone's strip opens. */
  'squad-sheet',
  /** The split start button: the main button names the performer, the chevron opens the menu. */
  'start-split',
  /** The menu of performers of the split start button. */
  'performer-menu',
  /** The marks of who runs an action, on a tile or a card. */
  'performer-marks',
  /** One mark: «Ти», «К1». */
  'performer-mark',
  /** What the dispel of a clone would bring, in the confirmation. */
  'dispel-preview',
  /** The switcher of the fight screen, when several fights run. */
  'fight-switcher',
  /** The part of the offline report that belongs to one performer. */
  'report-performer',
  'goal-panel',
  'goal-row',
  /** The pin that makes an entity the goal: on a tile's corner, as a caption under a requirement tree, or as a button of an entity page; carries `data-entity` and `data-pinned`. */
  'pin-goal',
  /** The details of an entity, open over its parent page; carries `data-entity` (not for an entity that is not shown). */
  'sheet',
  /** The path above a page that stays a page: its section, then the entity. */
  'breadcrumb',
  /** The root of an entity page. */
  'entity-page',
  'entity-header',
  'entity-section',
  'ingredient-row',
  'shop-good',
  'bank-item',
  'building-card',
  /** The world map: the SVG canvas with its zoom buttons. */
  'map',
  /** One hex of the world map; `data-hex` is its `"q,r"` coordinates, `data-state` is `here`, `fog`, `reach` (fog within survey range), `marked`, `partial` or `full`. */
  'hex',
  /** The player's token on the map. */
  'map-token',
  /** The panel of the selected hex: beside the map, or a bottom sheet on a narrow screen. */
  'hex-panel',
  /** A point-of-interest row of the cell panel. */
  'poi-row',
  /** A point of interest of a place in the hex panel (a place of power, an outpost, a hidden or veiled one); `data-point-status` is `veiled`, `open` or `found`, `data-point` the place (not for a veiled one). */
  'point-row',
  /** The markers of the points of interest drawn on a hex of the map. */
  'map-point',
  /** The map mastery block of the Scouting page. */
  'map-mastery',
  /** A mission's card on the board; carries `data-entity="mission:<id>"`. */
  'mission-card',
  /** The icon of a mission card or page that says solo or team; not a control. */
  'mission-kind',
  /** The stage, performer, time left and bar of a mission that runs, on its card. */
  'mission-progress',
  /** The progress bar of a running mission's card. */
  'mission-bar',
  /** The requirements of a card: the whole list, or a count with the «Вимоги» button. */
  'req-summary',
  /** The row that holds the start button at the bottom of a card. */
  'card-actions',
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
  /** The list of the content packs of this boot, with their versions. */
  'loaded-packs',
  /** Content packs the core left out because they failed to compose. */
  'failed-packs',
  /** Rules of packs that the core switched off during the session. */
  'disabled-rules',
  /** The notice about packs that were switched off because of an error. */
  'disabled-packs',
  /** The «Застосунок» section of the settings page. */
  'pwa-section',
  /** The «Телеметрія» section of the settings page. */
  'telemetry-section',
  /** The arena of a running fight: the player on one side, the enemies on the other. */
  'fight-arena',
  /** One body of the arena (the player or an enemy); `data-side`, and `data-entity` for an enemy that is shown. */
  'fighter',
  /** What a body does now: the action, its emblem, its progress bar and, for a technique, the seal strip; `data-phase`, `data-action`. */
  'fight-action',
  /** What an action did: the figure that flies off the target for about a second (`data-kind="pop"`) and the last-action line (`data-kind="last"`). */
  'fight-outcome',
  /** The hand of the preparation screen: the technique slots. */
  'prep-hand',
  /** The «Захист» block: the passive defensive techniques, the evasion and its parts. */
  'prep-defence',
  /** The verdict of the preparation screen and its reasons; `data-verdict`. */
  'prep-verdict',
  /** One entry of the Bingo book; carries `data-entity` while the enemy is shown. */
  'bingo-entry',
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
  'poi-row',
  'mission-card',
  'mission-stage',
  'mission-reward',
  'pin-goal',
  'topbar-currency',
  'bingo-entry',
];
