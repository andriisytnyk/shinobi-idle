import { teamSupportHook } from './fight-team.ts';
import type { FightHook } from './fight-types.ts';
import { needOf } from './units.ts';

/*
 * The hooks that belong to the engine itself: what a technique effect kind or a team mission
 * needs. The behaviour of enemy traits and boss specials is not here: a pack registers it, with
 * the data that names it (the core pack's is in `corepack/fight-hooks.ts`).
 */

/** The id of the hook of the technique effect that negates one hit every so often. */
export const PASSIVE_NEGATE_HOOK = 'passiveNegate';

/** The technique effect that negates one hit every so often and needs no slot: a timer of the player. */
const passiveNegate: FightHook = {
  id: PASSIVE_NEGATE_HOOK,
  init(ctx, c) {
    const tech = ctx.fight.kit.techniques.find((t) => t.fx.kind === 'passiveNegate');
    if (tech) c.timers.negate = { progress: 0, need: needOf(tech.fx.everyMs) };
  },
  onTimer(_ctx, c, name) {
    if (name === 'negate' && c.decoys < 1) c.decoys = 1;
  },
};

/** The hooks of the engine, in the order they are consulted. */
export const engineFightHooks: readonly FightHook[] = [teamSupportHook, passiveNegate];
