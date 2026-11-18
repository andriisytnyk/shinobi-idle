/**
 * The developer panel exists in builds made with the flag `__DEV_PANEL__` (dev server, tests and
 * `pnpm --filter @shinobi/web build:test`); in those it opens only when the page address carries
 * `?dev=1`. A production build has no panel at all.
 */
export function isDevMode(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  if (!__DEV_PANEL__) return false;
  try {
    return new URLSearchParams(search).get('dev') === '1';
  } catch {
    return false;
  }
}
