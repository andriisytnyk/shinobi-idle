const origins = new WeakMap<object, string>();

/** The pack a rule entry (a system, an action kind, a modifier provider, a fight hook) was added by; undefined for the core pack's and the engine's. */
export const originOf = (entry: object): string | undefined => origins.get(entry);

/** Records the pack an entry came from. */
export function tagOrigin<T extends object>(entry: T, pack: string): T {
  origins.set(entry, pack);
  return entry;
}
