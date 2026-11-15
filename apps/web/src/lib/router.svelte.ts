import { parseHash, type Route } from './route.ts';

let hash = $state(typeof location === 'undefined' ? '' : location.hash);

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
      hash = target;
      return;
    }
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
