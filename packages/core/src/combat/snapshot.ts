import type { ContentDb, SkillId } from '@shinobi/content';
import { defeatsKey, killsKey, studiedKey } from '../counters.ts';
import { masteryLevel } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod } from '../modifiers.ts';
import { RANK_ORDER, skillLevel } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import type { Levels, PlayerSnapshot } from './numbers.ts';
import { effectiveLoadout } from './loadout.ts';
import { medicTier } from './pouch.ts';

/** Every skill level of the player. */
export function levelsOf(state: GameState, content: ContentDb): Levels {
  const levels = {} as Record<SkillId, number>;
  for (const skill of content.skills) levels[skill.id] = skillLevel(state, skill.id, content);
  return levels;
}

/**
 * What the player knows of each enemy entry, as trait ids: nothing before the first sight, the
 * openly visible traits once seen, and every trait and the mechanic of a boss once beaten
 * (`special`). The counters and `state.seen` are what the Bingo book will later be read from.
 */
export function knowledgeOf(
  state: GameState,
  content: ContentDb,
  entries: readonly string[],
): Record<string, string[]> {
  const index = indexOf(content);
  const visible: readonly string[] = content.ai.visibleTraits;
  const out: Record<string, string[]> = {};
  for (const id of entries) {
    const entry = index.enemies.get(id) ?? index.bosses.get(id);
    if (!entry) continue;
    // Losing to an enemy teaches as much as beating it: the player has seen it all.
    // Beating an enemy, losing to it or watching a fight with it to the time cap teaches the player
    // all of it, hidden traits and mechanic included. A fight stopped early teaches nothing more
    // than the first sight.
    const beaten =
      (state.counters[killsKey(id)] ?? 0) +
        (state.counters[defeatsKey(id)] ?? 0) +
        (state.counters[studiedKey(id)] ?? 0) >
      0;
    if (beaten) out[id] = [...entry.traits, 'special'];
    else if (state.seen[id]) out[id] = entry.traits.filter((t) => visible.includes(t));
    else out[id] = [];
  }
  return out;
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
    tier: RANK_ORDER.indexOf(state.player.rank),
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
  const cost = (key: string) => computeMod(rules.modifierProviders, state, key, content).total;
  const snapshot = planningSnapshot(state, content);
  snapshot.costMod = { chakra: cost('cost.chakra'), stamina: cost('cost.stamina') };
  snapshot.wounds = state.wounds.stacks;
  snapshot.knowledge = knowledgeOf(state, content, entries);
  // A student fights with everything they know; from Genin the loadout is the player's.
  if (state.player.rank !== 'student') {
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
  snapshot.medic = medicTier(state, content) >= 1 ? state.pouch.medic : null;
  if (pools) Object.assign(snapshot, pools);
  return snapshot;
}
