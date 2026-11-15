import { mount, unmount } from 'svelte';
import type { PageEntry } from './registry.ts';
import { uiContext, type Ui } from './runtime.svelte.ts';
import type { PageContext, UiApi } from './types.ts';

const once = (fn: () => void): (() => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
};

/** Whether a page needs the widget path: a pack replaced it with a widget or wrapped it. */
export const isComposed = (page: PageEntry): boolean =>
  typeof page.mount === 'function' || page.wraps.length > 0;

/**
 * Draws a page into `el` through its mount and the wrappers that packs put around it. The inner
 * page is drawn by the function a wrapper receives; its cleanup runs once, whoever calls it.
 */
export function drawPage(
  ui: Ui,
  page: PageEntry,
  el: HTMLElement,
  api: UiApi,
  ctx: PageContext,
): () => void {
  const scope = new Set<() => void>();
  const base = (target: HTMLElement): (() => void) => {
    const m = page.mount;
    if (typeof m === 'function') {
      const cleanup = m(target, api, ctx);
      return once(() => cleanup?.());
    }
    const app = mount(m.svelte, {
      target,
      props: m.props?.(ctx) ?? {},
      context: uiContext(ui),
    });
    return once(() => void unmount(app));
  };
  let draw = base;
  for (const wrap of page.wraps) {
    const prev = draw;
    const wrapApi = ui.createApi(wrap.packId, scope);
    draw = (target) => {
      let innerCleanup: () => void = () => {};
      const own = wrap.fn(target, wrapApi, (at = target) => (innerCleanup = prev(at)));
      return once(() => {
        try {
          own?.();
        } finally {
          innerCleanup();
        }
      });
    };
  }
  const stop = draw(el);
  return () => {
    for (const off of [...scope]) off();
    stop();
  };
}
