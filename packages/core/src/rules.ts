import { actionSystem, drillKind, practiceKind, type ActionKind } from './actions.ts';
import { COURSE_KIND, courseKind, obstacleProvider } from './athletics.ts';
import { defaultCombatAi } from './combat/fight-ai.ts';
import { defaultFightHooks } from './combat/fight-hooks.ts';
import type { CombatAi, FightRules } from './combat/fight-types.ts';
import { tonicProvider } from './buffs.ts';
import { checkpointProvider } from './checkpoints.ts';
import { fightKind } from './combat/kind.ts';
import { combatSystem } from './combat/system.ts';
import { senseiTestKind } from './exam.ts';
import { craftKind, gatherKind } from './field.ts';
import { gearProvider } from './gear.ts';
import { meditateKind, meditationProvider } from './meditation.ts';
import type { ModifierProvider } from './modifiers.ts';
import { natureProvider } from './natures.ts';
import { questSystem } from './quests.ts';
import { villageProvider, villageSystem } from './village.ts';
import { EXPLORE_KIND, WALK_KIND, exploreKind, walkKind, worldProvider } from './world.ts';
import type { System } from './system.ts';

/**
 * Everything that defines how a game behaves, as one explicit value. The order of `systems` is
 * the order they run when events coincide. Nothing registers itself: later stages add their
 * system, kinds and providers to `defaultRules` below, in this one place.
 */
export interface Rules extends FightRules {
  systems: readonly System[];
  actionKinds: Readonly<Record<string, ActionKind>>;
  modifierProviders: readonly ModifierProvider[];
  /** Decides what the player does whenever the fight needs a choice. */
  combatAi: CombatAi;
}

export const defaultRules: Rules = {
  systems: [actionSystem, combatSystem, villageSystem, questSystem],
  actionKinds: {
    practice: practiceKind,
    drill: drillKind,
    meditate: meditateKind,
    [COURSE_KIND]: courseKind,
    fight: fightKind,
    gather: gatherKind,
    craft: craftKind,
    senseiTest: senseiTestKind,
    [EXPLORE_KIND]: exploreKind,
    [WALK_KIND]: walkKind,
  },
  modifierProviders: [
    tonicProvider,
    gearProvider,
    checkpointProvider,
    meditationProvider,
    obstacleProvider,
    natureProvider,
    worldProvider,
    villageProvider,
  ],
  combatAi: defaultCombatAi,
  fightHooks: defaultFightHooks,
};
