import type { ContentDb } from '@shinobi/content';
import { computeMod, type ModResult } from './modifiers.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** The modifier total and breakdown for `key` under the given rule set. */
export function getMod(
  state: GameState,
  key: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): ModResult {
  return computeMod(rules.modifierProviders, state, key, content);
}
