import { content } from '@shinobi/content';
import {
  createState,
  defaultRules,
  gearProvider,
  poiFlag,
  refreshRegions,
  syncVillage,
  teamFor,
  tonicProvider,
  xpAt,
  zoneCellOf,
  type GameState,
  type Rules,
} from '../src/index.ts';
import type { NatureId, SkillId } from '@shinobi/content';

export const HOUR = 3_600_000;

/** Opens the regions and explores every cell that holds a fight zone to level 1, as a played game would have. */
export function openWorld(state: GameState): void {
  // The region flags follow from rank and Scouting (a save recomputes them), so the Scouting level is raised to open every region.
  const top = Math.max(...content.regions.map((r) => r.scout));
  if (state.skills.scout!.xp < xpAt(top)) state.skills.scout!.xp = xpAt(top);
  refreshRegions(state, content, true);
  // The Forest of Death zones belong to the exam chain, which raises their flag.
  state.flags['region.exam.unlocked'] = true;
  for (const zone of content.zones) {
    const cell = zoneCellOf(zone.id, content);
    if (cell) {
      state.world.explores[cell] = Math.max(
        state.world.explores[cell] ?? 0,
        content.balance.K.cellExplores[0] ?? 1,
      );
      // Level 1 finds the points of the cell, as exploring would have.
      for (const poi of content.cells.find((c) => c.id === cell)?.pois ?? []) {
        state.world.pois[poi.id] = true;
        state.flags[poiFlag(poi.id)] = true;
      }
    }
  }
}

/** A genin with the starting village, so the Academy slowdown stays out of the way. */
export function genin(seed = 1): GameState {
  const state = createState(seed, content);
  state.player.rank = 'genin';
  syncVillage(state, content);
  return state;
}

/** Puts the player on the hex of a cell (short id or full id), without walking. */
export function teleport(state: GameState, cell: string): void {
  state.world.location = cell.includes(':') ? cell : `core:${cell}`;
}

/** Sets building levels of a genin's village directly, for tests that need a shop or a bonus open. */
export function withBuildings(state: GameState, levels: Record<string, number>): GameState {
  if (!state.village) throw new Error('no village');
  Object.assign(state.village.levels, levels);
  return state;
}

/** A genin who can fight in any zone: the regions are open and the zone cells explored. */
export function fightingGenin(seed = 1): GameState {
  const state = genin(seed);
  openWorld(state);
  return state;
}

/** Gives a state the natures in order (the first is the native one), with the team's natures that follow. */
export function withNatures(state: GameState, ...natures: NatureId[]): GameState {
  state.player.natures = natures;
  const [native] = natures;
  state.team = native ? teamFor(content, native) : null;
  return state;
}

export function setLevel(state: GameState, skill: SkillId, level: number): void {
  state.skills[skill]!.xp = xpAt(level);
}

export function start(kind: string, id: string, slot = 0) {
  return { type: 'action.start', slot, kind, id } as const;
}

/** The default rules without pool checkpoints, Meditation and obstacles: the plain economy, for tests that count raw cycles. */
export const plainRules: Rules = {
  ...defaultRules,
  modifierProviders: [tonicProvider, gearProvider],
};
