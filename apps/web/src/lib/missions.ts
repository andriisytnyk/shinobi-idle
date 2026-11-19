import type { ContentDb, Mission } from '@shinobi/content';
import {
  MISSION_KIND,
  MS_PER_HOUR,
  missionEntry,
  missionStageWays,
  readRun,
  type BoardEntry,
  type GameState,
  type MissionForecast,
  type MissionRewards,
  type MissionRun,
  type Modifier,
  type Rules,
  type StageForecast,
  type StageWays,
} from '@shinobi/core';
import { fightTargetRef } from './entities.ts';
import { hasKey } from './i18n.ts';
import type { EntityRef } from './route.ts';

/*
 * What the mission screens need that is not drawing: which missions the board has, how a stage is
 * named, what a running mission shows, how the cards are sorted. Every number and every rule of
 * the missions (the way a stage is done by, its length and chance, its XP, what it pays, whether
 * it can be started and why not) comes from core's `missionEntry`, `missionStageWays` and
 * `missionStatus`; nothing of it is worked out here. Content is read from the `content` passed in
 * (the running game's), never from a global.
 */

/** The missions on the board, in content order. */
export const boardMissions = (content: ContentDb): Mission[] =>
  content.missions.filter((m) => m.board);

/** The board grouped by mission rank in the order of `content.missionRanks`; ranks without a mission are left out. */
export function rankGroups(content: ContentDb): { rank: string; missions: Mission[] }[] {
  const board = boardMissions(content);
  return content.missionRanks
    .map((r) => ({ rank: r.id, missions: board.filter((m) => m.rank === r.id) }))
    .filter((g) => g.missions.length > 0);
}

// ---------- starting ----------

/** An action that holds a slot: what it is and, when it has a page, where. */
export interface ActionRef {
  kind: string;
  id: string;
  ref: EntityRef | null;
}

/** The entity page an action of a slot belongs to: a mission or a fight's enemy; none for an operation. */
export function actionEntity(action: { kind: string; id: string }): EntityRef | null {
  if (action.kind === MISSION_KIND) return { kind: 'mission', id: action.id };
  if (action.kind === 'fight') {
    // A raid or a zone is fought by its own id; what is fought is its enemy.
    return fightTargetRef(action.id) ?? { kind: 'enemy', id: action.id };
  }
  return null;
}

/** The action core names as the one that refuses a start (`by` of a refusal), with its page for the link. */
export const holderRef = (by: { kind: string; id: string }): ActionRef => ({
  kind: by.kind,
  id: by.id,
  ref: actionEntity(by),
});

// ---------- the forecast of one mission ----------

/** A mission with what blocks it, its unlock and how it would go: core's board line. */
export type MissionView = BoardEntry;

/** The board line of one mission, computed by core. */
export function missionView(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): MissionView {
  return missionEntry(state, mission, content, rules);
}

// ---------- rewards ----------

/** One thing a finished mission gives, as a card lists it. */
export type Reward =
  | { t: 'currency'; id: string; n: number }
  | { t: 'item'; id: string; n: number; chance: number }
  | { t: 'resource'; id: string; n: number };

/** The rows of the reward list, in the order core gives them: currencies, items, the village resource. */
export function rewardRows(rewards: MissionRewards): Reward[] {
  return [
    ...rewards.currencies.map((c): Reward => ({ t: 'currency', id: c.currency, n: c.n })),
    ...rewards.items.map((i): Reward => ({ t: 'item', id: i.item, n: i.n, chance: i.chance })),
    ...(rewards.resource
      ? [{ t: 'resource', id: rewards.resource.slug, n: rewards.resource.units } as const]
      : []),
  ];
}

// ---------- stages ----------

/** The name of a stage: its label when the data has one, and the entities the stage is about, as chips. */
export interface StageHead {
  labelKey: string | null;
  /** Every skill, technique, enemy or item the stage data names: shown as links beside the label. */
  refs: EntityRef[];
  /** A combat stage points at the combat page. */
  combat: boolean;
}

