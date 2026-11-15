import { isSlotName, type SlotName } from './slots.ts';
import type {
  EntityLinkSpec,
  NavItemSpec,
  PageSpec,
  PageWrap,
  UiApi,
  SettingSpec,
  UiPack,
  UiRegistrar,
  UiTheme,
  Widget,
  WidgetOptions,
} from './types.ts';

/** The pack of the built-in game; it alone may register routes and keys outside the pack namespace. */
export const CORE_PACK = 'core';
/** Id of the theme that applies no overrides: the look of `tokens.css`. */
export const BASE_THEME = 'core:base';

/** A registration that breaks the rules of UI packs. The message names the pack. */
export class UiPackError extends Error {
  constructor(
    readonly packId: string,
    message: string,
  ) {
    super(`UI pack "${packId}": ${message}`);
    this.name = 'UiPackError';
  }
}

interface Owned {
  /** `<packId>:<id>`. */
  key: string;
  packId: string;
}

export interface WidgetEntry extends Owned {
  slot: SlotName;
  widget: Widget<never>;
  order: number;
  seq: number;
}
export interface PageEntry extends Owned, Omit<PageSpec, 'id'> {
  segments: Segment[];
  seq: number;
  /** Wrappers added by packs, innermost first. */
  wraps: { packId: string; fn: PageWrap }[];
  /** The pack whose `replacePage` last changed the mount. */
  replacedBy?: string;
}
export interface NavEntry extends Owned, Omit<NavItemSpec, 'id'> {
  /** The item id as the rest of the app knows it: local for the built-in game, the full key for a pack. */
  id: string;
}
export interface LinkEntry extends Owned, EntityLinkSpec {}
export interface SettingEntry extends Owned, Omit<SettingSpec, 'id'> {}
export interface ThemeEntry extends Owned, Omit<UiTheme, 'id'> {}

type Segment = { t: 'lit'; v: string } | { t: 'one'; name: string } | { t: 'rest'; name: string };

