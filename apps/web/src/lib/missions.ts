import { scrollPartId, type ContentDb, type Mission } from '@shinobi/content';
import {
  MISSION_KIND,
  SELF,
  effectiveLoadout,
  evalReq,
  getMod,
  isCombatKind,
  missionBlocker,
  missionForecast,
  readRun,
  stageBaseMs,
  stageXp,
  xpGain,
  type EntityRef as CoreEntityRef,
  type GameState,
  type MissionForecast,
  type MissionRun,
  type Modifier,
  type Req,
  type ReqResult,
  type Rules,
  type StageForecast,
  type StagePlan,
} from '@shinobi/core';
import { hasKey } from './i18n.ts';
import type { EntityRef } from './route.ts';

/*
 * Everything the mission screens need to know that is not drawing: which missions the board has,
 * how a card stands (startable, blocked and why, running where), what a stage needs and which way
 * is used, what the mission pays and gives per hour. Content is read from the `content` passed in
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

/**
 * What a rank asks to open: the unlock of its first mission that has one. A rank is opened as a
 * whole; the missions of one rank share their unlock in the data.
 */
export function rankUnlock(
  state: GameState,
  rank: string,
  content: ContentDb,
): { result: ReqResult | null; open: boolean } {
  const gate = boardMissions(content).find((m) => m.rank === rank && m.unlock !== null)?.unlock;
  if (!gate) return { result: null, open: true };
  const result = evalReq(state, gate, content);
  return { result, open: result.met };
}

/** The first unmet leaf of a requirement result, depth first: the one thing to do next. */
export function firstUnmet(node: ReqResult): ReqResult | null {
  if (node.met) return null;
  for (const child of node.children) {
    const found = firstUnmet(child);
    if (found) return found;
  }
  return node.children.length === 0 ? node : null;
}

// ---------- starting ----------

/** The slot a mission is started in: the first one with nothing in it, else the first slot. */
export function targetSlot(state: GameState): number {
  const free = state.slots.findIndex((s) => s.action === null);
  return free >= 0 ? free : 0;
}

/** Index of the slot that runs this mission, or -1. */
export const slotOfMission = (state: GameState, id: string): number =>
  state.slots.findIndex((s) => s.action?.kind === MISSION_KIND && s.action.id === id);

/** An action that holds a slot: what it is and, when it has a page, where. */
export interface ActionRef {
  kind: string;
  id: string;
  ref: EntityRef | null;
}

/** The entity page an action of a slot belongs to: a mission or a fight's enemy; none for an operation. */
export function actionEntity(action: { kind: string; id: string }): EntityRef | null {
  if (action.kind === MISSION_KIND) return { kind: 'mission', id: action.id };
  if (action.kind === 'fight') return { kind: 'enemy', id: action.id };
  return null;
}

/** The action in another slot that makes `error.fightBusy` or `error.missionRunning`, for the sentence's link. */
export function busyBy(
  state: GameState,
  slot: number,
  mission: Mission,
  reason: string,
  content: ContentDb,
): ActionRef | null {
  for (const [index, other] of state.slots.entries()) {
    const action = other.action;
    if (index === slot || !action) continue;
    if (reason === 'error.missionRunning') {
      if (action.kind === MISSION_KIND && action.id === mission.id) {
        return { ...action, ref: actionEntity(action) };
      }
    } else if (reason === 'error.fightBusy') {
      // A mission with a combat stage ahead holds the fight too, even while it is not fighting.
      const holds =
        action.kind === MISSION_KIND &&
        (content.missions.find((m) => m.id === action.id)?.stages.some((s) => s.t === 'combat') ??
          false);
      if (isCombatKind(action.kind) || holds) return { ...action, ref: actionEntity(action) };
    }
  }
  return null;
}

/** How a mission stands for the player now, in the words `dispatch` would use. */
export type MissionState =
  | { kind: 'running'; slot: number }
  | { kind: 'startable'; slot: number }
  | {
      kind: 'blocked';
      slot: number;
      /** What `dispatch` answers to starting it: the localization key of the refusal. */
      reason: string;
      /** The item the first items stage lacks (the reason is then `error.missingIngredient`). */
      missing: string | null;
      /** The requirement result that is first unmet; null when the refusal is not a requirement. */
      blocker: ReqResult | null;
      /** The action in another slot that refuses the start, when that is the reason. */
      by: ActionRef | null;
    };

