/** Prepared states the mission API tests run every board mission in. */
import { content, type Mission } from '@shinobi/content';
import { currencyOf, dispatch, type GameState } from '../src/index.ts';
import { openWorld } from './helpers.ts';
import { ableFor, player } from './missions-helpers.ts';

export const BOARD = content.missions.filter((m) => m.board);

const rationItem = content.items.find((i) => i.fx?.kind === 'ration')?.id ?? '';

const SKILLS = {
  tai: 30,
  nin: 30,
  scout: 30,
  ath: 30,
  herb: 15,
  cc: 20,
  med: 20,
  vit: 30,
  eva: 30,
};

/** The six prepared states; each is built afresh for a mission. */
export const STATES: Record<string, (m: Mission) => GameState> = {
  fresh: () => player({ seed: 11 }),
  able: (m) => ableFor(m, undefined, 12),
  mid: () => player({ seed: 13, natures: ['katon'], base: 12 }),
  suitonNoTechnique: () =>
    player({ seed: 14, natures: ['suiton'], levels: { ...SKILLS, suiton: 40 }, base: 1 }),
  intelRich: () => {
    const state = player({ seed: 15, natures: ['doton'], base: 3 });
    state.currencies[currencyOf(content, 'study') ?? ''] = 500;
    return state;
  },
  rationed: (m) => {
    const state = ableFor(m, undefined, 16);
    state.buffs[rationItem] = { skill: 'mission', charges: 2 };
    // A player who can do everything alone but has no team (the nature test is not passed).
    state.team = null;
    return state;
  },
};

const combatMissions = content.missions.filter(
  (m) => m.board && m.stages.some((s) => s.t === 'combat'),
);
const quietMission = content.missions.find(
  (m) => m.board && !m.team && m.stages.every((s) => s.t !== 'combat'),
);

const second = (state: GameState): GameState => {
  state.slots.push({ action: null, progress: 0, share: 0, data: null });
  return state;
};

const startIn = (state: GameState, slot: number, kind: string, id: string): void => {
  dispatch(state, { type: 'action.start', slot, kind, id }, content);
};

/** A prepared state and the slot a start is asked in. */
export interface Asked {
  state: GameState;
  slot: number;
}

/** Eleven states for the status of starting a mission: the six, and five with two slots. */
export const STATUS_STATES: Record<string, (m: Mission) => Asked> = {
  ...Object.fromEntries(
    Object.entries(STATES).map(([name, build]) => [
      name,
      (m: Mission): Asked => ({ state: build(m), slot: 0 }),
    ]),
  ),
  // The same mission runs in slot 0, a start is asked in slot 1.
  runsInOtherSlot: (m) => {
    const state = second(ableFor(m));
    startIn(state, 0, 'mission', m.id);
    return { state, slot: 1 };
  },
  // The same mission runs in slot 0 and is asked again there: it restarts.
  restartsInOwnSlot: (m) => {
    const state = second(ableFor(m));
    startIn(state, 0, 'mission', m.id);
    return { state, slot: 0 };
  },
  // A mission with a combat stage runs in slot 0.
  combatMissionRuns: (m) => {
    const other = combatMissions.find((c) => c.id !== m.id) ?? combatMissions[0];
    const state = second(ableFor(other ?? m));
    startIn(state, 0, 'mission', other?.id ?? m.id);
    return { state, slot: 1 };
  },
  // A zone fight runs in slot 0.
  zoneFightRuns: (m) => {
    const state = second(ableFor(m));
    openWorld(state);
    startIn(state, 0, 'fight', 'core:bandit');
    return { state, slot: 1 };
  },
  // A mission with no fight in it runs in slot 0, the items for the asked one are gone.
  quietRunsAndItemsGone: (m) => {
    const state = second(ableFor(m));
    if (quietMission && quietMission.id !== m.id) startIn(state, 0, 'mission', quietMission.id);
    for (const stage of m.stages) if (stage.t === 'items') delete state.bank[stage.item];
    return { state, slot: 1 };
  },
};
