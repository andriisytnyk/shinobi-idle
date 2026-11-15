import type { DomTarget, UiApi } from './types.ts';

/** The CSS selector of a target: a selector as written, or a `data-ui` part with an optional entity. */
export function selectorOf(target: DomTarget): string {
  if (typeof target === 'string') return target;
  const esc = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  let sel = `[data-ui="${esc(target.part)}"]`;
  if (target.kind !== undefined || target.id !== undefined) {
    sel +=
      target.kind !== undefined && target.id !== undefined
        ? `[data-entity="${esc(`${target.kind}:${target.id}`)}"]`
        : target.kind !== undefined
          ? `[data-entity^="${esc(target.kind)}:"]`
          : `[data-entity$=":${esc(target.id ?? '')}"]`;
  }
  return sel;
}

interface Watcher {
  key: string;
  packId: string;
  selector: string;
  mount: (el: HTMLElement, api: UiApi) => void | (() => void);
  /** Matching elements that are mounted, with what undoes each. */
  matched: Map<HTMLElement, () => void>;
}

export interface DomHubDeps {
  /** The API a pack gets for one element; its subscriptions go into `scope`. */
  createApi(packId: string, owner: string, scope: Set<() => void>): UiApi;
  warn(key: string, phase: string, error: unknown): void;
}

/**
 * Finds the elements that packs asked for, now and later, with one MutationObserver on the app
 * root. The observer's callback already batches every change of a task into one call, and each call
 * looks only at the nodes that were added or removed.
 */
export function createDomHub(deps: DomHubDeps) {
  const watchers = new Set<Watcher>();
  let root: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let seq = 0;

  function mountOne(w: Watcher, el: HTMLElement): void {
    const scope = new Set<() => void>();
    let cleanup: void | (() => void);
    try {
      cleanup = w.mount(el, deps.createApi(w.packId, w.key, scope));
    } catch (error) {
      deps.warn(w.key, 'a DOM mount', error);
    }
    w.matched.set(el, () => {
      for (const off of [...scope]) off();
      try {
        cleanup?.();
      } catch (error) {
        deps.warn(w.key, 'a DOM cleanup', error);
      }
    });
  }

  function release(w: Watcher, el: HTMLElement): void {
    const undo = w.matched.get(el);
    w.matched.delete(el);
    undo?.();
  }

  /** Mounts every unmounted match inside `node`, the node itself included. */
  function scan(w: Watcher, node: Element): void {
    if (node instanceof HTMLElement && !w.matched.has(node) && node.matches(w.selector)) {
      mountOne(w, node);
    }
    for (const el of node.querySelectorAll<HTMLElement>(w.selector)) {
      if (!w.matched.has(el)) mountOne(w, el);
    }
  }

  /** Releases the matches that left the page, and, when an attribute changed, those that no longer match. */
  function sweep(w: Watcher, recheck: boolean): void {
    for (const el of [...w.matched.keys()]) {
      if (!el.isConnected || (recheck && !el.matches(w.selector))) release(w, el);
    }
  }

  function flush(records: MutationRecord[]): void {
    // Text going in and out of an element changes nothing about which elements match.
    const gone = records.some((r) => [...r.removedNodes].some((n) => n.nodeType === 1));
    const changed = records.some((r) => r.type === 'attributes');
    for (const w of watchers) {
      if (gone || changed) sweep(w, changed);
      for (const r of records) {
        if (r.type === 'attributes') {
          if (r.target instanceof Element) scan(w, r.target);
        } else {
          for (const node of r.addedNodes) if (node instanceof Element) scan(w, node);
        }
      }
    }
  }

  return {
    get root(): HTMLElement | null {
      return root;
    },
    observe(
      packId: string,
      target: DomTarget,
      mount: (el: HTMLElement, api: UiApi) => void | (() => void),
    ): () => void {
      const w: Watcher = {
        key: `${packId}:dom#${++seq}`,
        packId,
        selector: selectorOf(target),
        mount,
        matched: new Map(),
      };
      watchers.add(w);
      if (root) scan(w, root);
      return () => {
        watchers.delete(w);
        for (const el of [...w.matched.keys()]) release(w, el);
      };
    },
    /** Starts watching `el`, the root of the app. */
    attach(el: HTMLElement): () => void {
      root = el;
      observer = new MutationObserver(flush);
      observer.observe(el, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-ui', 'data-entity'],
      });
      for (const w of watchers) scan(w, el);
      return () => {
        observer?.disconnect();
        observer = null;
        for (const w of watchers) for (const e of [...w.matched.keys()]) release(w, e);
        root = null;
      };
    },
    /** How many elements packs have mounted into right now. */
    count(): number {
      let n = 0;
      for (const w of watchers) n += w.matched.size;
      return n;
    },
    /** Unloads every pack's observers. */
    dispose(): void {
      for (const w of watchers) for (const e of [...w.matched.keys()]) release(w, e);
      watchers.clear();
    },
  };
}
