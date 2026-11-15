import {
  actionSystem,
  drillKind,
  meditateKind,
  obstacleKind,
  practiceKind,
  type ActionKind,
} from './actions.ts';
import { defaultCombatAi } from './combat/fight-ai.ts';
import type { CombatAi, FightRules } from './combat/fight-types.ts';
import { fightKind } from './combat/kind.ts';
import { combatSystem } from './combat/system.ts';
import { senseiTestKind } from './exam.ts';
import type { ModifierProvider } from './modifiers.ts';
import { questSystem } from './quests.ts';
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
  systems: [actionSystem, combatSystem, questSystem],
  actionKinds: {
    practice: practiceKind,
    drill: drillKind,
    meditate: meditateKind,
    obstacle: obstacleKind,
    fight: fightKind,
    senseiTest: senseiTestKind,
  },
  modifierProviders: [],
  combatAi: defaultCombatAi,
};
