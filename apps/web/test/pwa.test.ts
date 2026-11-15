// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PwaPanel from '../src/components/PwaPanel.svelte';
import ToastHost from '../src/components/ToastHost.svelte';
import { createPwa, type PwaGame, type RegisterSw } from '../src/lib/pwa.svelte.ts';
import { createToasts, toasts } from '../src/lib/toasts.svelte.ts';

type Hooks = Parameters<RegisterSw>[0];

/** A fake window: events, `display-mode` and `reload`, nothing else. */
function fakeWin(standalone = false, userAgent = 'Chrome') {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  win.navigator = { userAgent, platform: 'Win32', maxTouchPoints: 0 };
  win.matchMedia = () => ({
    matches: standalone,
    addEventListener: () => {},
  });
  win.location = { reload: vi.fn() };
  return win as unknown as Window & { location: { reload: ReturnType<typeof vi.fn> } };
}

function setup(
  options: { phase?: string; saveStatus?: string; standalone?: boolean; ua?: string } = {},
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
  const sink = createToasts();
  const win = fakeWin(options.standalone, options.ua);
  const pwa = createPwa({
    game,
    toasts: sink,
    register,
    win,
    isIos: options.ua?.includes('iPhone'),
  });
  pwa.init();
  return { pwa, game, hooks: () => hooks, updateSw, sink, win, order };
}

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
      win: fakeWin(),
    });
    pwa.init();
    expect(pwa.updateAvailable).toBe(false);
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

  it('always shows the version stamp', () => {
    show(setup().pwa);
    expect(target.querySelector('[data-pwa-version]')?.textContent).toMatch(/Версія .+ збірка від/);
  });

  it('shows the install button when the browser allows installing', async () => {
    const { pwa, win } = setup();
    show(pwa);
    expect(target.querySelector('[data-pwa-install]')).toBeNull();
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    win.dispatchEvent(event);
    flushSync();
    const button = target.querySelector<HTMLButtonElement>('[data-pwa-install]');
    expect(button?.textContent?.trim()).toBe('Встановити');
    button?.click();
    expect(event.prompt).toHaveBeenCalled();
  });

  it('says the game is installed in standalone mode', () => {
    show(setup({ standalone: true }).pwa);
    expect(target.querySelector('[data-pwa-installed]')).not.toBeNull();
    expect(target.querySelector('[data-pwa-install]')).toBeNull();
  });

  it('gives the share-sheet instructions on iOS', () => {
    show(setup({ ua: 'iPhone Safari' }).pwa);
    expect(target.querySelector('[data-pwa-ios]')?.textContent).toContain('Поділитися');
    expect(target.querySelector('[data-pwa-install]')).toBeNull();
  });

  it('shows offline readiness', () => {
    const { pwa, hooks } = setup();
    show(pwa);
    expect(target.querySelector('[data-pwa-offline]')).toBeNull();
    hooks().onOfflineReady();
    flushSync();
    expect(target.querySelector('[data-pwa-offline]')).not.toBeNull();
  });

  it('shows the update button and applies the update', async () => {
    const { pwa, hooks, game } = setup();
    show(pwa);
    hooks().onNeedRefresh();
    flushSync();
    expect(target.querySelector('[data-pwa-update]')).not.toBeNull();
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

  it('runs the action on press and closes the toast', () => {
    const run = vi.fn();
    toasts.push({
      key: 'pwa.updateReady',
      params: {},
      persistent: true,
      action: { labelKey: 'pwa.update', run },
    });
    app = mount(ToastHost, { target });
    flushSync();
    expect(target.textContent).toContain('Доступна нова версія гри');
    const button = target.querySelector<HTMLButtonElement>('[data-toast-action]');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.textContent?.trim()).toBe('Оновити');
    button?.click();
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
