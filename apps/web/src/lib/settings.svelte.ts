import type { Req } from '@shinobi/core';

export interface SettingsData {
  /** Hide the skills that are still shut from the sidebar. */
  hideLocked: boolean;
  /** Show the one-time tutorial hints. */
  hints: boolean;
  /** Ids of hints the player has dismissed. */
  dismissedHints: string[];
  /**
   * The pinned goal. The core has no goal command yet, so it lives here, in the web settings,
   * until `state.goal` and a pin command exist.
   */
  goal: Req | null;
}

export const SETTINGS_KEY = 'shinobi.settings';

const defaults = (): SettingsData => ({
  hideLocked: false,
  hints: true,
  dismissedHints: [],
  goal: null,
});

/** The slice of `localStorage` the settings use. */
export interface TextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const REQ_TYPES = [
  'skill',
  'technique',
  'rank',
  'nature',
  'item',
  'quest',
  'building',
  'flag',
  'all',
  'any',
];

/** Cheap shape check for a stored goal; a bad one is dropped rather than rendered. */
export function isReq(x: unknown): x is Req {
  if (!isRecord(x) || typeof x.t !== 'string' || !REQ_TYPES.includes(x.t)) return false;
  if (x.t === 'all' || x.t === 'any') return Array.isArray(x.of) && x.of.every(isReq);
  return true;
}

/** Reads stored settings, keeping every field that is valid and defaulting the rest. */
export function parseSettings(text: string | null): SettingsData {
  const out = defaults();
  if (text === null) return out;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw)) return out;
    if (typeof raw.hideLocked === 'boolean') out.hideLocked = raw.hideLocked;
    if (typeof raw.hints === 'boolean') out.hints = raw.hints;
    if (Array.isArray(raw.dismissedHints)) {
      out.dismissedHints = raw.dismissedHints.filter((h): h is string => typeof h === 'string');
    }
    if (isReq(raw.goal)) out.goal = raw.goal;
  } catch {
    // A damaged settings blob falls back to the defaults.
  }
  return out;
}

function browserStorage(): TextStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reactive web settings, saved to `storage` on every change. */
export function createSettings(storage: TextStorage | null = browserStorage()) {
  const data = $state<SettingsData>(
    parseSettings(
      (() => {
        try {
          return storage?.getItem(SETTINGS_KEY) ?? null;
        } catch {
          return null;
        }
      })(),
    ),
  );

  const persist = () => {
    try {
      storage?.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      // Storage may be full or blocked; the settings then last for this session only.
    }
  };

  return {
    get hideLocked() {
      return data.hideLocked;
    },
    set hideLocked(value: boolean) {
      data.hideLocked = value;
      persist();
    },
    get hints() {
      return data.hints;
    },
    set hints(value: boolean) {
      data.hints = value;
      persist();
    },
    get goal() {
      return data.goal;
    },
    pinGoal(req: Req) {
      data.goal = req;
      persist();
    },
    unpinGoal() {
      data.goal = null;
      persist();
    },
    /** Whether a hint with this id should still be shown. */
    hintVisible(id: string): boolean {
      return data.hints && !data.dismissedHints.includes(id);
    },
    dismissHint(id: string) {
      if (!data.dismissedHints.includes(id)) data.dismissedHints = [...data.dismissedHints, id];
      persist();
    },
    /** Shows every hint again. */
    resetHints() {
      data.dismissedHints = [];
      persist();
    },
  };
}

export const settings = createSettings();