export function stageHead(mission: Mission, index: number, content: ContentDb): StageHead {
  const stage = mission.stages[index];
  const key = `mission.${mission.id}.stage.${index}.label`;
  const labelKey = hasKey(key) ? key : null;
  if (!stage) return { labelKey, refs: [], combat: false };
  switch (stage.t) {
    case 'combat':
      return {
        labelKey,
        refs: [
          {
            kind: content.bosses.some((b) => b.id === stage.enemy) ? 'boss' : 'enemy',
            id: stage.enemy,
          },
        ],
        combat: true,
      };
    case 'items':
      return { labelKey, refs: [{ kind: 'item', id: stage.item }], combat: false };
    case 'named':
      return {
        labelKey,
        refs: [stage.technique, ...stage.alts].map((id) => ({ kind: 'technique', id })),
        combat: false,
      };
    case 'skill':
      return { labelKey, refs: [{ kind: 'skill', id: stage.skill }], combat: false };
    case 'tech':
      return {
        labelKey,
        refs: [...new Set(stage.any.map((a) => a.skill))].map((id) => ({ kind: 'skill', id })),
        combat: false,
      };
  }
}

// ---------- a running mission ----------

/** What the «Зараз» bar shows of a mission in a slot. */
export interface MissionNow {
  id: string;
  /** The stage under way (0-based) and how many there are. */
  stage: number;
  stages: number;
  head: StageHead;
  /** `self` or the teammate's id. */
  who: string;
  /** Failed attempts at this stage: failed rolls, or lost fights. */
  failed: number;
  maxDefeats: number;
  combat: boolean;
  /** The fight of the stage waits for the fight to be free. */
  queued: boolean;
}

export function missionNow(state: GameState, slot: number, content: ContentDb): MissionNow | null {
  const action = state.slots[slot]?.action;
  if (action?.kind !== MISSION_KIND) return null;
  const mission = content.missions.find((m) => m.id === action.id);
  const run: MissionRun | null = mission
    ? readRun(state.slots[slot]?.data ?? null, mission, content)
    : null;
  if (!mission || !run) return null;
  return {
    id: mission.id,
    stage: run.s,
    stages: mission.stages.length,
    head: stageHead(mission, run.s, content),
    who: run.p.who,
    failed: run.a,
    maxDefeats: content.balance.K.mission.maxDefeats,
    combat: mission.stages[run.s]?.t === 'combat',
    queued: run.q === 1,
  };
}

// ---------- sorting ----------

export const MISSION_SORTS = ['rank', 'duration', 'ryoPerHour'] as const;
export type MissionSort = (typeof MISSION_SORTS)[number];

export const isMissionSort = (x: unknown): x is MissionSort =>
  typeof x === 'string' && (MISSION_SORTS as readonly string[]).includes(x);

/** Orders the missions of a group; `rank` keeps the data order. */
export function sortMissions(
  missions: Mission[],
  sort: MissionSort,
  key: (m: Mission) => { duration: number; ryoPerHour: number },
): Mission[] {
  if (sort === 'rank') return missions;
  return [...missions].sort((a, b) =>
    sort === 'duration' ? key(a).duration - key(b).duration : key(b).ryoPerHour - key(a).ryoPerHour,
  );
}

// ---------- the page of one mission ----------

/** One stage as the mission page draws it: its name, core's forecast of it and core's list of its ways. */
export interface StageView {
  index: number;
  head: StageHead;
  forecast: StageForecast;
  /** Every way to do the stage, met or not, with the one used, and the items the stage takes. */
  ways: StageWays;
}

/** The stages of a mission as the page draws them. */
export function stageViews(
  state: GameState,
  mission: Mission,
  forecast: MissionForecast,
  content: ContentDb,
  rules: Rules,
): StageView[] {
  return forecast.stages.map((stage) => ({
    index: stage.index,
    head: stageHead(mission, stage.index, content),
    forecast: stage,
    ways: missionStageWays(state, mission.id, stage.index, content, rules),
  }));
}

/** The total of a list of modifiers as core combines them: inside a group the `add` values sum, the `mul` values multiply, and the groups multiply. */
export function combineParts(parts: Modifier[]): number {
  const groups = new Map<string, { add: number; mul: number }>();
  for (const m of parts) {
    const g = groups.get(m.group) ?? { add: 0, mul: 1 };
    if (m.op === 'add') g.add += m.value;
    else g.mul *= m.value;
    groups.set(m.group, g);
  }
  let total = 1;
  for (const g of groups.values()) total *= (1 + g.add) * g.mul;
  return total;
}

/**
 * The chain behind a per-hour figure: the base of one mission, the modifiers (each with its
 * source) that make it `perMission`, how many runs fit in an hour at the expected length, and the
 * figure per hour.
 */
export function hourChain(
  base: number,
  parts: Modifier[],
  perMission: number,
  expectedMs: number,
): { base: number; total: number; perMission: number; runs: number; perHour: number } {
  const runs = expectedMs > 0 ? MS_PER_HOUR / expectedMs : 0;
  return { base, total: combineParts(parts), perMission, runs, perHour: perMission * runs };
}
