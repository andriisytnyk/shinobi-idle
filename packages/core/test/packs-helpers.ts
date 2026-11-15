/** A game composed with the `testmod` pack: the content, the rules and states to play on. */
import { composeContent, content as coreContent, corePack } from '@shinobi/content';
import {
  composeRules,
  createState,
  defaultRules,
  syncVillage,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { testmodPack } from '../src/testmod/index.ts';

export const HOUR = 3_600_000;

export const packs = [corePack, testmodPack];
/** The content of the core pack and the test pack. */
export const modContent = composeContent(packs);
/** The rules of the core pack and the test pack, composed. */
export const modRules = composeRules(defaultRules, packs, modContent);
/** The built-in content and its rules, for the games without the mod. */
export const plainContent = coreContent;
export const plainRules = composeRules(defaultRules, [corePack], coreContent);

/** A fresh state of the game with the mod, as a Genin with the starting village. */
export function modGenin(seed = 1): GameState {
  const state = createState(seed, modContent);
  state.player.rank = 'genin';
  syncVillage(state, modContent);
  return state;
}

/** A fresh state of the core game as a Genin with the starting village. */
export function plainGenin(seed = 1): GameState {
  const state = createState(seed, plainContent);
  state.player.rank = 'genin';
  syncVillage(state, plainContent);
  return state;
}

export function setSkill(state: GameState, skill: string, level: number): void {
  state.skills[skill] = { xp: xpAt(level) };
}

/** The core data that a save without the pack must keep, whatever the pack did: the state without the pack bookkeeping. */
export function withoutPackData(text: string): unknown {
  const parsed = JSON.parse(text) as { state: Record<string, unknown> };
  const { packs: _p, dormant: _d, rankOrder: _r, ...rest } = parsed.state;
  void _p;
  void _d;
  void _r;
  return rest;
}
