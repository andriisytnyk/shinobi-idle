import { parseHash, type Route } from './route.ts';

let hash = $state(typeof location === 'undefined' ? '' : location.hash);

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    hash = location.hash;
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
