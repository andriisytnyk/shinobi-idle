import { content } from '@shinobi/content';
import type { GameEvent } from '@shinobi/core';
import { actionRef, masteryRef } from './entities.ts';
import type { Params } from './i18n.ts';
import type { EntityRef } from './route.ts';

export interface Toast {
  id: number;
  /** Message key; the text ends where the entity link begins. */
  key: string;
  params: Params;
  ref?: EntityRef;
  /** What a claimed cache or vault gave: ryo and items, the items as links. */
  gains?: { ryo: number; items: { id: string; n: number }[] };
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
    case 'questStep':
      return { key: 'toast.questStep', params: {}, ref: { kind: 'quest', id: event.quest } };
    case 'questDone':
      return { key: 'toast.questDone', params: {}, ref: { kind: 'quest', id: event.quest } };
    case 'itemUsed':
      // A tonic names a skill (or the group of natures), not a technique: the toast links to the tonic.
      if (!event.target.startsWith('core:')) {
        return { key: 'toast.tonicUsed', params: {}, ref: { kind: 'item', id: event.id } };
      }
      return {
        key: 'toast.itemUsed',
        params: {},
        ref: { kind: 'technique', id: event.target },
      };
    case 'natureGained':
      return { key: 'toast.natureGained', params: {}, ref: { kind: 'skill', id: event.nature } };
    case 'actionStopped':
      // The player's own stop and a replacement by another action need no announcement.
      if (event.reason === 'manual' || event.reason === 'replaced') return null;
      // A craft that ran out of an ingredient names it, as a link.
      if (event.missing) {
        return {
          key: 'toast.stopped.ingredient',
          params: {},
          ref: { kind: 'item', id: event.missing },
        };
      }
      return {
        key: `toast.stopped.${event.reason}`,
        params: {},
        ref: actionRef(event),
      };
    case 'regionOpened':
      return { key: 'toast.regionOpened', params: {}, ref: { kind: 'region', id: event.region } };
    case 'cellLevelUp':
      return {
        key: event.max ? 'toast.cellMax' : 'toast.cellLevelUp',
        params: { n: event.level, intel: content.balance.K.intel.perCellLevel },
        ref: { kind: 'cell', id: event.cell },
      };
    case 'poiFound':
      return { key: 'toast.poiFound', params: {}, ref: { kind: 'poi', id: event.poi } };
    case 'poiClaimed':
      return {
        key: 'toast.poiClaimed',
        params: {},
        ref: { kind: 'poi', id: event.poi },
        gains: claimGains(event.poi),
      };
    case 'travelled':
      return { key: 'toast.travelled', params: {}, ref: { kind: 'cell', id: event.cell } };
    default:
      return null;
  }
}

/** What claiming a cache or a vault gives. */
function claimGains(poiId: string): { ryo: number; items: { id: string; n: number }[] } {
  for (const cell of content.cells) {
    for (const poi of cell.pois) {
      if (poi.id !== poiId) continue;
      if (poi.kind === 'cache') {
        return { ryo: poi.ryo, items: poi.items.map((i) => ({ id: i.item, n: i.n })) };
      }
      if (poi.kind === 'vault') return { ryo: 0, items: [{ id: poi.item, n: 1 }] };
    }
  }
  return { ryo: 0, items: [] };
}

/** Most toasts on screen at once; older ones make way. */
export const MAX_TOASTS = 6;
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
