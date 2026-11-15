import type { ContentDb, Mission, MissionPay } from '@shinobi/content';
import { effectiveLoadout } from '../combat/loadout.ts';
import { entryOf } from '../combat/zones.ts';
import { MS_PER_HOUR, rate } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod } from '../modifiers.ts';
import { evalReq, skillLevel, type ReqResult } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import { SELF, planStage, type StagePlan } from './plan.ts';
import { missionRequirements } from './run.ts';

/** How one stage is done and how it goes now, and at the next Mastery step of the technique used. */
export interface StageForecast {
  index: number;
  kind: Mission['stages'][number]['t'];
  /** Localization key of the stage's label. */
  labelKey: string;
  /** The path the game would take; null when the stage is blocked. */
  path: Pick<StagePlan, 'who' | 'skill' | 'tech' | 'slow'> | null;
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
  /** Per hour of running the mission over and over: ryo, Reputation and the XP of each skill. */
  ryoPerHour: number;
  repPerHour: number;
  xpPerHour: Record<string, number>;
  /** Every stage has a way now. */
  doable: boolean;
}

/** The skill a fight of the player's loadout earns style XP in, as far as it can be told beforehand. */
function styleGuess(state: GameState, content: ContentDb): string {
  const first = effectiveLoadout(state, content)[0];
  return (first && indexOf(content).techniques.get(first)?.skill) || 'tai';
}

/** Forecast of one mission for the player as they are now: path, time and chance of each stage, rewards, and the rates per hour. */
export function missionForecast(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): MissionForecast {
  const K = content.balance.K;
  const mods = rules.modifierProviders;
  const cap = K.missionRateCap[mission.rank as 'D' | 'C' | 'V'] ?? 0;
  const stages: StageForecast[] = [];
  const xpMs: Record<string, number> = {};
  let nominal = 0;
  let expected = 0;
  let doable = true;
  mission.stages.forEach((stage, index) => {
    const plan = planStage(state, mission, index, content, rules);
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
    const after = plan.tech !== '' ? planStage(state, mission, index, content, rules, 0, 1) : null;
    const expectedMs = plan.ms / Math.max(plan.chance, Number.EPSILON);
    nominal += plan.ms;
    expected += expectedMs;
    if (plan.who === SELF) {
      if (plan.skill !== '') {
        const level = Math.min(skillLevel(state, plan.skill as never, content), cap);
        xpMs[plan.skill] =
          (xpMs[plan.skill] ?? 0) + K.missionXpShare * rate(level, content) * expectedMs;
      } else if (stage.t === 'combat') {
        const entry = entryOf(content, stage.enemy);
        const pool = K.missionXpShare * rate(Math.min(entry?.cl ?? 0, cap), content) * expectedMs;
        const xp = K.combatXp;
        const total = xp.style + xp.vit + xp.eva;
        const style = styleGuess(state, content);
        xpMs[style] = (xpMs[style] ?? 0) + (pool * xp.style) / total;
        xpMs.vit = (xpMs.vit ?? 0) + (pool * xp.vit) / total;
        xpMs.eva = (xpMs.eva ?? 0) + (pool * xp.eva) / total;
      }
    }
    stages.push({
      index,
      kind: stage.t,
      labelKey,
      path: { who: plan.who, skill: plan.skill, tech: plan.tech, slow: plan.slow },
      ms: plan.ms,
      chance: plan.chance,
      expectedMs,
      next: after ? { ms: after.ms, chance: after.chance } : null,
    });
  });
  const ryo = Math.round(mission.ryo * computeMod(mods, state, 'mission.ryo', content).total);
  const rep = mission.team
    ? Math.round(mission.rep * computeMod(mods, state, 'mission.rep', content).total)
    : 0;
  const hours = expected / MS_PER_HOUR;
  const xpPerHour: Record<string, number> = {};
  for (const [skill, v] of Object.entries(xpMs)) {
    // `xpMs` holds XP per hour x ms; over the expected time it is the hourly rate.
    xpPerHour[skill] = expected > 0 ? v / expected : 0;
  }
  return {
    id: mission.id,
    stages,
    nominalMs: nominal,
    expectedMs: expected,
    ryo,
    rep,
    pay: mission.pay,
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
    .filter((m) => m.rank !== 'OP')
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
