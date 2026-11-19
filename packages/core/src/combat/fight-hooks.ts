import type { ContentDb } from '@shinobi/content';
import { teamSupportHook } from './fight-team.ts';
import type { FightHook, FightRules } from './fight-types.ts';

/*
 * The hooks that belong to the engine itself: what a team mission needs. The behaviour of enemy traits and boss specials is not here: a pack registers it, with
 * the data that names it (the core pack's is in `corepack/fight-hooks.ts`).
 */

/** The hooks of the engine, in the order they are consulted. */
export const engineFightHooks: readonly FightHook[] = [teamSupportHook];

/** An entity of the content names a hook that no pack registers. */
export interface HookProblem {
  /** The pack of the entity: the prefix of its id (`core` for a bare one). */
  pack: string;
  message: string;
}

const packOfId = (id: string): string => (id.includes(':') ? id.slice(0, id.indexOf(':')) : 'core');

/**
 * Checks the hooks the content names (a trait's `hook`, a boss special's `hook`) against the rules
 * that were composed: a name no pack registers is an error that names the pack of the entity.
 * `composeRules` calls it once the packs' rules are composed.
 */
export function validateHooks(content: ContentDb, rules: FightRules): HookProblem[] {
  const known = new Set(rules.fightHooks.map((h) => h.id));
  const problems: HookProblem[] = [];
  for (const t of content.traits) {
    if (t.hook !== undefined && !known.has(t.hook)) {
      problems.push({
        pack: packOfId(t.id),
        message: `traits "${t.id}" names the hook "${t.hook}", which no pack registers`,
      });
    }
  }
  for (const b of content.bosses) {
    if (!known.has(b.special.hook)) {
      problems.push({
        pack: packOfId(b.id),
        message: `bosses "${b.id}" special names the hook "${b.special.hook}", which no pack registers`,
      });
    }
  }
  return problems;
}
