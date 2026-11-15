/* eslint-disable svelte/prefer-svelte-reactivity -- the sets and maps here are plain bookkeeping that no view reads */
import * as core from '@shinobi/core';
import type { Command } from '@shinobi/core';
import { getContext, setContext, untrack } from 'svelte';
import type { Game } from '../game.svelte.ts';
import { deepFreeze } from '../freeze.ts';
import { createTranslator, t as baseT, type Params } from '../i18n.ts';
import { hrefFor, type EntityRef } from '../route.ts';
import { navigate } from '../router.svelte.ts';
import { browserStorage, type createSettings, type TextStorage } from '../settings.svelte.ts';
import { toasts } from '../toasts.svelte.ts';
import { createDomHub } from './dom-hub.ts';
import { corePublic } from './core-allowlist.ts';
import { createGuard } from './guard.ts';
import { createRegistry, type ThemeEntry, type UiRegistry } from './registry.ts';
import type { HookMap, PackStorage, UiApi, UiPack } from './types.ts';

type Settings = ReturnType<typeof createSettings>;

export interface UiDeps {
  game: Game;
  settings: Settings;
  /** Where packs keep their own data; defaults to `localStorage`. */
  storage?: TextStorage | null;
}

/** Anything a host can run: a widget, a page widget or a link widget with the pack that owns it. */
export interface Runnable {
  key: string;
  packId: string;
  widget: (el: HTMLElement, api: UiApi, ctx: never) => void | (() => void);
}

export const STORAGE_PREFIX = 'shinobi.ui.';

/**
 * The UI registries and the services widgets use, created once per boot of the app. Nothing here is
 * global: two apps mounted side by side have two of these.
 */
