import type { ContentDb } from '@shinobi/content';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** What a hook that runs when the player enters a hex is told. */
export interface HexEnteredContext {
  /** The key of the hex entered. */
  hex: string;
  q: number;
  r: number;
  terrain: string;
  /** How the performer got there: `walk` one step of a walk (or of the auto-survey), `paid` a trip paid for, `outpost` a free trip between outposts. */
  by: 'walk' | 'paid' | 'outpost';
  /** The action slot of the performer that moved: 0 is the character, a shadow clone has its own. */
  slot: number;
}

/**
 * A handler that runs on every hex the player enters, after the sight is refreshed and the
 * `hexEntered` event is queued. Handlers run in the order of `Rules.hexEntered`; the built-in rules
 * hold the one that pays the walk (XP per hex, finds of the terrain and rare finds, see `finds.ts`)
 * and packs add their own after it. A handler may change the state but must not move a performer
 * or touch `now`: the engine puts every position back after a handler that moved one.
 */
export type HexEnteredHook = (
  state: GameState,
  ctx: HexEnteredContext,
  content: ContentDb,
  rules: Rules,
) => void;
