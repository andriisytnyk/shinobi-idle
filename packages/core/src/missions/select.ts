import type { ContentDb, Mission, MissionPay } from '@shinobi/content';
import { effectiveLoadout } from '../combat/loadout.ts';
import { MS_PER_HOUR } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod, type Modifier } from '../modifiers.ts';
import { xpGain } from '../progression.ts';
import { evalReq, type ReqResult } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import { planStage, type StagePlan } from './plan.ts';
import { armedRation } from './ration.ts';
import { missionRequirements, resourceUnits, stageXp } from './run.ts';

/** How one stage is done and how it goes now, and at the next Mastery step of the technique used. */
export interface StageForecast {
  index: number;
  kind: Mission['stages'][number]['t'];
  /** Localization key of the stage's label. */
  labelKey: string;
  /** The path the game would take; null when the stage is blocked. */
  path: Pick<StagePlan, 'who' | 'skill' | 'tech' | 'slow' | 'intel'> | null;
  /** Length of one attempt, ms, and the chance an attempt succeeds. */
  ms: number;
  chance: number;
  /** Expected time with the repeats of failed attempts, ms. */
  expectedMs: number;
  /** The same at the next Mastery level of the technique; null when no technique is used. */
  next: { ms: number; chance: number } | null;
}

export interface MissionForecast {
  id: string;
  stages: StageForecast[];
  /** The mission's length with no failed attempt, and with them as expected, ms. */
  nominalMs: number;
  expectedMs: number;
  /** What it pays: ryo and Reputation after the modifiers, and the payments in kind. */
  ryo: number;
  rep: number;
  pay: MissionPay[];
  /** Village resource: the slug and the units one finished mission brings after the modifiers; null for none. */
  resource: { slug: string; units: number } | null;
  /** The modifiers that went into the ryo, the Reputation and the resource units, for the breakdown. */
  mods: {
    ryo: Modifier[];
    rep: Modifier[];
    resource: Modifier[];
    /** Every mission's duration modifiers, and for each skill a technique of which performs a stage the modifiers of that skill's own key. */
    duration: Modifier[];
    durationBySkill: Record<string, Modifier[]>;
  };
  /** The share of its base time a stage cannot be shortened below (`K.mission.minFactor`). */
  durationFloor: number;
  /** The share the armed ration takes off the mission (0 with none armed). */
  ration: number;
  /** Per hour of running the mission over and over: ryo, Reputation and the XP of each skill (what is really added, caps and slowdowns counted). */
  ryoPerHour: number;
  repPerHour: number;
  xpPerHour: Record<string, number>;
  /** Every stage has a way now. */
  doable: boolean;
}

/** The skill a fight of the player's loadout earns style XP in, as far as it can be told beforehand. */
function styleGuess(state: GameState, content: ContentDb): string {
  const first = effectiveLoadout(state, content)[0];
  return (
    (first && indexOf(content).techniques.get(first)?.skill) ||
    content.balance.K.mission.defaultStyle
  );
}

