import type { ContentDb, Exam } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { addItem } from './bank.ts';
import { emit } from './events.ts';
import { MS_PER_SECOND } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { evalReq, skillLevel } from './requirements.ts';
import { currencyOf, rankIndex } from './vocab.ts';
import type { GameState } from './state.ts';
import { refreshUnlocks } from './unlocks.ts';

/** Name of the action kind that runs a rank exam's timed test. */
export const SENSEI_TEST_KIND = 'senseiTest';

/** The exam that grants `rank`, if the content has one. */
export function examFor(content: ContentDb, rank: string): Exam | undefined {
  return content.exams.find((e) => e.rank === rank);
}

/** The flag that records that the written test of an exam taken in two parts (`exam.then`) is passed. */
export const examWrittenFlag = (exam: Exam): string => `exam.${exam.id}.written`;

/** Whether the written test of a two-part exam is passed: what remains is `exam.then`. */
export function writtenPassed(state: GameState, exam: Exam): boolean {
  return exam.then !== undefined && state.flags[examWrittenFlag(exam)] !== undefined;
}

/**
 * Seconds of the sensei test: shorter with the exam's skills and, in a two-part exam, with the
 * Intel in hand (up to the balance's cap), never under the balance floor.
 */
export function senseiTestSeconds(state: GameState, exam: Exam, content: ContentDb): number {
  const T = content.balance.K.senseiTest;
  const levels = exam.reduceBy.reduce((sum, skill) => sum + skillLevel(state, skill, content), 0);
  const study = exam.then === undefined ? null : currencyOf(content, 'study');
  const I = content.balance.K.intel;
  const intel = study === null ? 0 : Math.min(I.writtenTestMaxIntel, state.currencies[study] ?? 0);
  return Math.max(
    T.floor,
    T.base * (1 - T.perLevel * levels) * (1 - I.writtenTestPerIntel * intel),
  );
}

/** Seconds the rank is conferred in after the written test: the shortest a test can be. */
export const conferralSeconds = (content: ContentDb): number => content.balance.K.senseiTest.floor;

/**
 * The sensei test: a one-shot progress action with no way to fail. Passing it grants the exam's
 * rank, opens what the rank unlocks, hands out the reward items and pins the goal.
 */
export const senseiTestKind: ActionKind = {
  // The test is the character's: one at a time.
  unique: () => true,
  has: (id, content) => indexOf(content).exams.has(id),
  // Only a player below the exam's rank can take it, and only with the checklist met. An `any`
  // of nothing can never hold, which is how a rank already held blocks the action.
  requirements(state, id, content) {
    const exam = indexOf(content).exams.get(id);
    if (!exam) return null;
    const held = rankIndex(content, state.player.rank) >= rankIndex(content, exam.rank);
    if (held) return { t: 'any', of: [] };
    // After the written test of a two-part exam, what is left of the exam opens the conferral.
    return exam.then !== undefined && writtenPassed(state, exam) ? exam.then : exam.checklist;
  },

  intervalMs(state, id, content) {
    const exam = indexOf(content).exams.get(id);
    if (!exam) return 1;
    const seconds = writtenPassed(state, exam)
      ? conferralSeconds(content)
      : senseiTestSeconds(state, exam, content);
    return Math.max(1, Math.round(seconds * MS_PER_SECOND));
  },

  complete(state, id, content) {
    const exam = indexOf(content).exams.get(id);
    if (!exam) return 'stop';
    // Rewards come only with the rank itself, so repeating the exam can never pay twice.
    if (rankIndex(content, exam.rank) <= rankIndex(content, state.player.rank)) return 'stop';
    // The written test of a two-part exam only opens the rest of it; the rank comes with the next run.
    if (exam.then !== undefined && !writtenPassed(state, exam)) {
      state.flags[examWrittenFlag(exam)] = true;
      emit(state, { type: 'examPassed', exam: exam.id });
      return 'stop';
    }
    // A second slot may have started the same test: the rank needs the whole gate, checked here too.
    if (exam.then !== undefined && !evalReq(state, exam.then, content).met) return 'stop';
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
