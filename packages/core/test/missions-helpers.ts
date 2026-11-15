import { content, NATURE_IDS, type Mission, type NatureId, type SkillId } from '@shinobi/content';
import {
  advance,
  createState,
  dispatch,
  refreshUnlocks,
  setFlag,
  teamFor,
  updateQuests,
  xpAt,
  type GameState,
} from '../src/index.ts';

export const mission = (id: string): Mission => {
  const found = content.missions.find((m) => m.id === id);
  if (!found) throw new Error(`no mission ${id}`);
  return found;
};

export const BOARD = content.missions.filter((m) => m.rank !== 'OP');
export const DC = BOARD.filter((m) => m.rank === 'D' || m.rank === 'C');
export const VILLAGE = BOARD.filter((m) => m.rank === 'V');

/** The scroll and quest techniques the missions name (no mentor teaches them). */
const EXTRA_KNOWN = ['core:enclosing', 'core:shadow_clone'];

export interface PlayerOptions {
  seed?: number;
  /** Owned natures, the native one first; `[]` for none. */
  natures?: NatureId[];
  /** Skill levels; every skill not named stays at 1. */
  levels?: Partial<Record<SkillId, number>>;
  /** Skills at this level unless `levels` says otherwise. */
  base?: number;
  /** Whether the team exists (it does once a native nature is chosen). */
  team?: boolean;
  /** Techniques known besides what the mentors teach. */
  known?: string[];
  bank?: Record<string, number>;
}

/** A genin standing at the levels asked for, the team following the native nature, and the C missions open. */
export function player(opts: PlayerOptions = {}): GameState {
  const state = createState(opts.seed ?? 1, content);
  state.player.rank = 'genin';
  const natures = opts.natures ?? [];
  state.player.natures = natures;
  const [native] = natures;
  state.team = native && opts.team !== false ? teamFor(content, native) : null;
  for (const skill of content.skills) {
    state.skills[skill.id].xp = xpAt(opts.levels?.[skill.id] ?? opts.base ?? 1);
  }
  for (const id of opts.known ?? []) state.known[id] = true;
  for (const [id, n] of Object.entries(opts.bank ?? {})) state.bank[id] = n;
  setFlag(state, 'missions.c.unlocked');
  state.bank['core:medpouch'] = 1;
  refreshUnlocks(state, content, true);
  updateQuests(state, content);
  state.events = [];
  return state;
}

/** The nature a mission asks for first, so a player of that nature can do it on their own; Katon when it asks for none. */
export function natureFor(m: Mission): NatureId {
  for (const stage of m.stages) {
    const skills =
      stage.t === 'named'
        ? [stage.technique, ...stage.alts].map(
            (id) => content.techniques.find((t) => t.id === id)?.skill ?? '',
          )
        : stage.t === 'tech'
          ? stage.any.map((alt) => alt.skill)
          : [];
    const found = skills.find((s): s is NatureId => (NATURE_IDS as readonly string[]).includes(s));
    if (found) return found;
  }
  return 'katon';
}

/** A player who can do every stage of `m` on their own: levels high enough, the named techniques known, the items stocked. */
export function ableFor(
  m: Mission,
  natures: NatureId[] = [natureFor(m)],
  seed = 1,
  natureLevel = 50,
): GameState {
  const levels: Partial<Record<SkillId, number>> = {
    scout: 40,
    ath: 40,
    herb: 20,
    tai: 40,
    nin: 40,
    cc: 30,
    med: 30,
    vit: 36,
    eva: 36,
  };
  for (const n of NATURE_IDS) levels[n] = natures.includes(n) ? natureLevel : 1;
  const bank: Record<string, number> = { 'core:antidote': 50, 'core:wire': 50 };
  return player({ seed, natures, levels, known: EXTRA_KNOWN, bank });
}

/** Starts a mission in slot 0 and returns the command result. */
export const startMission = (state: GameState, id: string, slot = 0) =>
  dispatch(state, { type: 'action.start', slot, kind: 'mission', id }, content);

/** Advances in `chunk` ms steps until the mission is done `times` times or `limitMs` passes; returns the time spent. */
export function runUntilDone(state: GameState, id: string, limitMs: number, times = 1): number {
  const start = state.now;
  const key = `missions.done.${id}`;
  while ((state.counters[key] ?? 0) < times && state.now - start < limitMs) {
    advance(state, 1000, content);
  }
  return state.now - start;
}

/** The units of a village resource the player has: Shinobi Power, Workforce or a shinobi resource; 0 with no village. */
export function villageUnits(state: GameState, slug: string): number {
  const village = state.village;
  if (!village) return 0;
  const kind = content.resources.find((r) => r.id === slug)?.kind;
  if (kind === 'power') return village.power;
  if (kind === 'workforce') return village.workforce;
  return village.shinobi[slug] ?? 0;
}