const PACK_ID = /^[a-z][a-z0-9_]*$/;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** The path parts of a hash such as `#/skill/tai`; the empty path (home) has none. */
export function hashSegments(hash: string): string[] {
  const path = hash.replace(/^#\/?/, '');
  return path === '' ? [] : path.split('/');
}

function compile(route: string): Segment[] {
  return hashSegments(route).map((s): Segment => {
    if (s.startsWith(':')) return { t: 'one', name: s.slice(1) };
    if (s.startsWith('*')) return { t: 'rest', name: s.slice(1) };
    return { t: 'lit', v: s };
  });
}

function matchSegments(segments: Segment[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === undefined) return null;
    if (seg.t === 'rest') {
      const rest = parts.slice(i).join('/');
      if (rest === '') return null;
      if (!decode(seg.name, rest, params)) return null;
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (seg.t === 'lit') {
      if (seg.v !== part) return null;
    } else if (part === '' || !decode(seg.name, part, params)) return null;
  }
  return parts.length === segments.length ? params : null;
}

function decode(name: string, value: string, params: Record<string, string>): boolean {
  try {
    params[name] = decodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

/** How specific a pattern is: more literal segments first, a trailing wildcard last. */
const specificity = (segments: Segment[]): number =>
  segments.filter((s) => s.t === 'lit').length * 10 - segments.filter((s) => s.t === 'rest').length;

export interface UiRegistry {
  readonly packs: readonly string[];
  /** Widgets of a slot in display order. */
  widgets(slot: SlotName): readonly WidgetEntry[];
  readonly pages: readonly PageEntry[];
  /** Nav items in registration order. */
  readonly navItems: readonly NavEntry[];
  entityLinks(kind: string): readonly LinkEntry[];
  readonly settings: readonly SettingEntry[];
  setting(key: string): SettingEntry | undefined;
  readonly themes: readonly ThemeEntry[];
  /** The theme with this id; the base theme for an unknown id. */
  theme(id: string): ThemeEntry | undefined;
  /** Texts added by packs, by key. */
  readonly messages: Readonly<Record<string, string>>;
  /** Stylesheets that packs ship, in load order. */
  readonly stylesheets: readonly { packId: string; css: string }[];
  /** Whether a pack removed this nav item (for now: `when` may depend on a setting). */
  isNavRemoved(key: string, api: (packId: string) => UiApi): boolean;
  /** The page a location hash opens, with the values of its route parameters. */
  matchPage(hash: string): { page: PageEntry; params: Record<string, string> } | null;
}

/** Runs the `setup` of every pack and collects what they register. */
export function createRegistry(packs: readonly UiPack[]): UiRegistry {
  const widgets: WidgetEntry[] = [];
  const pages: PageEntry[] = [];
  const navItems: NavEntry[] = [];
  const links: LinkEntry[] = [];
  const settings: SettingEntry[] = [];
  const themes: ThemeEntry[] = [];
  const messages: Record<string, string> = {};
  const stylesheets: { packId: string; css: string }[] = [];
  const removedNav = new Map<string, { packId: string; when?: (api: UiApi) => boolean }[]>();
  const removedWidgets = new Set<string>();
  const seen = new Set<string>();
  const packIds: string[] = [];
  let seq = 0;

  for (const pack of packs) {
    const packId = pack.id;
    const fail = (message: string): never => {
      throw new UiPackError(packId, message);
    };
    if (typeof packId !== 'string' || !PACK_ID.test(packId)) {
      fail(`id "${String(packId)}" is not a lowercase identifier`);
    }
    if (packIds.includes(packId)) fail('is registered twice');
    packIds.push(packId);
    const isCore = packId === CORE_PACK;
    const widgetIds = new Set<string>();
    /** A target id as written by a pack: without a prefix it is the pack's own. */
    const own = (id: string): string => (id.includes(':') ? id : `${packId}:${id}`);
    let autoId = 0;

    const claim = (kind: string, id: string): string => {
      if (typeof id !== 'string' || !LOCAL_ID.test(id))
        fail(`${kind} id "${String(id)}" is not valid`);
      const key = `${packId}:${id}`;
      const unique = `${kind}\u0000${key}`;
      if (seen.has(unique)) fail(`duplicate ${kind} "${key}"`);
      seen.add(unique);
      return key;
    };

    const addTheme = (theme: UiTheme): void => {
      const key = claim('theme', theme.id);
      for (const [name, value] of Object.entries(theme.tokens)) {
        if (!name.startsWith('--')) fail(`theme "${key}": token "${name}" is not a CSS variable`);
        if (typeof value !== 'string') fail(`theme "${key}": token "${name}" is not a string`);
      }
      themes.push({ key, packId, name: theme.name, tokens: { ...theme.tokens }, css: theme.css });
    };

    const registrar: UiRegistrar = {
      addWidget<N extends SlotName>(slot: N, widget: Widget<N>, opts: WidgetOptions = {}): void {
        if (!isSlotName(slot)) fail(`unknown slot "${String(slot)}"`);
        const id = opts.id ?? `${slot}.${++autoId}`;
        const key = claim('widget', id);
        widgetIds.add(key);
        widgets.push({
          key,
          packId,
          slot,
          widget: widget as Widget<never>,
          order: opts.order ?? 100,
          seq: seq++,
        });
      },
      addPage(spec) {
        const key = claim('page', spec.id);
        if (!spec.route.startsWith('#/'))
          fail(`page "${key}": route "${spec.route}" must start with #/`);
        const prefix = `#/x/${packId}/`;
        if (!isCore && !spec.route.startsWith(prefix)) {
          fail(`page "${key}": route "${spec.route}" is outside ${prefix}`);
        }
        const { id: _id, nav, ...rest } = spec;
        // A pack names its own nav items by their local id.
        const navId = nav === undefined || isCore || nav.includes(':') ? nav : `${packId}:${nav}`;
        pages.push({
          ...rest,
          nav: navId,
          key,
          packId,
          segments: compile(spec.route),
          seq: seq++,
          wraps: [],
        });
      },
      addNavItem(spec) {
        const key = claim('nav', spec.id);
        if (!spec.route.startsWith('#/'))
          fail(`nav item "${key}": route "${spec.route}" must start with #/`);
        const { id, ...rest } = spec;
        navItems.push({ ...rest, key, packId, id: isCore ? id : key });
      },
      addEntityLink(spec) {
        const key = claim(
          'link',
          `${spec.kind}.${links.filter((l) => l.packId === packId && l.kind === spec.kind).length + 1}`,
        );
        if (!spec.href && !spec.mount) fail(`entity link "${key}" needs href or mount`);
        links.push({ ...spec, key, packId });
      },
      addSetting(spec) {
        const key = claim('setting', spec.id);
        if (spec.kind === 'toggle') {
          if (typeof spec.default !== 'boolean')
            fail(`setting "${key}": a toggle defaults to true or false`);
        } else if (spec.kind === 'select') {
          const values = (spec.options ?? []).map((o) => o.value);
          if (values.length === 0) fail(`setting "${key}": a select needs options`);
          if (typeof spec.default !== 'string' || !values.includes(spec.default)) {
            fail(`setting "${key}": default is not one of the options`);
          }
        } else {
          fail(`setting "${key}": unknown kind`);
        }
        const { id: _id, ...rest } = spec;
        settings.push({ ...rest, key, packId });
      },
      addTheme,
      replacePage(id, mount) {
        const page = pages.find((p) => p.key === own(id));
        if (!page) fail(`replacePage: no page "${own(id)}"`);
        if (page && page.replacedBy !== undefined) {
          console.warn(
            `[ui] page "${page.key}" was replaced by "${page.replacedBy}" and is now replaced by "${packId}"; the later pack wins`,
          );
        }
        if (page) {
          page.mount = mount;
          page.replacedBy = packId;
        }
      },
      wrapPage(id, fn) {
        const page = pages.find((p) => p.key === own(id));
        if (!page) fail(`wrapPage: no page "${own(id)}"`);
        page?.wraps.push({ packId, fn });
      },
      removeNavItem(id, opts = {}) {
        const key = own(id);
        if (!navItems.some((n) => n.key === key)) {
          fail(`removeNavItem: no nav item "${key}"`);
        }
        const list = removedNav.get(key) ?? [];
        list.push({ packId, when: opts.when });
        removedNav.set(key, list);
      },
      moveNavItem(id, patch) {
        const item = navItems.find((n) => n.key === own(id));
        if (!item) fail(`moveNavItem: no nav item "${own(id)}"`);
        if (item) Object.assign(item, patch);
      },
      removeWidget(key) {
        if (!widgets.some((w) => w.key === own(key))) fail(`removeWidget: no widget "${own(key)}"`);
        removedWidgets.add(own(key));
      },
      reorderWidget(key, order) {
        const w = widgets.find((x) => x.key === own(key));
        if (!w) fail(`reorderWidget: no widget "${own(key)}"`);
        if (w) w.order = order;
      },
      addStylesheet(css) {
        if (typeof css !== 'string') fail('addStylesheet needs CSS text');
        stylesheets.push({ packId, css });
      },
      addLocale(lang, map) {
        if (typeof lang !== 'string' || lang === '') fail('a locale needs a language');
        const prefix = `x.${packId}.`;
        for (const [k, v] of Object.entries(map)) {
          if (!isCore && !k.startsWith(prefix))
            fail(`locale key "${k}" must start with "${prefix}"`);
          if (typeof v !== 'string') fail(`locale key "${k}" is not a string`);
          // Only Ukrainian is shown for now; other languages are accepted so that packs can ship them early.
          if (lang === 'uk') messages[k] = v;
        }
      },
    };

    if (pack.theme) addTheme(pack.theme);
    pack.setup?.(registrar);
  }

  const bySlot = new Map<SlotName, WidgetEntry[]>();
  for (const w of widgets) {
    if (removedWidgets.has(w.key)) continue;
    const list = bySlot.get(w.slot) ?? [];
    list.push(w);
    bySlot.set(w.slot, list);
  }
  for (const list of bySlot.values()) list.sort((a, b) => a.order - b.order || a.seq - b.seq);

  const ranked = [...pages].sort(
    (a, b) => specificity(b.segments) - specificity(a.segments) || a.seq - b.seq,
  );

  return {
    packs: packIds,
    widgets: (slot) => bySlot.get(slot) ?? [],
    pages,
    navItems,
    entityLinks: (kind) => links.filter((l) => l.kind === kind),
    settings,
    setting: (key) => settings.find((s) => s.key === key),
    themes,
    theme: (id) => themes.find((t) => t.key === id) ?? themes.find((t) => t.key === BASE_THEME),
    messages,
    stylesheets,
    isNavRemoved(key, api) {
      return (removedNav.get(key) ?? []).some((r) => (r.when ? r.when(api(r.packId)) : true));
    },
    matchPage(hash) {
      const parts = hashSegments(hash);
      for (const page of ranked) {
        const params = matchSegments(page.segments, parts);
        if (params && (page.guard?.(params) ?? true)) return { page, params };
      }
      return null;
    },
  };
}
