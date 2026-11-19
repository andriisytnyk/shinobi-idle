import type { ContentDb } from '@shinobi/content';
import { MISSION_KIND, type GameEvent } from '@shinobi/core';
import type { ToastSpec } from './toasts.svelte.ts';
import { currencyOf } from './vocab.ts';

/** The error that stops a mission whose fight was lost too many times in a row. */
const TOO_HARD = 'error.missionTooHard';

/**
 * The toast of a mission event, or `undefined` for an event that is not a mission's (the caller
 * goes on), or `null` for one that stays silent (the player's own stop). Every toast names its
 * mission as a link in front (entity names exist in the nominative only, so the sentence goes on
 * after the name).
 * - a finished stage: its number out of the total; a failed one: a failed roll, or for a fight a
 *   lost fight with the Wound it left, and the stage starts over;
 * - a finished mission: what the core really granted, read from the event alone: the money, the
 *   other currencies (Intel and any a pack pays), the items as links, and the village resource,
 *   with the units a full store lost said so;
 * - a stop: its cause as a sentence, with the item it concerns as the link.
 */
export function missionToast(event: GameEvent, content: ContentDb): ToastSpec | null | undefined {
  switch (event.type) {
    case 'missionStage': {
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
      const mission = content.missions.find((m) => m.id === event.mission);
      if (!mission) return undefined;
      // The money and Reputation have a place of their own (the field and the sentence); the rest is listed.
      const money = currencyOf(content, 'money');
      const renown = currencyOf(content, 'renown');
      const currencies: Record<string, number> = {};
      for (const c of event.currencies) {
        if (c.currency !== money && c.currency !== renown) currencies[c.currency] = c.n;
      }
      return {
        key: event.rep > 0 ? 'toast.mission.doneRep' : 'toast.mission.done',
        params: { rep: event.rep },
        subject: { kind: 'mission', id: mission.id },
        gains: {
          ryo: event.ryo,
          currencies,
          items: event.items.map((i) => ({ id: i.id, n: i.n })),
          resource: event.resource ?? undefined,
        },
      };
    }
    case 'actionStopped': {
      if (event.kind !== MISSION_KIND) return undefined;
      if (event.reason === 'manual' || event.reason === 'dispelled') return null;
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