/**
 * The state a card or page shows, computed in one place from core's blocker and the slot rules,
 * so that it agrees with `dispatch`: the same refusal, in the same order (the slot's own rules
 * first, then requirements). `blocker` is core's `missionBlocker` for the mission, passed in so
 * that a caller can reuse one it computed at a coarse rate; the slot rules are cheap and read live.
 */
export function missionState(
  state: GameState,
  mission: Mission,
  blocker: ReturnType<typeof missionBlocker>,
  content: ContentDb,
  rules: Rules,
): MissionState {
  const running = slotOfMission(state, mission.id);
  if (running >= 0) return { kind: 'running', slot: running };
  const slot = targetSlot(state);
  const kind = rules.actionKinds[MISSION_KIND];
  const refused = kind?.blocked?.(state, mission.id, content, rules, slot) ?? null;
  if (refused) {
    return {
      kind: 'blocked',
      slot,
      reason: refused,
      missing: null,
      blocker: null,
      by: busyBy(state, slot, mission, refused, content),
    };
  }
  if (blocker) {
    const missing = kind?.missing?.(state, mission.id, content, rules) ?? null;
    return {
      kind: 'blocked',
      slot,
      reason: missing ? 'error.missingIngredient' : 'error.requirementsNotMet',
      missing,
      blocker: firstUnmet(blocker.result) ?? blocker.result,
      by: null,
    };
  }
  return { kind: 'startable', slot };
}

// ---------- the forecast of one mission ----------

/** A mission with what blocks it and how it would go, as the board computes it. */
export interface MissionView {
  blocker: ReturnType<typeof missionBlocker>;
  forecast: MissionForecast;
  /** The mission's own unlock holds (its rank is open). */
  open: boolean;
}

/** The forecast and blocker of one mission; the board's computation for a single card. */
export function missionView(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): MissionView {
  return {
    blocker: missionBlocker(state, mission, content, rules),
    forecast: missionForecast(state, mission, content, rules),
    open: mission.unlock === null || evalReq(state, mission.unlock, content).met,
  };
}

/** The chance that one run goes with no failed attempt: the stages' chances multiplied. */
export const cleanRunChance = (forecast: MissionForecast): number =>
  forecast.stages.reduce((p, s) => p * (s.path ? s.chance : 0), 1);

// ---------- rewards ----------

/** One thing a finished mission gives. */
export type Reward =
  | { t: 'currency'; id: string; n: number }
  | { t: 'item'; id: string; n: number; chance: number }
  | { t: 'resource'; id: string; n: number };

/**
 * What a finished mission pays, from its forecast and data: the currencies in the order of
 * `content.currencies` (Reputation only when the forecast gives some), the payment in kind with
 * its chance, and the village resource.
 */
export function rewardsOf(
  mission: Mission,
  forecast: MissionForecast,
  content: ContentDb,
): Reward[] {
  const amounts: Record<string, number> = { ryo: forecast.ryo, rep: forecast.rep };
  const out: Reward[] = [];
  const items = new Set(content.items.map((i) => i.id));
  const items2: Reward[] = [];
  for (const pay of forecast.pay) {
    if (pay.kind === 'item') items2.push({ t: 'item', id: pay.item, n: pay.n, chance: 1 });
    else if (pay.kind === 'intel') amounts.intel = (amounts.intel ?? 0) + pay.n;
    else {
      const part = scrollPartId(pay.technique);
      if (items.has(part)) {
        items2.push({ t: 'item', id: part, n: 1, chance: content.balance.K.partDrop.mission });
      }
    }
  }
  for (const c of content.currencies) {
    const n = amounts[c.id] ?? 0;
    if (n > 0) out.push({ t: 'currency', id: c.id, n });
  }
  out.push(...items2);
  if (forecast.resource) {
    out.push({ t: 'resource', id: forecast.resource.slug, n: forecast.resource.units });
  }
  void mission;
  return out;
}

// ---------- stages ----------

/** The name of a stage: its label when the data has one, else the entity it is about. */
export interface StageHead {
  labelKey: string | null;
  ref: EntityRef | null;
  /** A combat stage points at the combat page. */
  combat: boolean;
}

