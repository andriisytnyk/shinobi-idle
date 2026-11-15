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
}) => (reload?: boolean) => Promise<void>;

/** The `beforeinstallprompt` event, which is not in the DOM typings. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaDeps {
  game?: PwaGame;
  toasts?: { push(spec: ToastSpec): void };
  /** Registers the service worker; absent where there is none (dev server, tests). */
  register?: RegisterSw | null;
  win?: Window | null;
  /** Whether the browser is iOS Safari, where installing goes through the share sheet. */
  isIos?: boolean;
}

export type UpdateResult = 'applied' | 'blocked' | 'save-failed' | 'busy' | 'none';

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

  const isStandalone = () => {
    if (!win) return false;
    const standaloneIos = (win.navigator as Navigator & { standalone?: boolean }).standalone;
    return (
      Boolean(win.matchMedia?.('(display-mode: standalone)').matches) || standaloneIos === true
    );
  };

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
        toasts.push({
          key: game.phase === 'blocked' ? 'pwa.updateBlocked' : 'pwa.updateSaveFailed',
          params: {},
        });
        applying = false;
        return game.phase === 'blocked' ? 'blocked' : 'save-failed';
      }
      // Activates the waiting worker; the library reloads the page once it controls it.
      await updateSw(true);
      return 'applied';
    } catch {
      applying = false;
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

  /** Wires the install events and registers the service worker. Call once from `main.ts`. */
  function init(): void {
    if (started) return;
    started = true;
    installed = isStandalone();
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
        if (updateAvailable) return;
        updateAvailable = true;
        toasts.push({
          key: 'pwa.updateReady',
          params: {},
          persistent: true,
          action: { labelKey: 'pwa.update', run: () => void applyUpdate() },
        });
      },
      // The new worker took control. Only the tab where the player pressed «Оновити» reloads (once,
      // after the save was flushed); other tabs keep the version they run until the next visit.
      onNeedReload: () => {
        if (applying && !reloaded) {
          reloaded = true;
          win?.location.reload();
        }
      },
      onOfflineReady: () => {
        offlineReady = true;
        toasts.push({ key: 'pwa.offlineReady', params: {} });
      },
      // A later visit: the worker is already active, so the game is already available offline.
      onRegisteredSW: (_url, registration) => {
        if (registration?.active && !registration.waiting) offlineReady = true;
      },
    });
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
  };
}

export type Pwa = ReturnType<typeof createPwa>;

export const pwa = createPwa();
