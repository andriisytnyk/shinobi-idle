import { untrack } from 'svelte';
import type { GameState, MissionForecast, ReqResult } from '@shinobi/core';
import type { Mission } from '@shinobi/content';
import {
  inputsSignature,
  missionState,
  missionView,
  rankGroups,
  rankUnlock,
  stageViews,
  type MissionState,
  type MissionView,
  type StageView,
} from './missions.ts';
import { game } from './store.ts';

/**
 * How the mission screens get their numbers without recounting the whole board on every store
 * update. A forecast depends on almost everything in the state, so it is recomputed when the
 * inputs change: a cheap signature of them (`inputsSignature`: skill levels, Mastery, rank, team,
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
  return untrack(() => inputsSignature(game.state, game.content));
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

/** How a mission stands now: startable, blocked and why, or running. It follows every store update (the slot rules are cheap); the blocker comes from the view. */
export function cardState(mission: Mission, blocker: MissionView['blocker']): MissionState {
  void game.version;
  return untrack(() => missionState(game.state, mission, blocker, game.content, game.rules));
}

/** The missions of the list that can be started or are running now (what the filter «лише доступні» keeps). */
export function availableOf(list: Mission[]): Mission[] {
  void game.version;
  return list.filter((m) => {
    const blocker = viewOf(m).blocker;
    return (
      untrack(() => missionState(game.state, m, blocker, game.content, game.rules)).kind !==
      'blocked'
    );
  });
}

/** The stages of a mission as the page draws them, at the coarse rate of the forecast they come from. */
export function stagesOf(mission: Mission, forecast: MissionForecast): StageView[] {
  return untrack(() => stageViews(game.state, mission, forecast, game.content, game.rules));
}

/** What each rank asks to open, evaluated at the coarse rate like the forecasts. */
export function gatesOf(): { rank: string; result: ReqResult | null; open: boolean }[] {
  void forecastRevision();
  return untrack(() =>
    rankGroups(game.content).map((g) => ({
      rank: g.rank,
      ...rankUnlock(game.state, g.rank, game.content),
    })),
  );
}
