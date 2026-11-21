// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PwaPanel from '../src/components/PwaPanel.svelte';
import ToastHost from '../src/components/ToastHost.svelte';
import {
  createPwa,
  removeServiceWorkers,
  serviceWorkerMode,
  type PwaGame,
  type RegisterSw,
} from '../src/lib/pwa.svelte.ts';
import { createToasts, toasts } from '../src/lib/toasts.svelte.ts';

type Hooks = Parameters<RegisterSw>[0];
type FakeDoc = EventTarget & { visibilityState: string };

/** A fake window: events, a document, `display-mode` and `reload`, nothing else. */
function fakeWin(standalone = false, userAgent = 'Chrome') {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  win.navigator = { userAgent, platform: 'Win32', maxTouchPoints: 0 };
  win.matchMedia = () => ({
    matches: standalone,
    addEventListener: () => {},
  });
  win.location = { reload: vi.fn() };
  const doc = new EventTarget() as FakeDoc;
  doc.visibilityState = 'hidden';
  win.document = doc;
  win.setInterval = vi.fn(() => 1);
  return win as unknown as Window & { location: { reload: ReturnType<typeof vi.fn> } };
}

function setup(
  options: {
    phase?: string;
    saveStatus?: string;
    standalone?: boolean;
    ua?: string;
    toasts?: ReturnType<typeof createToasts>;
    applyTimeoutMs?: number;
  } = {},
) {
  const order: string[] = [];
  const game: PwaGame & { phase: string; saveStatus: string } = {
    phase: options.phase ?? 'playing',
    saveStatus: options.saveStatus ?? 'saved',
    save: vi.fn(async () => {
      order.push('save');
    }),
  };
  let hooks!: Hooks;
  const updateSw = vi.fn(async () => {
    order.push('skipWaiting');
  });
  const register: RegisterSw = (h) => {
    hooks = h;
    return updateSw;
  };
  const sink = options.toasts ?? createToasts();
  const win = fakeWin(options.standalone, options.ua);
  const pwa = createPwa({
    game,
    toasts: sink,
    register,
    cleanup: null,
    applyTimeoutMs: options.applyTimeoutMs,
    win,
    isIos: options.ua?.includes('iPhone'),
  });
  pwa.init();
  return { pwa, game, hooks: () => hooks, updateSw, sink, win, order };
}

const docOf = (win: Window) => win.document as unknown as FakeDoc;

