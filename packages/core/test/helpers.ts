import { content } from '@shinobi/content';
import {
  createState,
  defaultRules,
  gearProvider,
  teamFor,
  tonicProvider,
  xpAt,
  type GameState,
  type Rules,
} from '../src/index.ts';
import type { NatureId, SkillId } from '@shinobi/content';

export const HOUR = 3_600_000;

/** A genin, so the Academy slowdown stays out of the way. */
export function genin(seed = 1): GameState {
  const state = createState(seed, content);
  state.player.rank = 'genin';
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
