import { content, type NatureId, type SkillId } from '@shinobi/content';
import {
  createState,
  refreshUnlocks,
  setFlag,
  teamFor,
  updateQuests,
  xpAt,
  type GameState,
} from '@shinobi/core';

export interface PlayerOptions {
  /** Owned natures, the native one first. */
  natures?: NatureId[];
  /** Skill levels; every skill not named stays at `base`. */
  levels?: Partial<Record<SkillId, number>>;
  base?: number;
  /** Whether the team exists (it follows the native nature). */
  team?: boolean;
  known?: string[];
  bank?: Record<string, number>;
  /** Whether the rank C missions are open. */
  rankC?: boolean;
  intel?: number;
}

/** A named genin at the levels asked for. */
export function player(opts: PlayerOptions = {}): GameState {
  const state = createState(1, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  const natures = opts.natures ?? [];
  state.player.natures = natures;
  const [native] = natures;
  state.team = native && opts.team !== false ? teamFor(content, native) : null;
  for (const skill of content.skills) {
    state.skills[skill.id]!.xp = xpAt(opts.levels?.[skill.id] ?? opts.base ?? 1);
  }
  for (const id of opts.known ?? []) state.known[id] = true;
  for (const [id, n] of Object.entries(opts.bank ?? {})) state.bank[id] = n;
  if (opts.rankC) {
    setFlag(state, 'missions.c.unlocked');
    setFlag(state, 'missions.mail.unlocked');
  }
  if (opts.intel !== undefined) state.currencies.intel = opts.intel;
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  return state;
}

/** A player who can do every stage of every D and C mission on their own, with the items stocked. */
export function able(extra: PlayerOptions = {}): GameState {
  return player({
    base: 40,
    natures: ['katon'],
    levels: { katon: 50, suiton: 50, doton: 50 },
    known: content.techniques.map((t) => t.id),
    bank: { 'core:antidote': 50, 'core:wire': 50, ...extra.bank },
    rankC: true,
    ...extra,
  });
}
