import type { ContentDb } from '@shinobi/content';
import { MISSION_KIND, type GameEvent } from '@shinobi/core';
import type { ToastSpec } from './toasts.svelte.ts';

/** The error that stops a mission whose fight was lost too many times in a row. */
const TOO_HARD = 'error.missionTooHard';

/**
 * The toast of a mission event, or `undefined` for an event that is not a mission's (the caller
 * goes on), or `null` for one that stays silent (the player's own stop).
 * - a finished stage: its number out of the total; a failed one: a failed roll, or for a fight a
 *   lost fight with the Wound it left, and the stage starts over;
 * - a finished mission: what it paid, items as links;
 * - a stop: its cause as a sentence, with the item or mission it concerns as the link.
 */
export function missionToast(event: GameEvent, content: ContentDb): ToastSpec | null | undefined {
  switch (event.type) {
    case 'missionStage': {
      const mission = content.missions.find((m) => m.id === event.mission);
      if (!mission) return undefined;
      const stage = mission.stages[event.stage];
      const params = { n: event.stage + 1, total: mission.stages.length };
      const ref = { kind: 'mission', id: mission.id } as const;
      if (event.ok) return { key: 'toast.mission.stageDone', params, ref };
      return {
        key: stage?.t === 'combat' ? 'toast.mission.fightLost' : 'toast.mission.rollFailed',
        params,
        ref,
      };
    }
    case 'missionDone': {
      const mission = content.missions.find((m) => m.id === event.mission);
      if (!mission) return undefined;
      return {
        key: event.rep > 0 ? 'toast.mission.doneRep' : 'toast.mission.done',
        params: { rep: event.rep },
        ref: { kind: 'mission', id: mission.id },
        gains: {
          ryo: event.ryo,
          items: mission.pay.flatMap((p) => (p.kind === 'item' ? [{ id: p.item, n: p.n }] : [])),
        },
      };
    }
    case 'actionStopped': {
      if (event.kind !== MISSION_KIND) return undefined;
      if (event.reason === 'manual') return null;
      const ref = { kind: 'mission', id: event.id } as const;
      if (event.reason === 'replaced')
        return { key: 'toast.mission.stopped.replaced', params: {}, ref };
      if (event.missing) {
        return {
          key: 'toast.mission.stopped.item',
          params: {},
          ref: { kind: 'item', id: event.missing },
        };
      }
      if (event.cause === TOO_HARD)
        return { key: 'toast.mission.stopped.tooHard', params: {}, ref };
      if (event.reason === 'requirements') {
        return { key: 'toast.mission.stopped.requirements', params: {}, ref };
      }
      if (event.reason === 'missing')
        return { key: 'toast.mission.stopped.missing', params: {}, ref };
      return { key: 'toast.mission.stopped.other', params: {}, ref };
    }
    default:
      return undefined;
  }
}
