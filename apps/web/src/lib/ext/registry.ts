import { createGuard, type Guard } from './guard.ts';
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
  // `#/village/` is `#/village`.
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
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

export interface DisabledPack {
  packId: string;
  /** What went wrong, for the settings page. */
  message: string;
}

export interface NavRemoval {
  packId: string;
  when?: (api: UiApi) => boolean;
}

export interface UiRegistry {
  /** The packs that are running, in load order. */
  readonly packs: readonly string[];
  /** The packs that threw while they were set up or started and were switched off as a whole. */
  readonly disabled: readonly DisabledPack[];
  /** Switches a pack off: everything it registered is taken back, in reverse order. The built-in pack cannot be disabled. */
  disablePack(packId: string, error: unknown): void;
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
  /** The packs that asked to remove this nav item; with `when` only while it holds. */
  navRemovals(key: string): readonly NavRemoval[];
  /** The page a location hash opens, with the values of its route parameters. */
  matchPage(hash: string): { page: PageEntry; params: Record<string, string> } | null;
}

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs the `setup` of every pack and collects what they register. A pack that throws (a rule
 * broken, an error of its own) is switched off as a whole and everything it registered is taken
 * back; the others and the game go on. Only the built-in pack may stop the boot.
 *
 * Conflicts between packs are settled by load order: the later pack wins, and a warning names both.
 */
