import type { ContentDb } from '@shinobi/content';
import { MISSION_KIND, type GameEvent } from '@shinobi/core';
import type { ToastSpec } from './toasts.svelte.ts';

/** The error that stops a mission whose fight was lost too many times in a row. */
const TOO_HARD = 'error.missionTooHard';

/**
 * Items the core granted since the last finished stage, from its `itemGained` events: the payment
 * of a finished mission is paid right after its last stage, and the events come in that order.
 */
let granted: { id: string; n: number }[] = [];

/** Forgets the items seen so far (tests). */
export const resetMissionToasts = (): void => {
  granted = [];
};

/**
 * The toast of a mission event, or `undefined` for an event that is not a mission's (the caller
 * goes on), or `null` for one that stays silent (the player's own stop). Every toast names its
 * mission as a link in front (entity names exist in the nominative only, so the sentence goes on
 * after the name).
 * - a finished stage: its number out of the total; a failed one: a failed roll, or for a fight a
 *   lost fight with the Wound it left, and the stage starts over;
 * - a finished mission: what the core really granted (its events), items as links, and what the
 *   mission pays in kind but the events did not show as granted;
 * - a stop: its cause as a sentence, with the item it concerns as the link.
 */
export function missionToast(event: GameEvent, content: ContentDb): ToastSpec | null | undefined {
  switch (event.type) {
    case 'itemGained':
      granted.push({ id: event.id, n: event.n });
      return undefined;
    case 'missionStage': {
      granted = [];
      const mission = content.missions.find((m) => m.id === event.mission);
      if (!mission) return undefined;
      const stage = mission.stages[event.stage];
      const params = { n: event.stage + 1, total: mission.stages.length };
      const subject = { kind: 'mission', id: mission.id } as const;
      if (event.ok) return { key: 'toast.mission.stageDone', params, subject };
      return {
        key: stage?.t === 'combat' ? 'toast.mission.fightLost' : 'toast.mission.rollFailed',
        params,
        subject,
      };
    }
    case 'missionDone': {
      const items = new Map<string, number>();
      for (const g of granted) items.set(g.id, (items.get(g.id) ?? 0) + g.n);
      granted = [];
      const mission = content.missions.find((m) => m.id === event.mission);
      if (!mission) return undefined;
      // The payment in kind that the events do not show as granted did not reach the bank.
      const missed = mission.pay.flatMap((p) =>
        p.kind === 'item' && (items.get(p.item) ?? 0) < p.n
          ? [{ id: p.item, n: p.n - (items.get(p.item) ?? 0) }]
          : [],
      );
      return {
        key: event.rep > 0 ? 'toast.mission.doneRep' : 'toast.mission.done',
        params: { rep: event.rep },
        subject: { kind: 'mission', id: mission.id },
        gains: {
          ryo: event.ryo,
          items: [...items].map(([id, n]) => ({ id, n })),
          missed,
        },
      };
    }
    case 'actionStopped': {
      if (event.kind !== MISSION_KIND) return undefined;
      if (event.reason === 'manual') return null;
      const subject = { kind: 'mission', id: event.id } as const;
      if (event.reason === 'replaced') {
        return { key: 'toast.mission.stopped.replaced', params: {}, subject };
      }
      if (event.missing) {
        return {
          key: 'toast.mission.stopped.item',
          params: {},
          subject,
          ref: { kind: 'item', id: event.missing },
        };
      }
      if (event.cause === TOO_HARD) {
        return { key: 'toast.mission.stopped.tooHard', params: {}, subject };
      }
      if (event.reason === 'requirements') {
        return { key: 'toast.mission.stopped.requirements', params: {}, subject };
      }
      if (event.reason === 'missing') {
        return { key: 'toast.mission.stopped.missing', params: {}, subject };
      }
      return { key: 'toast.mission.stopped.other', params: {}, subject };
    }
    default:
      return undefined;
  }
}
