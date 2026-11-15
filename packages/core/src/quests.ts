import type { ContentDb, Quest, QuestRewards } from '@shinobi/content';
import { addCurrency, addItem } from './bank.ts';
import { counterValue } from './counters.ts';
import { emit } from './events.ts';
import { evalReq, RANK_ORDER } from './requirements.ts';
import type { System } from './system.ts';
import type { GameState } from './state.ts';
import { refreshRegions } from './regions.ts';
import { refreshUnlocks } from './unlocks.ts';
import { syncVillage } from './village.ts';

/** Counter value a step is measured from: its counter right now, or 0 for a requirement step. */
function baselineFor(state: GameState, quest: Quest, step: number): number {
  const objective = quest.steps[step]?.objective;
  return objective?.t === 'counter' ? counterValue(state, objective.counter) : 0;
}

function stepMet(state: GameState, quest: Quest, step: number, content: ContentDb): boolean {
  const progress = state.quests[quest.id];
  const objective = quest.steps[step]?.objective;
  if (!progress || !objective) return false;
  if (objective.t === 'counter') {
    return counterValue(state, objective.counter) - progress.base >= objective.n;
  }
  return evalReq(state, objective.req, content).met;
}

function applyRewards(state: GameState, rewards: QuestRewards, content: ContentDb): void {
  for (const { item, n } of rewards.items) {
    if (addItem(state, item, n)) emit(state, { type: 'itemGained', id: item, n });
  }
  addCurrency(state, 'ryo', rewards.ryo);
  addCurrency(state, 'rep', rewards.rep);
  for (const flag of rewards.flags) state.flags[flag] = true;
  const rank = rewards.rank;
  if (rank && RANK_ORDER.indexOf(rank) > RANK_ORDER.indexOf(state.player.rank)) {
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
      }
    }
  }
}

/** Runs after every other system so a change they made is seen at the moment it happens. */
export const questSystem: System = {
  nextEventIn: () => null,
  run: (state, content) => updateQuests(state, content),
};
