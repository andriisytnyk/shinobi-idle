import { parseHash, type Route } from './route.ts';

let hash = $state(typeof location === 'undefined' ? '' : location.hash);
/** The hash the app was on before the current one, in this session: tells a sheet whether Back leads to its parent. */
let previous = '';

/**
 * Asked synchronously when the hash has changed, before the page is told: the old page is still on
 * screen. Returns `false` to stay, another hash to go there instead, nothing to go on.
 */
export type BeforeRoute = (from: string, to: string) => string | false | undefined;
let beforeRoute: BeforeRoute | null = null;

/** Sets the guard of the running app; `null` removes it. */
export function setBeforeRoute(guard: BeforeRoute | null): void {
  beforeRoute = guard;
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const to = location.hash;
    if (to === hash) return;
    const verdict = beforeRoute?.(hash, to);
    if (verdict === false || typeof verdict === 'string') {
      // The address bar already shows `to`; put the other hash there without a history entry of its own.
      const target = verdict === false ? hash : verdict;
      history.replaceState(null, '', location.pathname + location.search + target);
      if (verdict === false) return;
      previous = hash;
      hash = target;
      return;
    }
    previous = hash;
    hash = to;
  });
}

/** The current location hash. Reactive. */
export function currentHash(): string {
  return hash;
}

/** The current route, derived from the location hash. Reactive. */
export function currentRoute(): Route {
  return parseHash(hash);
}

/** Navigates by changing the hash. */
export function navigate(target: string): void {
  location.hash = target;
}

/** Moves to `target` without a history entry of its own: the current entry is replaced. */
export function replaceHash(target: string): void {
  if (target === hash) return;
  history.replaceState(null, '', location.pathname + location.search + target);
  hash = target;
}

/**
 * Leaves a sheet for its parent page. When the entry before this one is the parent, that is plain
 * Back (so the history holds no loop); otherwise the sheet's own entry is replaced by the parent.
 */
export function closeTo(parent: string): void {
  if (previous === parent && typeof history !== 'undefined') history.back();
  else replaceHash(parent);
}