export function createUi(packs: readonly UiPack[], deps: UiDeps) {
  const { game, settings } = deps;
  const guard = createGuard();
  const registry: UiRegistry = createRegistry(packs, guard);
  const packT = createTranslator(registry.messages);
  const text = deps.storage === undefined ? browserStorage() : deps.storage;
  const hub = createDomHub({
    createApi: (packId, owner, scope) => createApi(packId, owner, scope),
    warn: (key, phase, error) => guard.warn(key, phase, error),
  });

  /** Translates a key of the game or of a pack. */
  const t = (key: string, params?: Params): string =>
    Object.hasOwn(registry.messages, key) ? packT(key, params) : baseT(key, params);

  /** Hook listeners by name, with the position of their pack in the load order. */
  interface Listener {
    owner: string;
    pack: number;
    seq: number;
    fn: (...args: never[]) => unknown;
  }
  const listeners: Record<string, Listener[]> = {};
  let listenerSeq = 0;
  /**
   * Every subscription of every pack shares one effect: it runs after each update of the game or of a
   * setting and calls the subscribers in turn. It exists only while somebody is subscribed.
   */
  const subscribers = new Set<{ fn: () => void; owner: string }>();
  let rootStop: (() => void) | null = null;
  function ensureRoot(): void {
    if (rootStop) return;
    let first = true;
    rootStop = $effect.root(() => {
      $effect(() => {
        void game.version;
        void settings.revision;
        // The first run only registers what to follow; subscribers draw themselves when they subscribe.
        if (first) {
          first = false;
          return;
        }
        untrack(() => {
          for (const sub of [...subscribers]) {
            guard.call(sub.owner, 'a subscription', sub.fn, undefined);
          }
        });
      });
    });
  }
  function stopRoot(): void {
    rootStop?.();
    rootStop = null;
  }
  const loadOrder = (packId: string) => registry.packs.indexOf(packId);

  /** Calls the listeners of a hook in pack load order; one that throws costs a warning, once. */
  function emit<K extends keyof HookMap>(
    name: K,
    ...args: Parameters<HookMap[K]>
  ): ReturnType<HookMap[K]>[] {
    const out: ReturnType<HookMap[K]>[] = [];
    for (const l of [...(listeners[name] ?? [])]) {
      const call = l.fn as (...a: unknown[]) => ReturnType<HookMap[K]>;
      out.push(
        guard.call(
          l.owner,
          `the "${name}" hook`,
          () => call(...args),
          undefined as ReturnType<HookMap[K]>,
        ),
      );
    }
    return out;
  }

  // Commands go through the hooks wherever they come from: the pages, the bots, the packs.
  const removeCommandHook = game.addCommandHook({
    before(command) {
      let current = command;
      for (const l of [...(listeners['command:before'] ?? [])]) {
        const before = l.fn as HookMap['command:before'];
        const verdict = guard.call(
          l.owner,
          'the "command:before" hook',
          () => before(current),
          undefined,
        );
        if (verdict === false) return false;
        if (verdict) current = verdict;
      }
      return current === command ? undefined : current;
    },
    after: (command, result) => void emit('command:after', command, result),
  });
  const removeEventListener = game.onEvent((event) => void emit('event', event));

  /**
   * The state as packs see it: one copy per update of the store, shared by every widget and frozen,
   * so that a write to it throws instead of changing what the next reader gets.
   */
  let snap: { version: number; state: core.GameState } | null = null;
  function snapshot(): core.GameState {
    const version = game.version;
    if (snap?.version !== version) snap = { version, state: deepFreeze(game.read((s) => s)) };
    return snap.state;
  }

  function storageOf(packId: string): PackStorage {
    const at = (key: string) => `${STORAGE_PREFIX}${packId}.${key}`;
    return {
      get<T>(key: string): T | undefined {
        try {
          const raw = text?.getItem(at(key)) ?? null;
          return raw === null ? undefined : (JSON.parse(raw) as T);
        } catch {
          return undefined;
        }
      },
      set(key, value) {
        try {
          text?.setItem(at(key), JSON.stringify(value));
        } catch {
          // Storage may be full or blocked; the value then lasts nowhere.
        }
      },
      remove(key) {
        try {
          (text as { removeItem?: (key: string) => void } | null)?.removeItem?.(at(key));
        } catch {
          // Nothing to remove.
        }
      },
    };
  }

  /** The value of a setting: what the player chose, when that still fits, else the default. */
  function settingValue(key: string): boolean | string {
    const entry = registry.setting(key);
    if (!entry) throw new Error(`Unknown setting "${key}"`);
    const stored = settings.ext(key);
    if (entry.kind === 'toggle') return typeof stored === 'boolean' ? stored : entry.default;
    return typeof stored === 'string' && entry.options?.some((o) => o.value === stored)
      ? stored
      : entry.default;
  }

  /** The API of one pack. Subscriptions made through it are added to `scope` so a host can drop them all. */
  function createApi(packId: string, owner: string, scope: Set<() => void> = new Set()): UiApi {
    const storage = storageOf(packId);
    const api: UiApi = {
      on(name, fn) {
        const entry: Listener = {
          owner,
          pack: loadOrder(packId),
          seq: listenerSeq++,
          fn: fn as Listener['fn'],
        };
        const list = (listeners[name] ??= []);
        list.push(entry);
        list.sort((a, b) => a.pack - b.pack || a.seq - b.seq);
        const off = () => {
          const at = list.indexOf(entry);
          if (at >= 0) list.splice(at, 1);
          scope.delete(off);
        };
        scope.add(off);
        return off;
      },
      toast: (text) => toasts.push({ key: 'toast.mod', params: { text } }),
      dom: {
        get root() {
          return hub.root;
        },
        observe(target, mount) {
          const stop = hub.observe(packId, target, mount);
          const off = () => {
            stop();
            scope.delete(off);
          };
          scope.add(off);
          return off;
        },
      },
      read<T>(select?: (state: core.GameState) => T) {
        const state = snapshot();
        return select ? select(state) : (state as unknown as T);
      },
      content: game.content,
      core: corePublic,
      getMod: (key) => core.getMod(snapshot(), key, game.content, game.rules),
      t,
      href: (ref) => hrefFor(ref as EntityRef),
      navigate(route) {
        if (!route.startsWith('#/')) throw new Error(`Not a route: "${route}"`);
        navigate(route);
      },
      dispatch: (command: Command) => game.dispatch(command),
      subscribe(fn) {
        const sub = { fn, owner };
        subscribers.add(sub);
        ensureRoot();
        const off = () => {
          if (!subscribers.delete(sub)) return;
          scope.delete(off);
          if (subscribers.size === 0) stopRoot();
        };
        scope.add(off);
        return off;
      },
      setting: (id) => settingValue(`${packId}:${id}`),
      storage,
    };
    return api;
  }

  /**
   * Runs a widget in `el`. A widget that throws, in setup, in an update or when it is cleaned up,
   * is left out and costs one warning; the rest of the page goes on. Returns the function that stops it.
   */
  function run(entry: Runnable, el: HTMLElement, ctx: unknown): () => void {
    const scope = new Set<() => void>();
    let cleanup: void | (() => void);
    try {
      cleanup = untrack(() =>
        entry.widget(el, createApi(entry.packId, entry.key, scope), ctx as never),
      );
    } catch (error) {
      guard.warn(entry.key, 'setup', error);
      for (const off of [...scope]) off();
      el.replaceChildren();
      return () => {};
    }
    return () => {
      for (const off of [...scope]) off();
      try {
        cleanup?.();
      } catch (error) {
        guard.warn(entry.key, 'cleanup', error);
      }
      el.replaceChildren();
    };
  }

  /** Starts the packs now, in load order; one that throws is switched off as a whole. */
  const stopPacks: (() => void)[] = [];
  for (const pack of packs) {
    if (!pack.start || !registry.packs.includes(pack.id)) continue;
    const scope = new Set<() => void>();
    try {
      const stop = untrack(() => pack.start?.(createApi(pack.id, pack.id, scope)));
      stopPacks.push(() => {
        for (const off of [...scope]) off();
        stop?.();
      });
    } catch (error) {
      for (const off of [...scope]) off();
      registry.disablePack(pack.id, error);
    }
  }

  return {
    registry,
    t,
    hub,
    emit,
    /** Hook listeners, observed elements and scoped subscriptions that are alive (for tests). */
    stats: () => ({
      hooks: Object.values(listeners).reduce((n, l) => n + l.length, 0),
      injected: hub.count(),
      subscriptions: subscribers.size,
    }),
    /** Drops the observers, the subscriptions and the command hook. */
    dispose(): void {
      for (const stop of stopPacks.reverse())
        guard.call('unload', 'stopping a pack', stop, undefined);
      stopPacks.length = 0;
      hub.dispose();
      subscribers.clear();
      stopRoot();
      removeCommandHook();
      removeEventListener();
    },
    createApi: (packId: string, scope?: Set<() => void>) => createApi(packId, packId, scope),
    run,
    settingValue,
    /** Whether a pack removed the nav item with this key; reads settings, so it is reactive. */
    navHidden: (key: string): boolean =>
      registry
        .navRemovals(key)
        .some((r) =>
          r.when
            ? guard.call(
                `${r.packId}:nav`,
                'a nav predicate',
                () => r.when?.(createApi(r.packId, r.packId)) === true,
                false,
              )
            : true,
        ),
    guard,
    setSetting(key: string, value: boolean | string): void {
      const entry = registry.setting(key);
      if (!entry) throw new Error(`Unknown setting "${key}"`);
      settings.setExt(key, value);
    },
    /** The theme to apply now: the chosen one, the base theme when it is unknown, none when there is no base. */
    activeTheme(): ThemeEntry | null {
      return registry.theme(settings.theme) ?? null;
    },
  };
}

export type Ui = ReturnType<typeof createUi>;

const UI_KEY = Symbol('shinobi.ui');

/** Makes the UI of this boot available to the components below. */
export const provideUi = (ui: Ui): void => {
  setContext(UI_KEY, ui);
};

/** The UI of this boot, or null when a component is rendered outside the app (a test mounting one page). */
export const tryUi = (): Ui | null => getContext<Ui | undefined>(UI_KEY) ?? null;

export function useUi(): Ui {
  const ui = tryUi();
  if (!ui) throw new Error('No UI registry: the component is not inside the app');
  return ui;
}

/** The context map that lets a Svelte root mounted by hand (a wrapped page) find the UI of this boot. */
export const uiContext = (ui: Ui): Map<unknown, unknown> => new Map([[UI_KEY, ui]]);
