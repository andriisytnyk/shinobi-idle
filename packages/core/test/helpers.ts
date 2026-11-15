import { content } from '@shinobi/content';
import {
  createState,
  defaultRules,
  gearProvider,
  syncVillage,
  teamFor,
  tonicProvider,
  xpAt,
  type GameState,
  type Rules,
} from '../src/index.ts';
import type { NatureId, SkillId } from '@shinobi/content';

export const HOUR = 3_600_000;

/** A genin with the starting village, so the Academy slowdown stays out of the way. */
export function genin(seed = 1): GameState {
  const state = createState(seed, content);
  state.player.rank = 'genin';
  syncVillage(state, content);
  return state;
}

/** Sets building levels of a genin's village directly, for tests that need a shop or a bonus open. */
export function withBuildings(state: GameState, levels: Record<string, number>): GameState {
  if (!state.village) throw new Error('no village');
  Object.assign(state.village.levels, levels);
  return state;
}

/** Gives a state the natures in order (the first is the native one), with the team's natures that follow. */
export function withNatures(state: GameState, ...natures: NatureId[]): GameState {
  state.player.natures = natures;
  const [native] = natures;
  state.team = native ? teamFor(native) : null;
  return state;
}

export function setLevel(state: GameState, skill: SkillId, level: number): void {
  state.skills[skill].xp = xpAt(level);
}

export function start(kind: string, id: string, slot = 0) {
  return { type: 'action.start', slot, kind, id } as const;
}

/** The default rules without pool checkpoints, Meditation and obstacles: the plain economy, for tests that count raw cycles. */
export const plainRules: Rules = {
  ...defaultRules,
  modifierProviders: [tonicProvider, gearProvider],
};
