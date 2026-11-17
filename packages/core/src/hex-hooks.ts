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
  /** How the player got there; `walk` is the only way now. */
  by: 'walk';
  /** The action slot of the performer that moved: 0 is the character, a shadow clone has its own. */
  slot: number;
}

/**
 * A handler that runs on every hex the player enters, after the sight is refreshed and the
 * `hexEntered` event is queued. Handlers run in the order of `Rules.hexEntered`; the list is empty in
 * the built-in rules and is where later rules and packs hook in (finds along the way, XP per hex,
 * survey progress). A handler may change the state but must not move the player or touch `now`.
 */
export type HexEnteredHook = (
  state: GameState,
  ctx: HexEnteredContext,
  content: ContentDb,
  rules: Rules,
) => void;
