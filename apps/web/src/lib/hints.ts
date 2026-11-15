import type { ContentDb, SkillId } from '@shinobi/content';
import { cellLevel, evalReq, examFor, levelAt, skillLevel, type GameState } from '@shinobi/core';

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
      const exam = examFor(content, 'genin');
      return (
        state.player.rank === 'student' &&
        exam !== undefined &&
        evalReq(state, exam.checklist, content).met
      );
    },
  },
  { id: 'graduation', when: (state) => state.player.rank !== 'student' },
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
