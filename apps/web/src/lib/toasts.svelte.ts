import { content } from '@shinobi/content';
import type { GameEvent } from '@shinobi/core';
import { actionRef, masteryRef } from './entities.ts';
import { t, type Params } from './i18n.ts';
import { missionToast } from './mission-toasts.ts';
import type { EntityRef } from './route.ts';

export interface Toast {
  id: number;
  /** Message key; the text ends where the entity link begins. */
  key: string;
  params: Params;
  /** An entity the toast is about, as a link before the text (the sentence goes on after the name). */
  subject?: EntityRef;
  ref?: EntityRef;
  /** What a claimed cache or vault gave: ryo and items, the items as links; `missed` is what was due but not received. */
  gains?: {
    ryo: number;
    items: { id: string; n: number }[];
    missed?: { id: string; n: number }[];
  };
  /**
   * A button on the toast; pressing it runs `run` and closes the toast, unless `run` returns (or
   * resolves to) `false`: then the toast stays so the player can try again.
   */
  action?: { labelKey: string; run: () => void | boolean | Promise<void | boolean> };
  /** Stays until the player closes it or presses the action; never pushed out by newer toasts. */
  persistent?: boolean;
}

export type ToastSpec = Omit<Toast, 'id'>;

/** Maps a core event to the toast that announces it, or null for events that stay silent. */
export function toastFor(event: GameEvent): ToastSpec | null {
  // Missions have their own words for a stage, a finished run and a stop.
  const mission = missionToast(event, content);
  if (mission !== undefined) return mission;
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
    case 'buildingBuilt':
      return {
        key: 'toast.buildingBuilt',
        params: { n: event.level },
        ref: { kind: 'building', id: event.building },
      };
    case 'villageStage':
      return { key: 'toast.villageStage', params: {} };
    case 'storageFull':
      return { key: 'toast.storageFull', params: { name: t(`resource.${event.resource}.name`) } };
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
    push(spec: ToastSpec): void {
      const id = next++;
      list = [...list, { ...spec, id }];
      // Over the limit the oldest ordinary toasts make way; persistent ones stay.
      while (list.length > MAX_TOASTS) {
        const victim = list.findIndex((item) => !item.persistent);
        if (victim === -1) break;
        list = list.filter((_, i) => i !== victim);
      }
      if (!spec.persistent && typeof window !== 'undefined') {
        window.setTimeout(() => dismiss(id), LIFETIME_MS);
      }
    },
    dismiss,
    clear() {
      list = [];
    },
  };
}

export const toasts = createToasts();
