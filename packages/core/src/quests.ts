import type { ContentDb, Quest, QuestRewards } from '@shinobi/content';
import { addCurrency, addItem, removeCurrency } from './bank.ts';
import { bump, counterValue } from './counters.ts';
import { emit } from './events.ts';
import { evalReq } from './requirements.ts';
import { currencyOf, rankIndex } from './vocab.ts';
import type { System } from './system.ts';
import type { GameState } from './state.ts';
import { syncNaturesGained } from './natures.ts';
import { rewardScroll } from './scrolls.ts';
import { refreshRegions } from './regions.ts';
import { refreshUnlocks } from './unlocks.ts';
import { syncVillage } from './village.ts';

/** Counter that records that the player paid for a `pay` step of a quest. */
export const payKey = (quest: string, step: number): string => `pay.${quest}.${step}`;

/** What a counter objective counts right now: its counter and the others it adds up. */
function counted(
  state: GameState,
  objective: { counter: string; also?: string[] | undefined },
): number {
  let total = counterValue(state, objective.counter);
  for (const key of objective.also ?? []) total += counterValue(state, key);
  return total;
}

/** Counter value a step is measured from: its counter right now, or 0 for any other step. */
function baselineFor(state: GameState, quest: Quest, step: number): number {
  const objective = quest.steps[step]?.objective;
  return objective?.t === 'counter' && !objective.total ? counted(state, objective) : 0;
}

function stepMet(state: GameState, quest: Quest, step: number, content: ContentDb): boolean {
  const progress = state.quests[quest.id];
  const objective = quest.steps[step]?.objective;
  if (!progress || !objective) return false;
  if (objective.t === 'counter') return counted(state, objective) - progress.base >= objective.n;
  if (objective.t === 'pay') return counterValue(state, payKey(quest.id, step)) >= 1;
  return evalReq(state, objective.req, content).met;
}

/** Raises the flags the steps up to and including `step` open; a flag is never taken back. */
function raiseOpens(state: GameState, quest: Quest, step: number): void {
  for (let i = 0; i <= step && i < quest.steps.length; i++) {
    for (const flag of quest.steps[i]?.opens ?? []) state.flags[flag] ??= true;
  }
}

/**
 * Pays for the active step of a chain when its objective is a payment: the currency with the
 * objective's role is spent and the step counts as done at the next update.
 */
export function payStep(
  state: GameState,
  questId: unknown,
  content: ContentDb,
): { ok: true } | { ok: false; reason: string } {
  const quest =
    typeof questId === 'string' ? content.quests.find((q) => q.id === questId) : undefined;
  const progress = quest ? state.quests[quest.id] : undefined;
  if (!quest || !progress || progress.done) return { ok: false, reason: 'error.questNotActive' };
  const objective = quest.steps[progress.step]?.objective;
  if (objective?.t !== 'pay') return { ok: false, reason: 'error.questNoPayment' };
  const currency = currencyOf(content, objective.role);
  if (currency === null || !removeCurrency(state, currency, objective.n)) {
    return { ok: false, reason: 'error.questCannotPay' };
  }
  bump(state, payKey(quest.id, progress.step));
  return { ok: true };
}

function applyRewards(state: GameState, rewards: QuestRewards, content: ContentDb): void {
  for (const { item, n } of rewards.items) {
    if (addItem(state, item, n)) emit(state, { type: 'itemGained', id: item, n });
  }
  if (rewards.scroll) {
    const scroll = rewardScroll(state, rewards.scroll.library, content);
    if (scroll && addItem(state, scroll, 1)) emit(state, { type: 'itemGained', id: scroll, n: 1 });
  }
  const money = currencyOf(content, 'money');
  const reputation = currencyOf(content, 'renown');
  if (money !== null) addCurrency(state, money, rewards.ryo);
  if (reputation !== null) addCurrency(state, reputation, rewards.rep);
  for (const [currency, n] of Object.entries(rewards.currencies ?? {})) {
    addCurrency(state, currency, n);
  }
  for (const flag of rewards.flags) state.flags[flag] = true;
  if (rewards.goal) {
    state.goal = { kind: rewards.goal.kind, id: rewards.goal.id };
    emit(state, { type: 'goalSet', kind: rewards.goal.kind, id: rewards.goal.id });
  }
  const rank = rewards.rank;
  if (rank && rankIndex(content, rank) > rankIndex(content, state.player.rank)) {
    state.player.rank = rank;
    emit(state, { type: 'rankUp', rank });
    refreshUnlocks(state, content);
  }
}

/**
 * Starts the chains whose unlock holds and finishes every step whose objective is met, cascading
 * until nothing changes. Counter objectives count only from the moment their step became active.
 * Emits `questStep` for each finished step and `questDone` when the last one falls.
 */
export function updateQuests(state: GameState, content: ContentDb): void {
  // A new Genin gets a village and Reputation may open its second stage; a quest may ask for either.
  syncVillage(state, content);
  // Saves from before the counter existed keep the natures their character already has.
  syncNaturesGained(state);
  // Region flags first: a step may ask for an open region.
  refreshRegions(state, content);
  for (let changed = true; changed;) {
    changed = false;
    for (const quest of content.quests) {
      let progress = state.quests[quest.id];
      if (!progress) {
        if (quest.unlock && !evalReq(state, quest.unlock, content).met) continue;
        progress = { step: 0, base: baselineFor(state, quest, 0), done: false };
        state.quests[quest.id] = progress;
        changed = true;
      }
      // A chain under way keeps what its active step opens raised, also in a save made before the step existed.
      if (!progress.done) raiseOpens(state, quest, progress.step);
      if (progress.done || !stepMet(state, quest, progress.step, content)) continue;
      progress.step++;
      emit(state, { type: 'questStep', quest: quest.id, step: progress.step });
      changed = true;
      if (progress.step >= quest.steps.length) {
        progress.done = true;
        progress.base = 0;
        emit(state, { type: 'questDone', quest: quest.id });
        applyRewards(state, quest.rewards, content);
      } else {
        progress.base = baselineFor(state, quest, progress.step);
        raiseOpens(state, quest, progress.step);
      }
    }
  }
}

/** Runs after every other system so a change they made is seen at the moment it happens. */
export const questSystem: System = {
  nextEventIn: () => null,
  run: (state, content) => updateQuests(state, content),
};
