import { untrack } from 'svelte';
import {
  cloneSlots,
  missionInputs,
  missionStartSlot,
  missionStatus,
  type GameState,
  type MissionForecast,
  type MissionStatus,
  type ReqResult,
} from '@shinobi/core';
import type { Mission } from '@shinobi/content';
import {
  missionView,
  rankGroups,
  stageViews,
  type MissionView,
  type StageView,
} from './missions.ts';
import { game } from './store.ts';

/**
 * How the mission screens get their numbers without recounting the whole board on every store
 * update. A forecast depends on almost everything in the state, so it is recomputed when the
 * inputs change: a cheap signature of them (`missionInputs` of core: skill levels, Mastery, rank, team,
 * loadout, buildings, the items the stages take, the armed ration, Intel) is read on every update,
 * and a command (a started mission, a used ration, a bought item) forces a recompute at once.
 * As a safety net for what the signature does not cover, the forecasts are also recomputed once per
 * `SAFETY_EVERY` store updates. Each mission's view is computed when a card or the page first asks
 * for it after the inputs changed, and is shared by everything that asks until they change again.
 */
export const SAFETY_EVERY = 100;

/** Bumped by every command, so that what a command changed shows at once. */
let commands = $state(0);

export const bumpForecasts = (): void => {
  commands++;
};

/** The signature of the inputs now; one computation per store update, shared by every reader. */
const signature = $derived.by(() => {
  void game.version;
  return untrack(() => missionInputs(game.state, game.content, game.rules));
});

/**
 * A value that changes when the forecasts are due. Reading it inside a `$derived` makes that
 * derived re-run on every store update but pass on only when the value changes.
 */
export const forecastRevision = (): string =>
  `${signature}#${commands}#${Math.floor(game.version / SAFETY_EVERY)}`;

/** Follows every command of the game; returns the function that stops following. Call it in an effect. */
export const followCommands = (): (() => void) => game.addCommandHook({ after: bumpForecasts });

let cached: { rev: string; state: GameState | null } = { rev: '', state: null };
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain cache that no view reads
const cache = new Map<string, MissionView>();

/** The view of one mission at the current revision: computed once per revision, for everyone who asks. */
export function viewOf(mission: Mission): MissionView {
  const rev = forecastRevision();
  return untrack(() => {
    const state = game.state;
    if (cached.rev !== rev || cached.state !== state) {
      cache.clear();
      cached = { rev, state };
    }
    let view = cache.get(mission.id);
    if (!view) {
      view = missionView(state, mission, game.content, game.rules);
      cache.set(mission.id, view);
    }
    return view;
  });
}

/**
 * The answer `dispatch` would give to starting a mission now, from core. It follows every store
 * update (the slot rules are cheap); the blocker is the view's, computed at the coarse rate.
 */
export function cardState(mission: Mission, view: MissionView): MissionStatus {
  void game.version;
  return untrack(() =>
    missionStatus(
      game.state,
      mission.id,
      missionStartSlot(game.state, game.content),
      game.content,
      game.rules,
      view.blocker,
    ),
  );
}

/**
 * The answer `dispatch` would give to starting a mission in the clone's slot, from core; null
 * before the player has a clone. A mission with a combat stage is refused there.
 */
export function cloneCardState(mission: Mission, view: MissionView): MissionStatus | null {
  void game.version;
  return untrack(() => {
    const slot = cloneSlots(game.state, game.content)[0]?.slot;
    if (slot === undefined) return null;
    return missionStatus(game.state, mission.id, slot, game.content, game.rules, view.blocker);
  });
}

/** The missions of the list that can be started or are running now (what the filter «лише доступні» keeps). */
export function availableOf(list: Mission[]): Mission[] {
  void game.version;
  return list.filter((m) => {
    const status = cardState(m, viewOf(m));
    return status.runningAt >= 0 || status.startable;
  });
}

/** The stages of a mission as the page draws them, at the coarse rate of the forecast they come from. */
export function stagesOf(mission: Mission, forecast: MissionForecast): StageView[] {
  return untrack(() => stageViews(game.state, mission, forecast, game.content, game.rules));
}

/**
 * What each rank asks to open, from the unlock each mission carries in the data: shown once for
 * the rank when all its missions have the same, evaluated at the coarse rate like the forecasts.
 * A rank whose missions differ shows no gate of its own (each card shows what blocks it).
 */
export function gatesOf(): { rank: string; result: ReqResult | null; open: boolean }[] {
  void forecastRevision();
  return untrack(() =>
    rankGroups(game.content).map((g) => {
      const unlocks = g.missions.map((m) => viewOf(m).unlock);
      const first = unlocks[0] ?? null;
      // A mission may ask for what the rank asks and something more (the mail also asks for a Renown rank):
      // the rank's gate is then what all of them share, and a mission with more shows its own blocker.
      const key = JSON.stringify(first?.req);
      const asks = (u: { req: unknown }): boolean =>
        JSON.stringify(u.req) === key ||
        ((u.req as { t?: string; of?: unknown[] }).t === 'all' &&
          ((u.req as { of: unknown[] }).of ?? []).some((x) => JSON.stringify(x) === key));
      const shared = first !== null && unlocks.every((u) => u !== null && asks(u));
      return {
        rank: g.rank,
        result: shared ? first : null,
        open: shared ? (first?.met ?? true) : unlocks.every((u) => u === null || u.met),
      };
    }),
  );
}