describe('pwa state', () => {
  it('flags a waiting worker and shows one persistent toast with an action', () => {
    const { pwa, hooks, sink } = setup();
    expect(pwa.updateAvailable).toBe(false);
    hooks().onNeedRefresh();
    hooks().onNeedRefresh();
    expect(pwa.updateAvailable).toBe(true);
    expect(sink.list).toHaveLength(1);
    expect(sink.list[0]).toMatchObject({
      key: 'pwa.updateReady',
      persistent: true,
      action: { labelKey: 'pwa.update' },
    });
  });

  it('announces offline readiness with an ordinary toast', () => {
    const { pwa, hooks, sink } = setup();
    hooks().onOfflineReady();
    expect(pwa.offlineReady).toBe(true);
    expect(sink.list[0]).toMatchObject({ key: 'pwa.offlineReady' });
    expect(sink.list[0]?.persistent).toBeUndefined();
  });

  it('flushes the save before skipWaiting and reloads once', async () => {
    const { pwa, hooks, game, order, win } = setup();
    hooks().onNeedRefresh();
    expect(await pwa.applyUpdate()).toBe('applied');
    expect(game.save).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['save', 'skipWaiting']);
    // The new worker takes control: one reload, however many times the event arrives.
    hooks().onNeedReload();
    hooks().onNeedReload();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(await pwa.applyUpdate()).toBe('busy');
  });

  it('does not reload a tab that does not own the save', async () => {
    const { pwa, hooks, game, updateSw, sink, win } = setup({ phase: 'blocked' });
    hooks().onNeedRefresh();
    expect(await pwa.applyUpdate()).toBe('blocked');
    expect(game.save).not.toHaveBeenCalled();
    expect(updateSw).not.toHaveBeenCalled();
    expect(sink.list.map((x) => x.key)).toContain('pwa.updateBlocked');
    hooks().onNeedReload();
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('keeps the old version when the save could not be written', async () => {
    const { pwa, hooks, updateSw, sink } = setup({ saveStatus: 'error' });
    hooks().onNeedRefresh();
    expect(await pwa.applyUpdate()).toBe('save-failed');
    expect(updateSw).not.toHaveBeenCalled();
    expect(sink.list.map((x) => x.key)).toContain('pwa.updateSaveFailed');
  });

  it('a tab that did not press the button never reloads', () => {
    const { hooks, win } = setup();
    hooks().onNeedRefresh();
    hooks().onNeedReload();
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('offers installation after beforeinstallprompt and runs the prompt once', async () => {
    const { pwa, win } = setup();
    expect(pwa.canInstall).toBe(false);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(pwa.canInstall).toBe(true);
    expect(await pwa.promptInstall()).toBe(true);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(pwa.canInstall).toBe(false);
    expect(pwa.installed).toBe(true);
    expect(await pwa.promptInstall()).toBe(false);
  });

  it('knows it is installed in standalone mode and after appinstalled', () => {
    expect(setup({ standalone: true }).pwa.installed).toBe(true);
    const { pwa, win } = setup();
    expect(pwa.installed).toBe(false);
    win.dispatchEvent(new Event('appinstalled'));
    expect(pwa.installed).toBe(true);
  });

  it('registers nothing without a registrar (dev server, tests)', () => {
    const pwa = createPwa({
      game: { phase: 'playing', saveStatus: 'idle', save: async () => {} },
      toasts: createToasts(),
      register: null,
      cleanup: null,
      win: fakeWin(),
    });
    pwa.init();
    expect(pwa.updateAvailable).toBe(false);
  });

  it('only logs a failed registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { hooks } = setup();
    expect(() => hooks().onRegisterError(new Error('x'))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('PwaPanel', () => {
  let target: HTMLElement;
  let app: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.append(target);
  });
  afterEach(() => {
    if (app) unmount(app);
    app = null;
    target.remove();
  });

  const show = (source: ReturnType<typeof createPwa>) => {
    app = mount(PwaPanel, { target, props: { source } });
    flushSync();
  };

  const blocks = [
    '[data-pwa-install]',
    '[data-pwa-ios]',
    '[data-pwa-installed]',
    '[data-pwa-offline]',
    '[data-pwa-update]',
    '[data-pwa-apply]',
  ];
  /** Exactly the listed blocks are on screen. */
  const onlyShown = (...wanted: string[]) => {
    for (const selector of blocks) {
      expect(target.querySelector(selector) !== null, selector).toBe(wanted.includes(selector));
    }
  };

  it('shows nothing but the version in a plain browser', () => {
    show(setup().pwa);
    onlyShown();
  });

  it('always shows the version stamp', () => {
    show(setup().pwa);
    expect(target.querySelector('[data-pwa-version]')?.textContent).toMatch(/Версія .+ збірка від/);
  });

  it('shows the install button when the browser allows installing', () => {
    const { pwa, win } = setup();
    show(pwa);
    onlyShown();
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    win.dispatchEvent(event);
    flushSync();
    const button = target.querySelector<HTMLButtonElement>('[data-pwa-install]');
    expect(button?.textContent?.trim()).toBe('Встановити');
    onlyShown('[data-pwa-install]');
    button?.click();
    expect(event.prompt).toHaveBeenCalled();
  });

  it('says the game is installed in standalone mode', () => {
    show(setup({ standalone: true }).pwa);
    onlyShown('[data-pwa-installed]');
  });

  it('gives the share-sheet instructions on iOS', () => {
    show(setup({ ua: 'iPhone Safari' }).pwa);
    expect(target.querySelector('[data-pwa-ios]')?.textContent).toContain('Поділитися');
    onlyShown('[data-pwa-ios]');
  });

  it('shows offline readiness', () => {
    const { pwa, hooks } = setup();
    show(pwa);
    onlyShown();
    hooks().onOfflineReady();
    flushSync();
    onlyShown('[data-pwa-offline]');
  });

  it('shows the update button and applies the update', async () => {
    const { pwa, hooks, game } = setup();
    show(pwa);
    onlyShown();
    hooks().onNeedRefresh();
    flushSync();
    onlyShown('[data-pwa-update]', '[data-pwa-apply]');
    target.querySelector<HTMLButtonElement>('[data-pwa-apply]')?.click();
    await Promise.resolve();
    expect(game.save).toHaveBeenCalled();
  });
});

describe('toast action button', () => {
  let target: HTMLElement;
  let app: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    toasts.clear();
    target = document.createElement('div');
    document.body.append(target);
  });
  afterEach(() => {
    if (app) unmount(app);
    app = null;
    target.remove();
    toasts.clear();
  });

  it('runs the action on press and closes the toast', async () => {
    const run = vi.fn();
    toasts.push({
      key: 'pwa.updateReady',
      params: {},
      persistent: true,
      action: { labelKey: 'pwa.update', run },
    });
    app = mount(ToastHost, { target });
    flushSync();
    expect(target.textContent).toContain('Є оновлення — перезавантажити');
    const button = target.querySelector<HTMLButtonElement>('[data-toast-action]');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.textContent?.trim()).toBe('Перезавантажити');
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(run).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[data-toast]')).toBeNull();
  });

  it('keeps a persistent toast when newer ones push past the limit', () => {
    toasts.push({ key: 'pwa.updateReady', params: {}, persistent: true });
    for (let i = 0; i < 10; i++) toasts.push({ key: 'toast.storageFull', params: { name: 'x' } });
    expect(toasts.list.some((x) => x.persistent)).toBe(true);
    app = mount(ToastHost, { target });
    flushSync();
    expect(target.querySelector('[data-toast="pwa.updateReady"]')).not.toBeNull();
  });
});

describe('update toast lifecycle', () => {
  let target: HTMLElement;
  let app: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    toasts.clear();
    target = document.createElement('div');
    document.body.append(target);
  });
  afterEach(() => {
    if (app) unmount(app);
    app = null;
    target.remove();
    toasts.clear();
    vi.useRealTimers();
  });

  const updateToasts = () => target.querySelectorAll('[data-toast="pwa.updateReady"]').length;
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  };

  it('keeps the toast after a refused update and closes it once the update starts', async () => {
    const { hooks, game, updateSw } = setup({ toasts, saveStatus: 'error' });
    app = mount(ToastHost, { target });
    hooks().onNeedRefresh();
    flushSync();
    expect(updateToasts()).toBe(1);
    const press = async () => {
      target.querySelector<HTMLButtonElement>('[data-toast-action]')?.click();
      await settle();
    };
    await press();
    expect(updateSw).not.toHaveBeenCalled();
    expect(updateToasts()).toBe(1);
    game.saveStatus = 'saved';
    await press();
    expect(updateSw).toHaveBeenCalledTimes(1);
    expect(updateToasts()).toBe(0);
  });

  it('brings a closed toast back when the tab becomes visible, once', () => {
    const { hooks, win } = setup({ toasts });
    app = mount(ToastHost, { target });
    hooks().onNeedRefresh();
    flushSync();
    const doc = docOf(win);
    toasts.dismiss(toasts.list[0]!.id);
    flushSync();
    expect(updateToasts()).toBe(0);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    flushSync();
    expect(updateToasts()).toBe(1);
    doc.dispatchEvent(new Event('visibilitychange'));
    flushSync();
    expect(updateToasts()).toBe(1);
  });

  it('does not offer an update that is not there', () => {
    const { win, sink } = setup();
    const doc = docOf(win);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sink.list).toHaveLength(0);
  });

  it('gives up waiting for the new worker, says so and offers the update again', async () => {
    vi.useFakeTimers();
    const { pwa, hooks, sink } = setup({ applyTimeoutMs: 1000 });
    hooks().onNeedRefresh();
    await pwa.applyUpdate();
    // The toast of the first offer was closed by the successful press.
    sink.dismiss(sink.list[0]!.id);
    vi.advanceTimersByTime(1001);
    expect(sink.list.map((x) => x.key)).toEqual(['pwa.updateStuck', 'pwa.updateReady']);
    expect(await pwa.applyUpdate()).toBe('applied');
  });

  it('moves focus to the update button, but not out of a text field', () => {
    const { hooks } = setup({ toasts });
    app = mount(ToastHost, { target });
    hooks().onNeedRefresh();
    flushSync();
    expect(document.activeElement?.getAttribute('data-toast-action')).not.toBeNull();
    expect(target.querySelector('[data-toast="pwa.updateReady"]')?.getAttribute('role')).toBe(
      'alert',
    );
    toasts.clear();
    flushSync();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    toasts.push({
      key: 'pwa.updateReady',
      params: {},
      persistent: true,
      action: { labelKey: 'pwa.update', run: () => {} },
    });
    flushSync();
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

describe('removeServiceWorkers', () => {
  const fake = (controller: object | null, registrations: number, cacheKeys: string[]) => {
    const unregister = vi.fn(async () => true);
    const win = {
      navigator: {
        serviceWorker: {
          controller,
          getRegistrations: async () =>
            Array.from({ length: registrations }, () => ({ unregister })),
        },
      },
      location: { reload: vi.fn() },
    } as unknown as Window;
    const del = vi.fn(async () => true);
    const cacheStorage = { keys: async () => cacheKeys, delete: del } as unknown as CacheStorage;
    return { win, cacheStorage, unregister, del };
  };

  it('unregisters every worker, clears every cache and reloads once when controlled', async () => {
    const { win, cacheStorage, unregister, del } = fake({}, 2, ['a', 'b']);
    expect(await removeServiceWorkers(win, cacheStorage)).toBe('reloaded');
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledTimes(2);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('cleans without a reload when nothing controls the page', async () => {
    const { win, cacheStorage, del } = fake(null, 1, ['a']);
    expect(await removeServiceWorkers(win, cacheStorage)).toBe('cleaned');
    expect(del).toHaveBeenCalledTimes(1);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('does nothing on a clean origin, so there is no reload loop', async () => {
    const { win, cacheStorage } = fake(null, 0, []);
    expect(await removeServiceWorkers(win, cacheStorage)).toBe('none');
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('does nothing where service workers do not exist', async () => {
    const win = { navigator: {}, location: { reload: vi.fn() } } as unknown as Window;
    expect(await removeServiceWorkers(win, undefined)).toBe('none');
  });
});

describe('the service worker by build', () => {
  it('registers only in the production build; test builds and the dev server remove old workers', () => {
    expect(serviceWorkerMode(true, false)).toBe('register');
    expect(serviceWorkerMode(true, true)).toBe('remove');
    expect(serviceWorkerMode(false, true)).toBe('remove');
    expect(serviceWorkerMode(false, false)).toBe('remove');
  });
});
