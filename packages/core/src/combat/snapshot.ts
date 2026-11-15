import type { ContentDb, SkillId } from '@shinobi/content';
import { masteryLevel } from '../formulas.ts';
import { computeMod } from '../modifiers.ts';
import { skillLevel } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { Levels, PlayerSnapshot } from './numbers.ts';

/** Every skill level of the player. */
export function levelsOf(state: GameState, content: ContentDb): Levels {
  const levels = {} as Record<SkillId, number>;
  for (const skill of content.skills) levels[skill.id] = skillLevel(state, skill.id, content);
  return levels;
}

/**
 * The one place the game state is turned into what a fight needs: levels, masteries, known
 * techniques, natures and cost modifiers. `pools` carries health and pools between fights.
 */
export function snapshotPlayer(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  pools?: { hp: number; chakra: number; stamina: number },
): PlayerSnapshot {
  const known: string[] = [];
  const mastery: Record<string, number> = {};
  for (const tech of content.techniques) {
    if (!state.known[tech.id] || tech.rank === null) continue;
    known.push(tech.id);
    mastery[tech.id] = masteryLevel(state, tech.id, content);
  }
  const cost = (key: string) => computeMod(rules.modifierProviders, state, key, content).total;
  const snapshot: PlayerSnapshot = {
    levels: levelsOf(state, content),
    mastery,
    known,
    natures: [...state.player.natures],
    costMod: { chakra: cost('cost.chakra'), stamina: cost('cost.stamina') },
  };
  if (pools) Object.assign(snapshot, pools);
  return snapshot;
}
