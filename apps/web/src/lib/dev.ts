/** Developer tools show only when the page address carries `?dev=1`. */
export function isDevMode(
  search: string = typeof location === 'undefined' ? '' : location.search,
): boolean {
  try {
    return new URLSearchParams(search).get('dev') === '1';
  } catch {
    return false;
  }
}

/** Game time steps the developer panel offers: the label's localization key and the span in ms. */
export const DEV_STEPS = [
  { key: 'dev.min1', ms: 60_000 },
  { key: 'dev.min10', ms: 600_000 },
  { key: 'dev.hour1', ms: 3_600_000 },
] as const;
