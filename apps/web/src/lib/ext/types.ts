import type { ContentDb } from '@shinobi/content';
import type { Command, CommandResult, GameEvent, GameState, ModResult } from '@shinobi/core';
import type { Component } from 'svelte';
import type { SlotContext, SlotContexts, SlotName } from './slots.ts';

export type { CoreApi } from './core-allowlist.ts';
import type { CoreApi } from './core-allowlist.ts';

export interface PackStorage {
  /** A JSON value stored for this pack, or `undefined`. Separate from the save and from other packs. */
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

/** What `dom.observe` looks for: a CSS selector, or a part of the interface (`data-ui`) with an optional entity. */
export type DomTarget = string | { part: string; kind?: string; id?: string };

export interface DomApi {
  /** The root element of the app, or null while the game is not shown. */
  readonly root: HTMLElement | null;
  /**
   * Calls `mount` for every element that matches now or appears later; the function it returns runs
   * when the element is removed from the page or the pack is unloaded. Returns a function that stops observing.
   * A convenience, not a security boundary: a pack may as well use `document` directly.
   */
  observe(
    target: DomTarget,
    mount: (el: HTMLElement, api: UiApi) => void | (() => void),
  ): () => void;
}

/** Hooks a pack may listen to. They run in pack load order; one that throws is skipped with one warning. */
export interface HookMap {
  /**
   * Before: runs synchronously when the hash has changed and the old page is still on screen; return `false`
   * to stay where you were, or another hash to go there instead. After: the new page is drawn.
   */
  route: (e: { phase: 'before' | 'after'; from: string; to: string }) => void | false | string;
  /** After every update of the game state. */
  state: () => void;
  /** Every game event drained from the core queue: level-up, item, quest step, fight log line. */
  event: (event: GameEvent) => void;
  /** May return a replacement command, or `false` to cancel it. */
  'command:before': (command: Command) => Command | false | void;
  'command:after': (command: Command, result: CommandResult) => void;
}

/** What a UI pack sees of the game: a read-only view, commands, and its own storage. */
export interface UiApi {
  /** A copy of the game state (or of what `select` returns from it); writing to it changes nothing. */
  read(): GameState;
  read<T>(select: (state: GameState) => T): T;
  readonly content: ContentDb;
  readonly core: CoreApi;
  /** The modifier total and breakdown for a key such as `xp.skill.tai`. */
  getMod(key: string): ModResult;
  t(key: string, params?: Record<string, string | number>): string;
  /** The hash that opens an entity's page. */
  href(ref: { kind: string; id: string }): string;
  /** Goes to a hash route such as `#/x/<pack>/<page>`. */
  navigate(route: string): void;
  /** The only way to change the game: the same commands the interface sends. */
  dispatch(command: Command): CommandResult;
  /** Calls `fn` after every update of the game state or of a setting (not at once: draw first, then subscribe); returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
  /** The value of a setting this pack registered (by its local id). */
  setting(id: string): boolean | string;
  readonly storage: PackStorage;
  readonly dom: DomApi;
  /** Listens to a hook; returns the function that stops listening. */
  on<K extends keyof HookMap>(name: K, fn: HookMap[K]): () => void;
  /** Shows a toast with this text. */
  toast(text: string): void;
}

/** A widget draws into `el` and returns the function that removes what it did. No framework is assumed. */
export type Widget<N extends SlotName = SlotName> = (
  el: HTMLElement,
  api: UiApi,
  ctx: SlotContexts[N],
) => void | (() => void);

/** What the host gives a page widget besides the container. */
export interface PageContext {
  /** The location hash. */
  hash: string;
  /** Values of the `:name` and `*name` parts of the route. */
  params: Record<string, string>;
}

/** A page drawn by a widget, or by a Svelte component placed in the tree of the app (built-in pages). */
export type PageMount =
  | ((el: HTMLElement, api: UiApi, ctx: PageContext) => void | (() => void))
  | {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svelte: Component<any>;
      props?: (ctx: PageContext) => Record<string, unknown>;
    };

/** Wraps a page: draw around or beside it and call `inner` (once) to draw the page itself, into `target` or `el`. */
export type PageWrap = (
  el: HTMLElement,
  api: UiApi,
  inner: (target?: HTMLElement) => () => void,
) => void | (() => void);

export interface UiTheme {
  /** Local id; the registered id is `<packId>:<id>`. */
  id: string;
  /** Localization key of the theme's name. */
  name: string;
  /** Overrides of CSS variables: `{ '--accent': 'tomato' }`. */
  tokens: Record<string, string>;
  /** Extra CSS; it is removed together with the theme. */
  css?: string;
}

export interface WidgetOptions {
  /** Local id; defaults to a number. */
  id?: string;
  /** Lower comes first; ties keep the order of registration. Default 100. */
  order?: number;
}

export interface PageSpec {
  id: string;
  /** Hash pattern: `#/x/<packId>/<pageId>`; `:name` is one segment, `*name` the rest of the path. */
  route: string;
  /** Localization key of the page title. */
  title: string;
  mount: PageMount;
  /** The nav item this page keeps lit. */
  nav?: string;
  /** Extra condition on the matched params (the generic entity page uses it). */
  guard?: (params: Record<string, string>) => boolean;
}

/**
 * Where a nav item shows: `tab` the phone tab bar, `side` the sidebar menu (on a phone it is reached from
 * «Ще»), `main` both.
 */
export type NavGroup = 'tab' | 'side' | 'main';

export interface NavItemSpec {
  id: string;
  group: NavGroup;
  /** Localization key of the label. */
  title: string;
  /** A game-icons name, or `lucide:<name>`. */
  icon: string;
  /** The hash the item opens. */
  route: string;
  /** Position in the sidebar. */
  order: number;
  /** Position in the tab bar; defaults to `order`. */
  tabOrder?: number;
}

export interface EntityLinkSpec {
  /** The entity kind whose pages show the link. */
  kind: string;
  /** Localization key of the link text. */
  title: string;
  /** Builds the target hash. Either `href` or `mount` is required. */
  href?: (ref: { kind: string; id: string }, api: UiApi) => string;
  /** Draws custom content into the link's container instead. */
  mount?: Widget<'entity.sections'>;
}

export interface SettingSpec {
  id: string;
  /** Localization key of the setting's label. */
  title: string;
  kind: 'toggle' | 'select';
  /** For `select`: the choices; `label` is a localization key. */
  options?: { value: string; label: string }[];
  default: boolean | string;
}

/** What a pack may register while it is set up. Everything is keyed by `<packId>:<id>`. */
export interface UiRegistrar {
  addWidget<N extends SlotName>(slot: N, widget: Widget<N>, opts?: WidgetOptions): void;
  addPage(spec: PageSpec): void;
  addNavItem(spec: NavItemSpec): void;
  addEntityLink(spec: EntityLinkSpec): void;
  addSetting(spec: SettingSpec): void;
  addTheme(theme: UiTheme): void;
  /** Texts of this pack; every key must start with `x.<packId>.`. */
  addLocale(lang: string, messages: Record<string, string>): void;
  /** Replaces the page `id` (`<packId>:<id>`, `core:settings` for the built-in ones). The later pack wins. */
  replacePage(id: string, mount: PageSpec['mount']): void;
  wrapPage(id: string, wrap: PageWrap): void;
  /** Hides a nav item; with `when` only while it returns true (it may read a setting). */
  removeNavItem(id: string, opts?: { when?: (api: UiApi) => boolean }): void;
  moveNavItem(id: string, patch: Partial<Pick<NavItemSpec, 'group' | 'order' | 'tabOrder'>>): void;
  /** Removes or reorders the widget of another pack (by its full key). */
  removeWidget(key: string): void;
  reorderWidget(key: string, order: number): void;
  /** CSS that may restyle anything; only tokens, slot names and `data-ui` parts are promised stable. */
  addStylesheet(css: string): void;
}

export interface UiPack {
  id: string;
  theme?: UiTheme;
  setup?(ui: UiRegistrar): void;
  /** Runs when the app is up; hooks and observers made here live until the returned function runs. */
  start?(api: UiApi): void | (() => void);
}

export type { SlotContext, SlotContexts, SlotName };
