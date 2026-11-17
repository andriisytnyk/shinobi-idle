import type { ContentDb, SkillId } from '@shinobi/content';
import { masteryLevel } from '../formulas.ts';
import { computeMods } from '../modifiers.ts';
import { skillLevel } from '../requirements.ts';
import { isAcademyRank, rankIndex } from '../vocab.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { Levels, PlayerSnapshot } from './numbers.ts';
import { bingoLevel, knowledgeOf } from './bingo.ts';
import { effectiveLoadout } from './loadout.ts';
import { medicTier } from './pouch.ts';

/** Every skill level of the player. */
export function levelsOf(state: GameState, content: ContentDb): Levels {
  const levels = {} as Record<SkillId, number>;
  for (const skill of content.skills) levels[skill.id] = skillLevel(state, skill.id, content);
  return levels;
}

/** The numbers every part of the player's planning reads: levels, masteries, techniques, natures, rank. Costs are not modified. */
export function planningSnapshot(state: GameState, content: ContentDb): PlayerSnapshot {
  const known: string[] = [];
  const mastery: Record<string, number> = {};
  for (const tech of content.techniques) {
    if (!state.known[tech.id] || tech.rank === null) continue;
    known.push(tech.id);
    mastery[tech.id] = masteryLevel(state, tech.id, content);
  }
  return {
    levels: levelsOf(state, content),
    mastery,
    known,
    natures: [...state.player.natures],
    tier: rankIndex(content, state.player.rank),
    costMod: { chakra: 1, stamina: 1 },
  };
}

/**
 * The one place the game state is turned into what a fight needs: levels, masteries, known
 * techniques, natures, cost modifiers, the loadout, the signature, the pouch, the Wounds and what
 * the player knows about the enemies of the fight (`entries`). `pools` carries health and pools
 * between fights.
 */
export function snapshotPlayer(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  pools?: { hp: number; chakra: number; stamina: number },
  entries: readonly string[] = [],
): PlayerSnapshot {
  const snapshot = planningSnapshot(state, content);
  const [chakra, stamina, evasion] = computeMods(
    rules,
    state,
    ['cost.chakra', 'cost.stamina', 'evasion'],
    content,
  );
  snapshot.costMod = { chakra: chakra?.total ?? 1, stamina: stamina?.total ?? 1 };
  snapshot.evasionMod = evasion?.total ?? 1;
  snapshot.knowledgeLevel = Object.fromEntries(
    entries.map((id) => [id, bingoLevel(state, id, content)]),
  );
  snapshot.wounds = state.wounds.stacks;
  snapshot.knowledge = knowledgeOf(state, content, entries);
  // A student fights with everything they know; from Genin the loadout is the player's.
  if (!isAcademyRank(content, state.player.rank)) {
    const active = effectiveLoadout(state, content);
    snapshot.loadout = active;
    const sig = state.loadouts.signature;
    if (
      sig !== null &&
      active.includes(sig) &&
      (snapshot.mastery[sig] ?? 1) >= content.balance.K.signature.minMastery
    ) {
      snapshot.signature = sig;
    }
  }
  snapshot.pouch = state.pouch.slots.map((s) => ({ id: s.id, n: s.n }));
  // The medic pouch works only while it is owned.
  snapshot.medic =
    state.pouch.medic !== null && medicTier(state, content) >= 1 ? state.pouch.medic : null;
  if (pools) Object.assign(snapshot, pools);
  return snapshot;
}
