import { toasts as defaultToasts, type ToastSpec } from './toasts.svelte.ts';
import { game as defaultGame } from './store.ts';

/** What the update logic needs from the game: whether this tab plays, and a way to flush the save. */
export interface PwaGame {
  readonly phase: string;
  readonly saveStatus: string;
  save(): Promise<void>;
}

/** The registration hooks of `virtual:pwa-register`, and the function that applies an update. */
export type RegisterSw = (hooks: {
  onNeedRefresh: () => void;
  onNeedReload: () => void;
  onOfflineReady: () => void;
  onRegisteredSW: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError: (error: unknown) => void;
}) => (reload?: boolean) => Promise<void>;

/** The `beforeinstallprompt` event, which is not in the DOM typings. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaToasts {
  push(spec: ToastSpec): void;
  readonly list: readonly { key: string }[];
}

export interface PwaDeps {
  game?: PwaGame;
  toasts?: PwaToasts;
  /** Registers the service worker; absent where there is none (dev server, tests). */
  register?: RegisterSw | null;
  /** Removes leftover workers and caches; by default only outside the production build. */
  cleanup?: ((win: Window) => Promise<unknown>) | null;
  win?: Window | null;
  /** Whether the browser is iOS Safari, where installing goes through the share sheet. */
  isIos?: boolean;
  /** How long to wait for the new worker to take control before giving up. */
  applyTimeoutMs?: number;
  /** How often to look for a new version while the tab stays open. */
  checkEveryMs?: number;
}

export type UpdateResult = 'applied' | 'blocked' | 'save-failed' | 'busy' | 'none';

export const UPDATE_KEY = 'pwa.updateReady';
const APPLY_TIMEOUT_MS = 10_000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

/** Production only: the service worker is not registered under `pnpm dev` or Vitest. */
const productionRegister: RegisterSw | null = import.meta.env.PROD
  ? (hooks) => {
      // A placeholder until the virtual module has loaded; the real function replaces it.
      let apply: ((reload?: boolean) => Promise<void>) | null = null;
      void import('virtual:pwa-register').then(({ registerSW }) => {
        apply = registerSW({ immediate: true, ...hooks });
      });
      return async (reload) => {
        if (apply) await apply(reload);
      };
    }
  : null;

/**
 * Outside the production build a worker left by an earlier build of the same origin would keep
 * serving the old app. Unregisters every worker and clears every cache; reloads once if the page
 * was controlled by one (after the reload nothing controls it, so there is no loop).
 */
export async function removeServiceWorkers(
  win: Window,
  cacheStorage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches,
): Promise<'none' | 'cleaned' | 'reloaded'> {
  const container = win.navigator.serviceWorker;
  if (!container) return 'none';
  const controlled = Boolean(container.controller);
  const registrations = await container.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
  let cleared = false;
  if (cacheStorage) {
    const keys = await cacheStorage.keys();
    await Promise.all(keys.map((key) => cacheStorage.delete(key)));
    cleared = keys.length > 0;
  }
  if (controlled) {
    win.location.reload();
    return 'reloaded';
  }
  return registrations.length > 0 || cleared ? 'cleaned' : 'none';
}

