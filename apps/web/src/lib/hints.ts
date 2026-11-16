import type { ContentDb, SkillId } from '@shinobi/content';
import { isAcademyRank, nextExamRank } from './vocab.ts';
import {
  cellLevel,
  evalReq,
  examFor,
  levelAt,
  skillLevel,
  writtenPassed,
  type GameState,
} from '@shinobi/core';

/** A one-time tutorial hint. Its text is `hint.<id>` and its title `hint.title.<id>`. */
export interface HintDef {
  id: string;
  /**
   * Hints without `when` belong to a page and are shown by that page when it opens. The others
   * are shown by the hint host the moment their condition first holds.
   */
  when?: (state: GameState, content: ContentDb, signals: Signals) => boolean;
}

/** One-off things that happened this session and that no state shows afterwards, by name. */
export type Signals = Readonly<Record<string, true | undefined>>;

/** Every hint, in the order the help page lists them. */
export const HINTS: readonly HintDef[] = [
  { id: 'skillPage' },
  { id: 'goalPanel' },
  { id: 'combat' },
  { id: 'quests' },
  { id: 'rank' },
  { id: 'bank' },
  { id: 'nature' },
  { id: 'herbalism' },
  { id: 'crafting' },
  { id: 'shop' },
  { id: 'world' },
  { id: 'village' },
  { id: 'missions' },
  { id: 'missionPage' },
  {
    id: 'worldKey',
    when: (state, content) => content.cells.some((c) => c.key && cellLevel(state, c, content) >= 1),
  },
  {
    id: 'worldTraining',
    when: (state, content) =>
      content.cells.some((c) =>
        c.pois.some((p) => p.kind === 'training' && state.world.pois[p.id]),
      ),
  },
  { id: 'worldTravel', when: (_state, _content, signals) => signals.travelled === true },
  { id: 'craftStopped', when: (_state, _content, signals) => signals.craftStopped === true },
  { id: 'tonicUsed', when: (state) => Object.keys(state.buffs).length > 0 },
  {
    id: 'levelUp',
    when: (state, content) =>
      (Object.keys(state.skills) as SkillId[]).some((s) => skillLevel(state, s, content) >= 2),
  },
  {
    id: 'mastery',
    when: (state, content) =>
      Object.values(state.mastery).some((m) => levelAt(m.xp, content.balance.K.masteryCap) >= 2),
  },
  {
    id: 'examReady',
    when: (state, content) => {
      const next = nextExamRank(content, state.player.rank);
      const exam = next === null ? undefined : examFor(content, next);
      // The checklist is shown while the first exam waits: later exams have no hint of their own.
      return (
        isAcademyRank(content, state.player.rank) &&
        exam !== undefined &&
        evalReq(state, exam.checklist, content).met
      );
    },
  },
  { id: 'graduation', when: (state, content) => !isAcademyRank(content, state.player.rank) },
  // Turning points of the story: a chain asks for payment, a boss opens, the C rank opens, the second exam.
  {
    id: 'tracking',
    when: (state, content) =>
      content.quests.some((q) => {
        const progress = state.quests[q.id];
        return progress !== undefined && !progress.done && q.steps[progress.step]?.objective.t === 'pay';
      }),
  },
  {
    id: 'boss',
    when: (state, content) =>
      content.zones.some(
        (z) => z.region === 'boss' && z.unlock !== null && evalReq(state, z.unlock, content).met,
      ),
  },
  { id: 'cMissions', when: (state) => state.flags['missions.c.unlocked'] !== undefined },
  {
    id: 'chuninReady',
    when: (state, content) => {
      const next = nextExamRank(content, state.player.rank);
      const exam = next === null ? undefined : examFor(content, next);
      // The first exam has its own hint; a later one is ready when the checklist holds and the written test is still to take.
      return (
        !isAcademyRank(content, state.player.rank) &&
        exam !== undefined &&
        exam.then !== undefined &&
        !writtenPassed(state, exam) &&
        evalReq(state, exam.checklist, content).met
      );
    },
  },
  {
    id: 'examStages',
    when: (state, content) => {
      const next = nextExamRank(content, state.player.rank);
      const exam = next === null ? undefined : examFor(content, next);
      return exam !== undefined && writtenPassed(state, exam);
    },
  },
];

export const hintTextKey = (id: string): string => `hint.${id}`;
export const hintTitleKey = (id: string): string => `hint.title.${id}`;

/** The first state-triggered hint whose condition holds and that the player may still see. */
export function nextStateHint(
  state: GameState,
  content: ContentDb,
  visible: (id: string) => boolean,
  signals: Signals = {},
): HintDef | null {
  for (const hint of HINTS) {
    if (hint.when && visible(hint.id) && hint.when(state, content, signals)) return hint;
  }
  return null;
}