export function stageHead(mission: Mission, index: number, content: ContentDb): StageHead {
  const stage = mission.stages[index];
  const key = `mission.${mission.id}.stage.${index}.label`;
  const labelKey = hasKey(key) ? key : null;
  if (!stage) return { labelKey, ref: null, combat: false };
  switch (stage.t) {
    case 'combat':
      return {
        labelKey,
        ref: {
          kind: content.bosses.some((b) => b.id === stage.enemy) ? 'boss' : 'enemy',
          id: stage.enemy,
        },
        combat: true,
      };
    case 'items':
      return { labelKey, ref: { kind: 'item', id: stage.item }, combat: false };
    case 'named':
      return { labelKey, ref: { kind: 'technique', id: stage.technique }, combat: false };
    default:
      return { labelKey, ref: null, combat: false };
  }
}

/** One way to do a stage, as the page lists it. */
export interface StageAlt {
  /** What the way needs; null for the way that costs Intel. */
  req: Req | null;
  slow: boolean;
  /** The skill checked, or the technique's skill; '' for Intel. */
  skill: string;
  /** The technique a named stage asks for; '' otherwise. */
  tech: string;
  /** Intel the way costs; 0 for the others. */
  intel: number;
}

/**
 * Every way to do stage `index`: what each needs, which are slow fallbacks, and the Intel way when
 * the data has a price for it. A fight and an item stage have no alternatives (the items are
 * listed apart as what the stage takes).
 */
export function stageAlts(mission: Mission, index: number, content: ContentDb): StageAlt[] {
  const stage = mission.stages[index];
  if (!stage) return [];
  const out: StageAlt[] = [];
  const slow = new Set(mission.slow[index] ?? []);
  switch (stage.t) {
    case 'skill':
      out.push({
        req: { t: 'skill', skill: stage.skill, level: stage.min },
        slow: false,
        skill: stage.skill,
        tech: '',
        intel: 0,
      });
      break;
    case 'tech':
      stage.any.forEach((alt, i) =>
        out.push({
          req: { t: 'skill', skill: alt.skill, level: alt.min },
          slow: slow.has(i),
          skill: alt.skill,
          tech: '',
          intel: 0,
        }),
      );
      break;
    case 'named':
      for (const id of [stage.technique, ...stage.alts]) {
        out.push({
          req: { t: 'technique', id },
          slow: false,
          skill: content.techniques.find((t) => t.id === id)?.skill ?? '',
          tech: id,
          intel: 0,
        });
      }
      break;
    default:
      break;
  }
  const cost = mission.skip[index] ?? 0;
  if (cost > 0 && stage.t !== 'items' && stage.t !== 'combat') {
    out.push({ req: null, slow: false, skill: '', tech: '', intel: cost });
  }
  return out;
}

/** The index in `alts` of the way the forecast says will be used, or -1 when none of them is (a fight, an item stage, a blocked stage). */
export function usedAlt(alts: StageAlt[], path: StageForecast['path']): number {
  if (!path) return -1;
  if (path.intel > 0) return alts.findIndex((a) => a.intel > 0);
  const named = alts.findIndex((a) => a.tech !== '' && a.tech === path.tech);
  if (named >= 0) return named;
  const exact = alts.findIndex(
    (a) => a.intel === 0 && a.tech === '' && a.skill === path.skill && a.slow === path.slow,
  );
  return exact >= 0
    ? exact
    : alts.findIndex((a) => a.intel === 0 && a.tech === '' && a.skill === path.skill);
}

/** What the forecast calls who does a stage: the player, or the teammate of this id. */
export const isSelf = (who: string): boolean => who === SELF;

/** The items a stage takes when it begins, with what the player has. */
export function stageTakes(
  state: GameState,
  mission: Mission,
  index: number,
): { item: string; need: number; have: number } | null {
  const stage = mission.stages[index];
  return stage?.t === 'items'
    ? { item: stage.item, need: stage.n, have: state.bank[stage.item] ?? 0 }
    : null;
}

/** The skill a fight's style XP goes to, as far as it can be told now: the first technique of the loadout, else the balance's default. */
export function styleGuess(state: GameState, content: ContentDb): string {
  const first = effectiveLoadout(state, content)[0];
  return (
    (first && content.techniques.find((t) => t.id === first)?.skill) ||
    content.balance.K.mission.defaultStyle
  );
}

