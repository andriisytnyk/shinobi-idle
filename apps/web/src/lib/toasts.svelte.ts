import type { GameEvent } from '@shinobi/core';
import { masteryRef } from './entities.ts';
import type { Params } from './i18n.ts';
import type { EntityRef } from './route.ts';

export interface Toast {
  id: number;
  /** Message key; the text ends where the entity link begins. */
  key: string;
  params: Params;
  ref?: EntityRef;
}

export type ToastSpec = Omit<Toast, 'id'>;

/** Maps a core event to the toast that announces it, or null for events that stay silent. */
export function toastFor(event: GameEvent): ToastSpec | null {
  switch (event.type) {
    case 'levelUp':
      return {
        key: 'toast.levelUp',
        params: { n: event.level },
        ref: { kind: 'skill', id: event.skill },
      };
    case 'masteryUp':
      return { key: 'toast.masteryUp', params: { n: event.level }, ref: masteryRef(event.key) };
    case 'techniqueLearned':
      return {
        key: 'toast.techniqueLearned',
        params: {},
        ref: { kind: 'technique', id: event.id },
      };
    case 'poolCheckpoint':
      return {
        key: 'toast.poolCheckpoint',
        params: { pct: event.pct },
        ref: { kind: 'skill', id: event.skill },
      };
    case 'actionStopped':
      return null;
  }
}

/** Most toasts on screen at once; older ones make way. */
export const MAX_TOASTS = 4;
const LIFETIME_MS = 5000;

export function createToasts() {
  let list = $state<Toast[]>([]);
  let next = 1;

  const dismiss = (id: number) => {
    list = list.filter((t) => t.id !== id);
  };

  return {
    get list() {
      return list;
    },
    push(spec: ToastSpec) {
      const id = next++;
      list = [...list, { ...spec, id }].slice(-MAX_TOASTS);
      if (typeof window !== 'undefined') window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    dismiss,
    clear() {
      list = [];
    },
  };
}

export const toasts = createToasts();
