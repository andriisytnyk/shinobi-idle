import { scrollPartId, type ContentDb, type Mission, type SkillId } from '@shinobi/content';
import {
  MISSION_KIND,
  buildingLevel,
  effectiveLoadout,
  evalReq,
  masteryLevel,
  skillLevel,
  getMod,
  isCombatKind,
  MS_PER_HOUR,
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
export function rewardsOf(forecast: MissionForecast, content: ContentDb): Reward[] {
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
  return out;
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
  /** For a nature, core also asks for a known technique of that skill of at least this level. */
  techNeeded: { skill: string; min: number } | null;
}

/**
 * Every way to do stage `index`: what each needs, which are slow fallbacks, and the Intel way when
 * the data has a price for it. A fight and an item stage have no alternatives (the items are
 * listed apart as what the stage takes). A nature's way carries the technique condition core
 * applies besides the skill level.
 */
export function stageAlts(mission: Mission, index: number, content: ContentDb): StageAlt[] {
  const stage = mission.stages[index];
  if (!stage) return [];
  const out: StageAlt[] = [];
  const slow = new Set(mission.slow[index] ?? []);
  const isNature = (skill: string): boolean => content.natures.some((n) => n.id === skill);
  const skillWay = (skill: string, min: number, isSlow: boolean): StageAlt => ({
    req: { t: 'skill', skill: skill as SkillId, level: min },
    slow: isSlow,
    skill,
    tech: '',
    intel: 0,
    techNeeded: isNature(skill) ? { skill, min } : null,
  });
  switch (stage.t) {
    case 'skill':
      out.push(skillWay(stage.skill, stage.min, false));
      break;
    case 'tech':
      stage.any.forEach((alt, i) => out.push(skillWay(alt.skill, alt.min, slow.has(i))));
      break;
    case 'named':
      for (const id of [stage.technique, ...stage.alts]) {
        out.push({
          req: { t: 'technique', id },
          slow: false,
          skill: content.techniques.find((t) => t.id === id)?.skill ?? '',
          tech: id,
          intel: 0,
          techNeeded: null,
        });
      }
      break;
    default:
      break;
  }
  const cost = mission.skip[index] ?? 0;
  if (cost > 0 && stage.t !== 'items' && stage.t !== 'combat') {
    out.push({ req: null, slow: false, skill: '', tech: '', intel: cost, techNeeded: null });
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

/**
 * What one attempt of a stage the player does gives. The skill gets its XP (as it would be added)
 * only where the performer and the skill are certain: a stage checked by a skill. A fight pays its
 * style XP to the skill of the technique last used in it, which nothing tells beforehand, so a
 * fight is given as one total before bonuses (the style share and the fixed Vitality and Evasion
 * shares together), with no split by skill.
 */
export interface StageXpView {
  skills: { skill: string; amount: number }[];
  /** The whole XP of one attempt at a fight stage, before bonuses; null for other stages. */
  fight: number | null;
  /** The technique whose Mastery grows. */
  mastery: string | null;
}

export function stageReward(
  state: GameState,
  mission: Mission,
  stage: StageForecast,
  content: ContentDb,
  rules: Rules,
): StageXpView {
  if (!stage.path) return { skills: [], fight: null, mastery: null };
  const plan: StagePlan = {
    ...stage.path,
    level: 0,
    min: 0,
    mastery: 1,
    ms: stage.ms,
    chance: stage.chance,
  };
  const fight = mission.stages[stage.index]?.t === 'combat';
  const style = content.balance.K.mission.defaultStyle;
  const earned = stageXp(state, mission, stage.index, plan, style, content);
  if (fight) {
    return {
      skills: [],
      fight: earned.xp.reduce((sum, [, amount]) => sum + amount, 0),
      mastery: null,
    };
  }
  return {
    skills: earned.xp
      .map(([skill, amount]) => ({ skill, amount: xpGain(state, skill, amount, content, rules) }))
      .filter((x) => x.amount > 0),
    fight: null,
    mastery: earned.mastery?.id ?? null,
  };
}

/** Per hour of running the mission over and over: the XP of the skills a stage fixes, and the fights' total (before bonuses). */
export function xpTotals(
  stages: StageView[],
  forecast: MissionForecast,
): { skills: Record<string, number>; fight: number } {
  const hours = forecast.expectedMs / MS_PER_HOUR;
  const skills: Record<string, number> = {};
  let fight = 0;
  if (!(hours > 0)) return { skills, fight };
  for (const view of stages) {
    const attempts = 1 / Math.max(view.forecast.chance, Number.EPSILON);
    for (const x of view.reward.skills) {
      skills[x.skill] = (skills[x.skill] ?? 0) + (x.amount * attempts) / hours;
    }
    if (view.reward.fight !== null) fight += (view.reward.fight * attempts) / hours;
  }
  return { skills, fight };
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

/** One stage as the mission page draws it, worked out from a forecast. */
export interface StageView {
  index: number;
  head: StageHead;
  forecast: StageForecast;
  /**
   * Every way to do the stage with its evaluated requirement. `met` is every condition core applies
   * for the player to do it by this way (the skill level and, for a nature, a known technique);
   * `used` is the way the forecast says will be used.
   */
  alts: {
    alt: StageAlt;
    result: ReqResult | null;
    techMet: boolean;
    met: boolean;
    used: boolean;
    have: number;
  }[];
  /** The items the stage takes, with what the player has. */
  takes: { item: string; need: number; have: number } | null;
  reward: StageXpView;
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
      alts: alts.map((alt, i) => {
        const result = alt.req ? evalReq(state, alt.req, content) : null;
        const need = alt.techNeeded;
        const techMet =
          need === null ||
          content.techniques.some(
            (t) => t.skill === need.skill && t.level >= need.min && state.known[t.id],
          );
        return {
          alt,
          result,
          techMet,
          met:
            alt.intel > 0 ? state.currencies.intel >= alt.intel : (result?.met ?? false) && techMet,
          used: i === used,
          have: alt.intel > 0 ? state.currencies.intel : 0,
        };
      }),
      takes: stageTakes(state, mission, stage.index),
      reward: stageReward(state, mission, stage, content, rules),
      base,
      parts,
      residual: stage.path && Number.isFinite(raw) ? raw : 1,
    };
  });
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

/** The items that shorten a mission when used, with what each does. */
export function rationItems(
  content: ContentDb,
): { id: string; duration: number; missions: number }[] {
  return content.items.flatMap((i) =>
    i.fx?.kind === 'ration' ? [{ id: i.id, duration: i.fx.duration, missions: i.fx.missions }] : [],
  );
}

/** The entity kinds the core accepts as a goal. */
export const PINNABLE = ['technique', 'skill', 'item', 'enemy', 'quest'] as const;

/** The entity to pin for a blocked mission: the first unmet row that names one the goal accepts. */
export function pinTarget(blocker: ReqResult | null): CoreEntityRef | null {
  if (!blocker) return null;
  const ref = firstUnmet(blocker)?.ref;
  return ref && (PINNABLE as readonly string[]).includes(ref.kind) ? ref : null;
}

// ---------- when a forecast is stale ----------

/**
 * A cheap signature of what a mission forecast and its blocker depend on: the levels of the
 * skills, the Mastery of the techniques known, the rank, the team, the loadout, the natures, the
 * flags, the levels of the buildings, Intel, the items the stages take and the rations, and the
 * armed ration. A forecast is recomputed when this changes (a level-up, a finished building, a
 * bought item), not on a timer. Slots are not in it: whether a slot is free is read live.
 */
export function inputsSignature(state: GameState, content: ContentDb): string {
  const parts: (string | number)[] = [state.player.rank, state.currencies.intel];
  for (const skill of content.skills) parts.push(skillLevel(state, skill.id, content));
  for (const id of Object.keys(state.known)) parts.push(masteryLevel(state, id, content));
  parts.push(state.player.natures.join(','), JSON.stringify(state.team));
  parts.push(effectiveLoadout(state, content).join(','), JSON.stringify(state.flags));
  for (const b of content.buildings) parts.push(buildingLevel(state, b.id));
  const items = new Set<string>(rationItems(content).map((r) => r.id));
  for (const m of content.missions) {
    for (const stage of m.stages) if (stage.t === 'items') items.add(stage.item);
  }
  for (const id of items) parts.push(state.bank[id] ?? 0, state.buffs[id]?.charges ?? 0);
  return parts.join('|');
}
