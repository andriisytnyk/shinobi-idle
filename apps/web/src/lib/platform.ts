import { del, get, set } from 'idb-keyval';
import type { Clock, KeyValue } from './persistence.ts';

/**
 * The browser side of the platform: wall-clock time and IndexedDB. This is the only place in the
 * app that reads the wall clock; the core receives time as plain numbers.
 */
export const wallClock: Clock = { now: () => Date.now() };

export const indexedDbStore: KeyValue = {
  get: async (key) => {
    const value: unknown = await get(key);
    return typeof value === 'string' ? value : undefined;
  },
  set: (key, value) => set(key, value),
  del: (key) => del(key),
};

/** Asks the browser not to evict the save under storage pressure. Best effort; never throws. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