function detectIos(win: Window | null): boolean {
  if (!win) return false;
  const nav = win.navigator;
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  // iPadOS reports itself as a Mac with a touch screen.
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

export function createPwa(deps: PwaDeps = {}) {
  const game = deps.game ?? defaultGame;
  const toasts = deps.toasts ?? defaultToasts;
  const win = deps.win === undefined ? (typeof window === 'undefined' ? null : window) : deps.win;
  const register = deps.register === undefined ? productionRegister : deps.register;
  const cleanup =
    deps.cleanup === undefined
      ? import.meta.env.PROD
        ? null
        : removeServiceWorkers
      : deps.cleanup;
  const ios = deps.isIos ?? detectIos(win);

  let offlineReady = $state(false);
  let updateAvailable = $state(false);
  let canInstall = $state(false);
  let installed = $state(false);
  let applying = false;
  let reloaded = false;
  let started = false;
  let installEvent: InstallPromptEvent | null = null;
  let updateSw: ((reload?: boolean) => Promise<void>) | null = null;
  let registration: ServiceWorkerRegistration | undefined;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;

  const isStandalone = () => {
    if (!win) return false;
    const standaloneIos = (win.navigator as Navigator & { standalone?: boolean }).standalone;
    return (
      Boolean(win.matchMedia?.('(display-mode: standalone)').matches) || standaloneIos === true
    );
  };

  /** Shows the update toast unless it is already on screen. It stays until the update starts. */
  function offerUpdate(): void {
    if (!updateAvailable || applying) return;
    if (toasts.list.some((toast) => toast.key === UPDATE_KEY)) return;
    toasts.push({
      key: UPDATE_KEY,
      params: {},
      persistent: true,
      // `false` keeps the toast open: the update was refused and the player can try again.
      action: { labelKey: 'pwa.update', run: async () => (await applyUpdate()) === 'applied' },
    });
  }

  async function applyUpdate(): Promise<UpdateResult> {
    if (!updateSw) return 'none';
    if (applying) return 'busy';
    // A tab that does not own the save must not reload under the player's feet.
    if (game.phase === 'blocked') {
      toasts.push({ key: 'pwa.updateBlocked', params: {} });
      return 'blocked';
    }
    applying = true;
    try {
      await game.save();
      // The write may have been refused (another tab holds a newer save) or may have failed.
      if (game.phase === 'blocked' || game.saveStatus === 'error') {
        const blocked = game.phase === 'blocked';
        toasts.push({ key: blocked ? 'pwa.updateBlocked' : 'pwa.updateSaveFailed', params: {} });
        applying = false;
        return blocked ? 'blocked' : 'save-failed';
      }
      // Activates the waiting worker; the page is reloaded once it controls it.
      applyTimer = setTimeout(() => {
        if (reloaded) return;
        applying = false;
        toasts.push({ key: 'pwa.updateStuck', params: {} });
        offerUpdate();
      }, deps.applyTimeoutMs ?? APPLY_TIMEOUT_MS);
      await updateSw(true);
      return 'applied';
    } catch {
      applying = false;
      if (applyTimer) clearTimeout(applyTimer);
      toasts.push({ key: 'pwa.updateStuck', params: {} });
      return 'save-failed';
    }
  }

  async function promptInstall(): Promise<boolean> {
    const event = installEvent;
    if (!event) return false;
    // The event can be used once.
    installEvent = null;
    canInstall = false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') installed = true;
    return outcome === 'accepted';
  }

  /** Looks for a new version and brings back the update toast if the player closed it. */
  function check(): void {
    registration?.update().catch(() => {});
    offerUpdate();
  }

  /** Wires the install events and registers the service worker. Call once from `main.ts`. */
  function init(): void {
    if (started) return;
    started = true;
    installed = isStandalone();
    if (win && cleanup) void cleanup(win).catch(() => {});
    if (win) {
      win.addEventListener('beforeinstallprompt', (event) => {
        // Keep the browser's mini-bar away; the install button is ours.
        event.preventDefault();
        installEvent = event as InstallPromptEvent;
        canInstall = !installed;
      });
      win.addEventListener('appinstalled', () => {
        installed = true;
        canInstall = false;
        installEvent = null;
      });
      const query = win.matchMedia?.('(display-mode: standalone)');
      query?.addEventListener('change', () => {
        installed = isStandalone();
        if (installed) canInstall = false;
      });
    }
    if (!register) return;
    updateSw = register({
      onNeedRefresh: () => {
        updateAvailable = true;
        offerUpdate();
      },
      // The new worker took control. Only the tab where the player pressed «Оновити» reloads (once,
      // after the save was flushed); other tabs keep the version they run until the next visit.
      onNeedReload: () => {
        if (applying && !reloaded) {
          reloaded = true;
          if (applyTimer) clearTimeout(applyTimer);
          win?.location.reload();
        }
      },
      onOfflineReady: () => {
        offlineReady = true;
        toasts.push({ key: 'pwa.offlineReady', params: {} });
      },
      // A later visit: the worker is already active, so the game is already available offline.
      onRegisteredSW: (_url, reg) => {
        registration = reg;
        if (reg?.active && !reg.waiting) offlineReady = true;
        if (reg?.waiting) {
          updateAvailable = true;
          offerUpdate();
        }
      },
      // The game runs without a worker; a failed registration is only logged.
      onRegisterError: (error) => console.warn('Service worker registration failed', error),
    });
    if (win) {
      win.document?.addEventListener('visibilitychange', () => {
        if (win.document.visibilityState === 'visible') check();
      });
      win.setInterval(check, deps.checkEveryMs ?? CHECK_EVERY_MS);
    }
  }

  return {
    get offlineReady() {
      return offlineReady;
    },
    get updateAvailable() {
      return updateAvailable;
    },
    get canInstall() {
      return canInstall;
    },
    get installed() {
      return installed;
    },
    /** iOS Safari has no install prompt; the panel shows the share-sheet instructions. */
    get isIos() {
      return ios;
    },
    init,
    applyUpdate,
    promptInstall,
    /** Looks for a new version now (also runs on tab focus and hourly). */
    check,
  };
}

export type Pwa = ReturnType<typeof createPwa>;

export const pwa = createPwa();
