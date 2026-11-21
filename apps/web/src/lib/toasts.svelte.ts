import type { ContentDb } from '@shinobi/content';
import { GOAL_CAP, type GameEvent } from '@shinobi/core';
import { actionRef, masteryRef } from './entities.ts';
import { t, type Params } from './i18n.ts';
import { missionToast } from './mission-toasts.ts';
import { currencyName, resourceName } from './vocab.ts';
import type { EntityRef } from './route.ts';

export interface Toast {
  id: number;
  /** Message key; the text ends where the entity link begins. */
  key: string;
  params: Params;
  /** An entity the toast is about, as a link before the text (the sentence goes on after the name). */
  subject?: EntityRef;
  ref?: EntityRef;
  /** What a claimed cache, a vault or a finished mission gave: ryo, other currencies and items (the items as links), and the village resource a mission brought. */
  gains?: {
    ryo: number;
    /** Other currencies, by id. */
    currencies?: Record<string, number>;
    items: { id: string; n: number }[];
    /** Skill XP, the skill an entity link. */
    xp?: { skill: string; amount: number } | null;
    /** The skills a finished mission trained, with the expected XP of one run (about, not exact). */
    xpList?: { skill: string; amount: number }[];
    /** Village resource units: `units` earned, `added` to the village, `lost` to a full store, `waiting` for a village that does not exist yet. */
    resource?: { slug: string; units: number; added: number; lost: number; waiting: number };
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
export function toastFor(event: GameEvent, content: ContentDb): ToastSpec | null {
  // Missions have their own words for a stage, a finished run and a stop.
  const mission = missionToast(event, content);
  if (mission !== undefined) return mission;
  switch (event.type) {
    case 'goalRefused':
      return { key: 'toast.goalRefused', params: { n: GOAL_CAP } };
    case 'levelUp':
      return {
        key: 'toast.levelUp',
        params: { n: event.level },
        ref: { kind: 'skill', id: event.skill },
      };
    case 'masteryUp':
      return {
        key: 'toast.masteryUp',
        params: { n: event.level },
        ref: masteryRef(event.key, content),
      };
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
    case 'renownRank':
      return {
        key: 'toast.renownRank',
        params: {
          name: t(`renownRank.${event.rank}.name`),
          reward: t(`renownRank.${event.rank}.reward`),
        },
      };
    case 'examPassed':
      return { key: 'toast.examPassed', params: {}, ref: { kind: 'exam', id: event.exam } };
    case 'itemUsed':
      // A tonic names a skill (or the group of natures), not a technique: the toast links to the tonic.
      if (!content.techniques.some((x) => x.id === event.target)) {
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
      if (event.reason === 'manual' || event.reason === 'dispelled' || event.reason === 'replaced')
        return null;
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
        gains: claimGains(event.poi, content),
      };
    case 'pointFound':
      return {
        key: 'toast.pointFound',
        params: { name: t(`place.${event.place}.name`) },
        gains: {
          ryo: event.reward.ryo,
          currencies: event.reward.currencies,
          items: event.reward.items,
          xp: event.reward.xp,
        },
      };
    case 'wayFound':
      // The small finds of the terrain are many and go quietly into the bank; a rare find of a place is told.
      if (event.place === '') return null;
      return {
        key: 'toast.wayFound',
        params: {},
        gains: { ryo: 0, currencies: event.currencies, items: event.items },
      };
    case 'travelled':
      return {
        key: 'toast.travelled',
        params: {},
        ref: actionRef({ kind: 'walk', id: event.cell }),
      };
    case 'buildingBuilt':
      return {
        key: 'toast.buildingBuilt',
        params: { n: event.level },
        ref: { kind: 'building', id: event.building },
      };
    case 'raidCalled':
      return { key: 'toast.raidCalled', params: { raid: t(`raid.${event.raid}.name`) } };
    case 'raidArrived':
      return { key: 'toast.raidArrived', params: { raid: t(`raid.${event.raid}.name`) } };
    case 'raidOver':
      return {
        key: 'toast.raidOver',
        params: {
          raid: t(`raid.${event.raid}.name`),
          done: event.repelled + event.byVillage,
          breached: event.breached,
        },
      };
    case 'buildingRepaired':
      return {
        key: 'toast.buildingRepaired',
        params: {},
        ref: { kind: 'building', id: event.building },
      };
    case 'villageStage':
      return { key: 'toast.villageStage', params: {} };
    case 'packsChanged':
      // Told by the store, which may have several notices for one event.
      return null;
    case 'ruleDisabled':
      return {
        key: 'toast.ruleDisabled',
        params: { pack: event.pack },
        persistent: true,
      };
    case 'storageFull':
      return { key: 'toast.storageFull', params: { name: resourceName(event.resource) } };
    default:
      return null;
  }
}

/** The params of a refusal for its text: a currency it names is shown by its name, not its id. */
export function refusalParams(result: { params?: Params }): Params {
  const params = { ...(result.params ?? {}) };
  if (typeof params.currency === 'string') params.currency = currencyName(params.currency);
  return params;
}

/** The notices for a save made with other packs than the game has now: one per kind of change. */
export function packsToasts(event: Extract<GameEvent, { type: 'packsChanged' }>): ToastSpec[] {
  const one = (key: string, list: string[]): ToastSpec[] =>
    list.length === 0 ? [] : [{ key, params: { packs: list.join(', ') }, persistent: true }];
  return [
    ...one('toast.packsRemoved', event.removed),
    ...one('toast.packsAdded', event.added),
    ...one(
      'toast.packsUpdated',
      event.updated.map((u) => `${u.id} ${u.from} → ${u.to}`),
    ),
  ];
}

/** What claiming a cache or a vault gives. */
function claimGains(poiId: string, content: ContentDb): NonNullable<Toast['gains']> {
  for (const cell of content.cells) {
    for (const poi of cell.pois) {
      if (poi.id !== poiId) continue;
      if (poi.kind === 'cache') {
        return {
          ryo: poi.ryo,
          currencies: poi.currencies ?? {},
          items: poi.items.map((i) => ({ id: i.item, n: i.n })),
        };
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
