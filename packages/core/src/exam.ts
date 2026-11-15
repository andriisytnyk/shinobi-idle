import type { ContentDb, Exam } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { addItem } from './bank.ts';
import { emit } from './events.ts';
import { MS_PER_SECOND } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { skillLevel } from './requirements.ts';
import { rankIndex } from './vocab.ts';
import type { GameState } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';

/** Name of the action kind that runs a rank exam's timed test. */
export const SENSEI_TEST_KIND = 'senseiTest';

/** The exam that grants `rank`, if the content has one. */
export function examFor(content: ContentDb, rank: string): Exam | undefined {
  return content.exams.find((e) => e.rank === rank);
}

/** Seconds of the sensei test: shorter with the exam's skills, never under the balance floor. */
export function senseiTestSeconds(state: GameState, exam: Exam, content: ContentDb): number {
  const T = content.balance.K.senseiTest;
  const levels = exam.reduceBy.reduce((sum, skill) => sum + skillLevel(state, skill, content), 0);
  return Math.max(T.floor, T.base * (1 - T.perLevel * levels));
}

/**
 * The sensei test: a one-shot progress action with no way to fail. Passing it grants the exam's
 * rank, opens what the rank unlocks, hands out the reward items and pins the goal.
 */
export const senseiTestKind: ActionKind = {
  has: (id, content) => indexOf(content).exams.has(id),
  // Only a player below the exam's rank can take it, and only with the checklist met. An `any`
  // of nothing can never hold, which is how a rank already held blocks the action.
  requirements(state, id, content) {
    const exam = indexOf(content).exams.get(id);
    if (!exam) return null;
    const held = rankIndex(content, state.player.rank) >= rankIndex(content, exam.rank);
    return held ? { t: 'any', of: [] } : exam.checklist;
  },

  intervalMs(state, id, content) {
    const exam = indexOf(content).exams.get(id);
    if (!exam) return 1;
    return Math.max(1, Math.round(senseiTestSeconds(state, exam, content) * MS_PER_SECOND));
  },

  complete(state, id, content) {
    const exam = indexOf(content).exams.get(id);
    if (!exam) return 'stop';
    // Rewards come only with the rank itself, so repeating the exam can never pay twice.
    if (rankIndex(content, exam.rank) <= rankIndex(content, state.player.rank)) return 'stop';
    state.player.rank = exam.rank;
    emit(state, { type: 'rankUp', rank: exam.rank });
    refreshUnlocks(state, content);
    for (const { item, n } of exam.rewards.items) {
      if (addItem(state, item, n)) emit(state, { type: 'itemGained', id: item, n });
    }
    const goal = exam.rewards.goal;
    if (goal) {
      state.goal = { kind: goal.kind, id: goal.id };
      emit(state, { type: 'goalSet', kind: goal.kind, id: goal.id });
    }
    return 'stop';
  },
};