/** The XP one attempt of a stage the player does gives (as it would be added), and the technique whose Mastery grows. */
export function stageReward(
  state: GameState,
  mission: Mission,
  stage: StageForecast,
  content: ContentDb,
  rules: Rules,
): { xp: { skill: string; amount: number }[]; mastery: string | null } {
  if (!stage.path) return { xp: [], mastery: null };
  const plan: StagePlan = {
    ...stage.path,
    level: 0,
    min: 0,
    mastery: 1,
    ms: stage.ms,
    chance: stage.chance,
  };
  const earned = stageXp(state, mission, stage.index, plan, styleGuess(state, content), content);
  return {
    xp: earned.xp
      .map(([skill, amount]) => ({ skill, amount: xpGain(state, skill, amount, content, rules) }))
      .filter((x) => x.amount > 0),
    mastery: earned.mastery?.id ?? null,
  };
}

/** The base length of a stage in ms, before any modifier. */
export const stageBase = (mission: Mission, index: number): number => stageBaseMs(mission, index);

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

/** One stage as the mission page draws it, worked out from a forecast. */
export interface StageView {
  index: number;
  head: StageHead;
  forecast: StageForecast;
  /** Every way to do the stage, each with its evaluated requirement and whether it is the way that will be used. */
  alts: { alt: StageAlt; result: ReqResult | null; used: boolean; have: number }[];
  /** The items the stage takes, with what the player has. */
  takes: { item: string; need: number; have: number } | null;
  /** XP of one attempt by skill, and the technique whose Mastery grows. */
  reward: { xp: { skill: string; amount: number }[]; mastery: string | null };
  /** The base length of the stage, ms, and the modifiers that shorten or lengthen it. */
  base: number;
  parts: Modifier[];
  /** What is left of the length once the modifiers and the ration are taken off: the level, Mastery and slow-way factor. */
  residual: number;
}

/** Works out how every stage of a mission is drawn: the ways with their results, the path used, the XP, the length's parts. */
export function stageViews(
  state: GameState,
  mission: Mission,
  forecast: MissionForecast,
  content: ContentDb,
  rules: Rules,
): StageView[] {
  return forecast.stages.map((stage) => {
    const alts = stageAlts(mission, stage.index, content);
    const used = usedAlt(alts, stage.path);
    const skill = stage.path?.tech ? stage.path.skill : '';
    const parts = [...forecast.mods.duration, ...(forecast.mods.durationBySkill[skill] ?? [])];
    const base = stageBaseMs(mission, stage.index);
    const factor =
      getMod(state, 'mission.duration', content, rules).total *
      (skill !== '' && Object.hasOwn(forecast.mods.durationBySkill, skill)
        ? getMod(state, `mission.duration.${skill}`, content, rules).total
        : 1);
    const raw = stage.ms / (base * factor * (1 + forecast.ration));
    return {
      index: stage.index,
      head: stageHead(mission, stage.index, content),
      forecast: stage,
      alts: alts.map((alt, i) => ({
        alt,
        result: alt.req ? evalReq(state, alt.req, content) : null,
        used: i === used,
        have: alt.intel > 0 ? state.currencies.intel : 0,
      })),
      takes: stageTakes(state, mission, stage.index),
      reward: stageReward(state, mission, stage, content, rules),
      base,
      parts,
      residual: stage.path && Number.isFinite(raw) ? raw : 1,
    };
  });
}

/** The items that shorten a mission when used, with what each does. */
export function rationItems(
  content: ContentDb,
): { id: string; duration: number; missions: number }[] {
  return content.items.flatMap((i) =>
    i.fx?.kind === 'ration' ? [{ id: i.id, duration: i.fx.duration, missions: i.fx.missions }] : [],
  );
}

/** The ration item that is armed for the next mission, or null. */
export function armedRationItem(state: GameState, content: ContentDb): string | null {
  for (const item of rationItems(content)) {
    if ((state.buffs[item.id]?.charges ?? 0) >= 1) return item.id;
  }
  return null;
}

/** The entity kinds the core accepts as a goal. */
export const PINNABLE = ['technique', 'skill', 'item', 'enemy', 'quest'] as const;

/** The entity to pin for a blocked mission: the first unmet row that names one the goal accepts. */
export function pinTarget(blocker: ReqResult | null): CoreEntityRef | null {
  if (!blocker) return null;
  const ref = firstUnmet(blocker)?.ref;
  return ref && (PINNABLE as readonly string[]).includes(ref.kind) ? ref : null;
}