export function createRegistry(packs: readonly UiPack[], guard: Guard = createGuard()): UiRegistry {
  const widgets: WidgetEntry[] = [];
  const pages: PageEntry[] = [];
  const navItems: NavEntry[] = [];
  const links: LinkEntry[] = [];
  const settings: SettingEntry[] = [];
  const themes: ThemeEntry[] = [];
  const messages: Record<string, string> = {};
  const stylesheets: { packId: string; css: string }[] = [];
  const removedNav = new Map<string, NavRemoval[]>();
  const removedWidgets = new Map<string, string>();
  const seen = new Set<string>();
  /** Which pack moved a nav item last, and which reordered a widget last (for conflict warnings). */
  const movedBy = new Map<string, string>();
  const reorderedBy = new Map<string, string>();
  const packIds: string[] = [];
  const disabled: DisabledPack[] = [];
  /** What undoes each pack's registrations, in the order they were made. */
  const undoLog = new Map<string, (() => void)[]>();
  let seq = 0;

  let bySlot = new Map<SlotName, WidgetEntry[]>();
  let ranked: PageEntry[] = [];
  function rebuild(): void {
    bySlot = new Map();
    for (const w of widgets) {
      if (removedWidgets.has(w.key)) continue;
      const list = bySlot.get(w.slot) ?? [];
      list.push(w);
      bySlot.set(w.slot, list);
    }
    for (const list of bySlot.values()) list.sort((a, b) => a.order - b.order || a.seq - b.seq);
    ranked = [...pages].sort(
      (a, b) => specificity(b.segments) - specificity(a.segments) || a.seq - b.seq,
    );
  }

  const warn = (message: string): void => console.warn(`[ui] ${message}`);

  function disablePack(packId: string, error: unknown): void {
    if (packId === CORE_PACK) throw error;
    const undo = undoLog.get(packId) ?? [];
    for (const step of undo.reverse()) step();
    undoLog.delete(packId);
    const at = packIds.indexOf(packId);
    if (at >= 0) packIds.splice(at, 1);
    if (!disabled.some((d) => d.packId === packId)) {
      disabled.push({ packId, message: text(error) });
      warn(`pack "${packId}" is disabled: ${text(error)}`);
    }
    rebuild();
  }

  for (const pack of packs) {
    const packId = pack.id;
    const undo: (() => void)[] = [];
    const isCore = packId === CORE_PACK;
    try {
      if (typeof packId !== 'string' || !PACK_ID.test(packId)) {
        throw new UiPackError(
          String(packId),
          `id "${String(packId)}" is not a lowercase identifier`,
        );
      }
      if (packIds.includes(packId)) throw new UiPackError(packId, 'is registered twice');
      packIds.push(packId);
      undoLog.set(packId, undo);
      register(pack, undo, isCore);
    } catch (error) {
      if (isCore) throw error;
      // A pack that cannot even name itself has nothing registered; one that fails midway is rolled back.
      if (undoLog.get(packId) === undo) disablePack(packId, error);
      else {
        disabled.push({ packId: String(packId), message: text(error) });
        warn(`pack "${String(packId)}" is disabled: ${text(error)}`);
      }
    }
  }
  rebuild();

  function register(pack: UiPack, undo: (() => void)[], isCore: boolean): void {
    const packId = pack.id;
    const fail = (message: string): never => {
      throw new UiPackError(packId, message);
    };
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
      undo.push(() => seen.delete(unique));
      return key;
    };
    /** Adds an entry and remembers how to take it back. */
    const add = <T>(list: T[], item: T): void => {
      list.push(item);
      undo.push(() => {
        const at = list.indexOf(item);
        if (at >= 0) list.splice(at, 1);
      });
    };
    /** Sets a field and remembers its old value. */
    const set = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void => {
      const before = target[key];
      target[key] = value;
      undo.push(() => {
        target[key] = before;
      });
    };

    const addTheme = (theme: UiTheme): void => {
      const key = claim('theme', theme.id);
      for (const [name, value] of Object.entries(theme.tokens)) {
        if (!name.startsWith('--')) fail(`theme "${key}": token "${name}" is not a CSS variable`);
        if (typeof value !== 'string') fail(`theme "${key}": token "${name}" is not a string`);
      }
      add(themes, { key, packId, name: theme.name, tokens: { ...theme.tokens }, css: theme.css });
    };

    const navItem = (verb: string, id: string): NavEntry => {
      const item = navItems.find((n) => n.key === own(id));
      if (!item) fail(`${verb}: no nav item "${own(id)}"`);
      return item as NavEntry;
    };
    const pageOf = (verb: string, id: string): PageEntry => {
      const page = pages.find((p) => p.key === own(id));
      if (!page) fail(`${verb}: no page "${own(id)}"`);
      return page as PageEntry;
    };
    const registrar: UiRegistrar = {
      addWidget<N extends SlotName>(slot: N, widget: Widget<N>, opts: WidgetOptions = {}): void {
        if (!isSlotName(slot)) fail(`unknown slot "${String(slot)}"`);
        const id = opts.id ?? `${slot}.${++autoId}`;
        const key = claim('widget', id);
        add(widgets, {
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
        add(pages, {
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
        add(navItems, { ...rest, key, packId, id: isCore ? id : key });
      },
      addEntityLink(spec) {
        const key = claim(
          'link',
          `${spec.kind}.${links.filter((l) => l.packId === packId && l.kind === spec.kind).length + 1}`,
        );
        if (!spec.href && !spec.mount) fail(`entity link "${key}" needs href or mount`);
        add(links, { ...spec, key, packId });
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
        add(settings, { ...rest, key, packId });
      },
      addTheme,
      replacePage(id, mount) {
        const page = pageOf('replacePage', id);
        if (page.replacedBy !== undefined) {
          warn(
            `page "${page.key}" was replaced by "${page.replacedBy}" and is now replaced by "${packId}"; the later pack wins`,
          );
        }
        set(page, 'mount', mount);
        set(page, 'replacedBy', packId);
      },
      wrapPage(id, fn) {
        const page = pageOf('wrapPage', id);
        const other = page.wraps.find((w) => w.packId !== packId);
        if (other) {
          warn(
            `page "${page.key}" is wrapped by "${other.packId}" and by "${packId}"; the later pack wraps outside`,
          );
        }
        const wrap = { packId, fn };
        add(page.wraps, wrap);
      },
      removeNavItem(id, opts = {}) {
        const key = navItem('removeNavItem', id).key;
        const list = removedNav.get(key) ?? [];
        const removal: NavRemoval = { packId, when: opts.when };
        list.push(removal);
        removedNav.set(key, list);
        undo.push(() => {
          const at = list.indexOf(removal);
          if (at >= 0) list.splice(at, 1);
        });
      },
      moveNavItem(id, patch) {
        const item = navItem('moveNavItem', id);
        const prior = movedBy.get(item.key);
        if (prior !== undefined && prior !== packId) {
          warn(
            `nav item "${item.key}" is moved by "${prior}" and by "${packId}"; the later pack wins`,
          );
        }
        movedBy.set(item.key, packId);
        undo.push(() => {
          if (movedBy.get(item.key) === packId) movedBy.delete(item.key);
        });
        for (const [field, value] of Object.entries(patch) as [keyof NavEntry, never][]) {
          set(item, field, value);
        }
      },
      removeWidget(key) {
        const full = own(key);
        if (!widgets.some((w) => w.key === full)) fail(`removeWidget: no widget "${full}"`);
        if (!removedWidgets.has(full)) {
          removedWidgets.set(full, packId);
          undo.push(() => removedWidgets.delete(full));
        }
      },
      reorderWidget(key, order) {
        const w = widgets.find((x) => x.key === own(key));
        if (!w) fail(`reorderWidget: no widget "${own(key)}"`);
        const entry = w as WidgetEntry;
        const prior = reorderedBy.get(entry.key);
        if (prior !== undefined && prior !== packId) {
          warn(
            `widget "${entry.key}" is reordered by "${prior}" and by "${packId}"; the later pack wins`,
          );
        }
        reorderedBy.set(entry.key, packId);
        undo.push(() => {
          if (reorderedBy.get(entry.key) === packId) reorderedBy.delete(entry.key);
        });
        set(entry, 'order', order);
      },
      addStylesheet(css) {
        if (typeof css !== 'string') fail('addStylesheet needs CSS text');
        add(stylesheets, { packId, css });
      },
      addLocale(lang, map) {
        if (typeof lang !== 'string' || lang === '') fail('a locale needs a language');
        const prefix = `x.${packId}.`;
        for (const [k, v] of Object.entries(map)) {
          if (!isCore && !k.startsWith(prefix))
            fail(`locale key "${k}" must start with "${prefix}"`);
          if (typeof v !== 'string') fail(`locale key "${k}" is not a string`);
          // Only Ukrainian is shown for now; other languages are accepted so that packs can ship them early.
          if (lang === 'uk') {
            const had = Object.hasOwn(messages, k);
            const before = messages[k];
            messages[k] = v;
            undo.push(() => {
              if (had && before !== undefined) messages[k] = before;
              else delete messages[k];
            });
          }
        }
      },
    };

    if (pack.theme) addTheme(pack.theme);
    pack.setup?.(registrar);
  }

  return {
    get packs() {
      return packIds;
    },
    get disabled() {
      return disabled;
    },
    disablePack,
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
    navRemovals: (key) => removedNav.get(key) ?? [],
    matchPage(hash) {
      const parts = hashSegments(hash);
      for (const page of ranked) {
        const params = matchSegments(page.segments, parts);
        if (
          params &&
          guard.call(page.key, 'its route guard', () => page.guard?.(params) ?? true, false)
        ) {
          return { page, params };
        }
      }
      return null;
    },
  };
}
