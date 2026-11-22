import type { ContentDb, TargetPriority } from '@shinobi/content';

/*
 * The target priorities (`content.targetPriorities`): which enemy the player's side attacks first.
 * The rule of each setting is data (`TargetPriority.rule`); the AI reads the rule from its view
 * (`FightView.priority`). This file only finds the setting a loadout asks for.
 */

/** The setting a fight uses when none is chosen or the chosen one is gone. */
export const defaultTargetPriority = (content: ContentDb): TargetPriority | undefined =>
  content.targetPriorities.find((r) => r.default === true);

/** The setting `id` names; the default one for none, or for one the content does not have (a mod that is gone). */
export function targetPriorityOf(
  content: ContentDb,
  id: string | null | undefined,
): TargetPriority | undefined {
  const own = id ? content.targetPriorities.find((r) => r.id === id) : undefined;
  return own ?? defaultTargetPriority(content);
}