/** Forecast of one mission for the player as they are now: path, time and chance of each stage, rewards, and the rates per hour. */
export function missionForecast(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): MissionForecast {
  const mods = rules.modifierProviders;
  const ration = armedRation(state, content);
  const style = styleGuess(state, content);
  const stages: StageForecast[] = [];
  const xpAmount: Record<string, number> = {};
  let nominal = 0;
  let expected = 0;
  let doable = true;
  mission.stages.forEach((stage, index) => {
    const plan = planStage(state, mission, index, content, rules, ration);
    const labelKey = `mission.${mission.id}.stage.${index}.label`;
    if (!plan) {
      doable = false;
      stages.push({
        index,
        kind: stage.t,
        labelKey,
        path: null,
        ms: 0,
        chance: 0,
        expectedMs: 0,
        next: null,
      });
      return;
    }
    const after =
      plan.tech !== '' ? planStage(state, mission, index, content, rules, ration, 1) : null;
    const attempts = 1 / Math.max(plan.chance, Number.EPSILON);
    nominal += plan.ms;
    expected += plan.ms * attempts;
    // The XP of an attempt as the grant would add it, once per expected attempt.
    for (const [skill, amount] of stageXp(state, mission, index, plan, style, content).xp) {
      xpAmount[skill] =
        (xpAmount[skill] ?? 0) + xpGain(state, skill, amount, content, rules) * attempts;
    }
    stages.push({
      index,
      kind: stage.t,
      labelKey,
      path: {
        who: plan.who,
        skill: plan.skill,
        tech: plan.tech,
        slow: plan.slow,
        intel: plan.intel,
      },
      ms: plan.ms,
      chance: plan.chance,
      expectedMs: plan.ms * attempts,
      next: after ? { ms: after.ms, chance: after.chance } : null,
    });
  });
  const durationBySkill: Record<string, Modifier[]> = {};
  for (const stage of stages) {
    const skill = stage.path?.tech ? stage.path.skill : '';
    const key = `mission.duration.${skill}`;
    if (
      skill !== '' &&
      Object.hasOwn(content.modifierKeys, key) &&
      !Object.hasOwn(durationBySkill, skill)
    ) {
      durationBySkill[skill] = computeMod(mods, state, key, content).parts;
    }
  }
  const ryoMod = computeMod(mods, state, 'mission.ryo', content);
  const repMod = computeMod(mods, state, 'mission.rep', content);
  const resMod = mission.resourceMod
    ? computeMod(mods, state, mission.resourceMod, content)
    : { total: 1, parts: [] as Modifier[] };
  const ryo = Math.round(mission.ryo * ryoMod.total);
  const rep = mission.team ? Math.round(mission.rep * repMod.total) : 0;
  const hours = expected / MS_PER_HOUR;
  const xpPerHour: Record<string, number> = {};
  for (const [skill, v] of Object.entries(xpAmount)) xpPerHour[skill] = hours > 0 ? v / hours : 0;
  return {
    id: mission.id,
    stages,
    nominalMs: nominal,
    expectedMs: expected,
    ryo,
    rep,
    pay: mission.pay,
    resource: mission.resource
      ? { slug: mission.resource, units: resourceUnits(state, mission, content, rules) }
      : null,
    mods: {
      ryo: ryoMod.parts,
      rep: repMod.parts,
      resource: resMod.parts,
      duration: computeMod(mods, state, 'mission.duration', content).parts,
      durationBySkill,
    },
    durationFloor: content.balance.K.mission.minFactor,
    ration,
    ryoPerHour: hours > 0 ? ryo / hours : 0,
    repPerHour: hours > 0 ? rep / hours : 0,
    xpPerHour,
    doable,
  };
}

/** The first thing that blocks the mission: the requirement tree with its met and unmet parts, and the index of the first blocked stage (null when it is the mission's own unlock). Null when nothing blocks it. */
export function missionBlocker(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): { stage: number | null; result: ReqResult } | null {
  const req = missionRequirements(state, mission, 0, content, rules);
  const result = evalReq(state, req, content);
  if (result.met) return null;
  const first = result.children.findIndex((c) => !c.met);
  const offset = mission.unlock ? 1 : 0;
  return { stage: first >= offset ? first - offset : null, result };
}

/** One line of the mission board. */
export interface BoardEntry {
  id: string;
  rank: Mission['rank'];
  nameKey: string;
  clientKey: string;
  team: boolean;
  /** The mission's own unlock holds (the rank, the flag). */
  open: boolean;
  /** It can be started now: open, and every stage has a way. */
  startable: boolean;
  blocker: ReturnType<typeof missionBlocker>;
  forecast: MissionForecast;
}

/** The missions of the board: every mission but the operation, with what blocks it and how it would go. */
export function missionBoard(state: GameState, content: ContentDb, rules: Rules): BoardEntry[] {
  return content.missions
    .filter((m) => m.board)
    .map((m) => {
      const blocker = missionBlocker(state, m, content, rules);
      return {
        id: m.id,
        rank: m.rank,
        nameKey: `mission.${m.id}.name`,
        clientKey: `mission.${m.id}.client`,
        team: m.team,
        open: m.unlock === null || evalReq(state, m.unlock, content).met,
        startable: blocker === null,
        blocker,
        forecast: missionForecast(state, m, content, rules),
      };
    });
}
