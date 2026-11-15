import {
  NATURE_IDS,
  scrollPartId,
  type ContentDb,
  type Mission,
  type SkillId,
} from '@shinobi/content';
import { stopSlot, type ActionKind } from '../actions.ts';
import { addCurrency, addItem, hasItem, removeCurrency, removeItem } from '../bank.ts';
import { actionsKey, bump } from '../counters.ts';
import { emit } from '../events.ts';
import { MS_PER_SECOND, SECONDS_PER_HOUR, rate } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod } from '../modifiers.ts';
import { gainXp, grantMastery } from '../progression.ts';
import { skillLevel, type Req } from '../requirements.ts';
import { nextFloat } from '../rng.ts';
import type { Rules } from '../rules.ts';
import type { GameState, JsonValue } from '../state.ts';
import { entryOf } from '../combat/zones.ts';
import { drainPendingResources } from '../village.ts';
import { MISSION_KIND, fightBusy, fightBusyReason, newMissionCombat } from '../combat/system.ts';
import { refillPouch } from '../combat/pouch.ts';
import type { TeamSupport } from '../combat/fight-types.ts';
import { SELF, planStage, stageReq, teammates, type StagePlan } from './plan.ts';

export { MISSION_KIND };

/** Counters the quests read. */
export const missionDoneKey = (id: string): string => `missions.done.${id}`;
export const missionRankKey = (rank: string): string => `missions.rank.${rank}`;
/** Missions finished in which the player performed a stage with a technique of this skill. */
export const missionTechKey = (skill: string): string => `missions.tech.${skill}`;
/** Stages finished, by the kind of stage. */
export const missionStageKey = (kind: string): string => `missions.stage.${kind}`;
export const MISSIONS_TOTAL = 'missions.total';
/** Missions finished in which the player performed a stage with an elemental (nature) technique. */
export const MISSIONS_ELEMENTAL = 'missions.elemental';
/** Village missions finished with an elemental stage the player performed. */
export const MISSIONS_VILLAGE_ELEMENTAL = 'missions.village.elemental';

/**
 * The state of the mission in a slot, plain JSON: `s` the stage under way, `a` the failed attempts
 * at it, `r` the ration share (negative) taken off this run, `f` the fight of a combat stage (0
 * none, 1 running, 2 won), `w` whether the stage's time is up while its fight still runs, `st` the
 * skill the fight's style XP goes to, `tk` the skills of the techniques the player performed in
 * this run, and `p` how the stage is done.
 */
export interface MissionRun {
  s: number;
  a: number;
  r: number;
  f: 0 | 1 | 2;
  w: 0 | 1;
  st: string;
  tk: string[];
  p: StagePlan;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A saved plan, or null when it is not a usable one. */
function readPlan(raw: unknown): StagePlan | null {
  if (!isRecord(raw)) return null;
  const { who, skill, tech, level, min, mastery, slow, intel, ms, chance } = raw;
  if (typeof who !== 'string' || typeof skill !== 'string' || typeof tech !== 'string') return null;
  if (!num(level) || !num(min) || !num(mastery) || typeof slow !== 'boolean') return null;
  if (!num(intel) || !Number.isInteger(intel) || intel < 0) return null;
  if (!num(ms) || !Number.isInteger(ms) || ms < 1 || !num(chance) || chance < 0 || chance > 1) {
    return null;
  }
  return { who, skill, tech, level, min, mastery, slow, intel, ms, chance };
}

/** The run saved in a slot's data, or null when there is none or it does not fit `mission`. */
export function readRun(data: JsonValue, mission: Mission): MissionRun | null {
  if (!isRecord(data)) return null;
  const { s, a, r, f, w, st, tk } = data;
  if (!num(s) || !Number.isInteger(s) || s < 0 || s >= mission.stages.length) return null;
  if (!num(a) || !Number.isInteger(a) || a < 0 || !num(r) || r > 0 || r <= -1) return null;
  if (f !== 0 && f !== 1 && f !== 2) return null;
  if ((w !== 0 && w !== 1) || typeof st !== 'string') return null;
  if (!Array.isArray(tk) || !tk.every((x) => typeof x === 'string')) return null;
  const p = readPlan(data.p);
  return p ? { s, a, r, f, w, st, tk: tk as string[], p } : null;
}

const missionOf = (content: ContentDb, id: string): Mission | undefined =>
  indexOf(content).missions.get(id);

/** Index of the slot running this mission, or -1. */
function slotOf(state: GameState, id: string): number {
  return state.slots.findIndex((x) => x.action?.kind === MISSION_KIND && x.action.id === id);
}

/** The supports of the team in a team mission's fight: each teammate with the nature of the team selector. */
function supportOf(state: GameState, mission: Mission, content: ContentDb): TeamSupport[] {
  if (!mission.team) return [];
  const { everyMs, damage } = content.balance.K.team.support;
  return teammates(state, content).map((m) => ({ nature: m.nature, everyMs, damage }));
}

/** Takes a ration from the buffs, when one is armed: the share it takes off the next mission (0 without). */
function spendRation(state: GameState, content: ContentDb): number {
  const items = indexOf(content).items;
  for (const [id, buff] of Object.entries(state.buffs)) {
    const fx = items.get(id)?.fx;
    if (fx?.kind !== 'ration' || buff.charges < 1) continue;
    buff.charges -= 1;
    if (buff.charges < 1) delete state.buffs[id];
    return fx.duration;
  }
  return 0;
}

const store = (state: GameState, at: number, run: MissionRun): void => {
  const slot = state.slots[at];
  if (slot) slot.data = run as unknown as JsonValue;
};

type NewRun = Omit<MissionRun, 'p'> & { p: StagePlan | null };

/**
 * Starts stage `index` of `run` in slot `at`: works out how it is done (`reuse` keeps the plan of
 * a repeated attempt that was paid for with Intel), takes the items of an items stage and the
 * Intel of a bought stage, and starts the fight of a combat stage. False when it cannot begin (no
 * way to do it, the items or Intel are gone, or another slot owns a fight); nothing is taken then.
 */
function beginStage(
  state: GameState,
  at: number,
  mission: Mission,
  run: NewRun,
  index: number,
  content: ContentDb,
  rules: Rules,
  reuse: StagePlan | null = null,
): boolean {
  const slot = state.slots[at];
  const stage = mission.stages[index];
  if (!slot || !stage) return false;
  const plan = reuse ?? planStage(state, mission, index, content, rules, run.r);
  if (!plan) return false;
  if (stage.t === 'items' && !hasItem(state, stage.item, stage.n)) return false;
  const entry = stage.t === 'combat' ? entryOf(content, stage.enemy) : undefined;
  if (stage.t === 'combat' && (!entry || fightBusy(state, at))) return false;
  if (stage.t === 'items') removeItem(state, stage.item, stage.n);
  if (plan.intel > 0 && !reuse) removeCurrency(state, 'intel', plan.intel);
  const next: MissionRun = { ...run, s: index, p: plan, w: 0, f: 0, st: '' };
  if (entry) {
    state.combat = newMissionCombat(
      state,
      entry,
      supportOf(state, mission, content),
      content,
      rules,
      at,
    );
    next.f = 1;
  }
  store(state, at, next);
  slot.progress = 0;
  return true;
}

/** Begins a new run from stage 0 (a ration is spent here). False when stage 0 cannot begin. */
function beginRun(
  state: GameState,
  at: number,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): boolean {
  const run: NewRun = {
    s: 0,
    a: 0,
    r: spendRation(state, content),
    f: 0,
    w: 0,
    st: '',
    tk: [],
    p: null,
  };
  return beginStage(state, at, mission, run, 0, content, rules);
}

// ---------- rewards ----------

/** What one attempt of a stage the player did earns: XP by skill, and the Mastery XP of the technique used. */
export interface StageXp {
  xp: [SkillId, number][];
  mastery: { id: string; skill: SkillId; amount: number } | null;
}

/**
 * The XP and Mastery XP of one attempt of a stage the player did, before modifiers: a share of the
 * practice rate at the level of the stage (never above the rank's cap), by the attempt's time. A
 * combat stage pays what a fight pays, in the same proportions, at the enemy's level. A teammate's
 * stage pays nothing. `style` is the skill of the fight's style XP.
 */
export function stageXp(
  state: GameState,
  mission: Mission,
  index: number,
  plan: StagePlan,
  style: string,
  content: ContentDb,
): StageXp {
  const none: StageXp = { xp: [], mastery: null };
  if (plan.who !== SELF) return none;
  const K = content.balance.K;
  const cap = K.missionRateCap[mission.rank as 'D' | 'C' | 'V'] ?? 0;
  const hours = plan.ms / MS_PER_SECOND / SECONDS_PER_HOUR;
  if (plan.skill !== '') {
    const skill = plan.skill as SkillId;
    const level = Math.min(skillLevel(state, skill, content), cap);
    const tech = indexOf(content).techniques.get(plan.tech);
    return {
      xp: [[skill, K.missionXpShare * rate(level, content) * hours]],
      mastery: tech
        ? { id: tech.id, skill: tech.skill, amount: K.missionXpShare * K.masteryPerHour * hours }
        : null,
    };
  }
  const stage = mission.stages[index];
  const entry = stage?.t === 'combat' ? entryOf(content, stage.enemy) : undefined;
  if (!entry) return none;
  const xp = K.combatXp;
  const total = xp.style + xp.vit + xp.eva;
  const pool = K.missionXpShare * rate(Math.min(entry.cl, cap), content) * hours;
  return {
    xp: [
      [style as SkillId, (pool * xp.style) / total],
      ['vit', (pool * xp.vit) / total],
      ['eva', (pool * xp.eva) / total],
    ],
    mastery: null,
  };
}

/** Pays the XP of one attempt of a stage. */
function payStageXp(
  state: GameState,
  mission: Mission,
  index: number,
  plan: StagePlan,
  style: string,
  content: ContentDb,
  rules: Rules,
): void {
  const earned = stageXp(state, mission, index, plan, style, content);
  for (const [skill, amount] of earned.xp) gainXp(state, skill, amount, content, rules);
  if (earned.mastery) {
    const { id, skill, amount } = earned.mastery;
    grantMastery(state, id, skill, amount, content, rules);
  }
}

/** The village resource units a finished mission brings: the balance's units scaled by the modifier its data names. */
export function resourceUnits(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): number {
  if (!mission.resource) return 0;
  const mod = mission.resourceMod
    ? computeMod(rules.modifierProviders, state, mission.resourceMod, content).total
    : 1;
  return Math.round(content.balance.K.shinobiResPerMission * mod);
}

/**
 * Pays a finished mission: ryo, Reputation (team missions), payment in kind, Intel, a scroll part,
 * village resource units; counts it. `performed` lists the skills of the techniques the player
 * performed a stage with, for the counters.
 */
export function payMission(
  state: GameState,
  mission: Mission,
  performed: readonly string[],
  content: ContentDb,
  rules: Rules,
): void {
  const K = content.balance.K;
  const mods = rules.modifierProviders;
  const ryo = Math.round(mission.ryo * computeMod(mods, state, 'mission.ryo', content).total);
  const rep = mission.team
    ? Math.round(mission.rep * computeMod(mods, state, 'mission.rep', content).total)
    : 0;
  addCurrency(state, 'ryo', ryo);
  addCurrency(state, 'rep', rep);
  const items = indexOf(content).items;
  for (const pay of mission.pay) {
    if (pay.kind === 'item') {
      if (addItem(state, pay.item, pay.n)) {
        emit(state, { type: 'itemGained', id: pay.item, n: pay.n });
      }
    } else if (pay.kind === 'intel') {
      addCurrency(state, 'intel', pay.n);
    } else {
      const part = scrollPartId(pay.technique);
      if (items.has(part) && nextFloat(state.rng, 'loot') < K.partDrop.mission) {
        addItem(state, part, 1);
        emit(state, { type: 'itemGained', id: part, n: 1 });
      }
    }
  }
  if (mission.resource) {
    const pending = state.missions.pending;
    pending[mission.resource] =
      (pending[mission.resource] ?? 0) + resourceUnits(state, mission, content, rules);
    // With a village the units go straight to it; without one they wait until it appears.
    drainPendingResources(state, content);
  }
  // One finished mission is one completed action, however many stages it had.
  state.stats.completed++;
  bump(state, actionsKey(MISSION_KIND));
  bump(state, MISSIONS_TOTAL);
  bump(state, missionDoneKey(mission.id));
  bump(state, missionRankKey(mission.rank));
  const skills = [...new Set(performed)];
  for (const skill of skills) bump(state, missionTechKey(skill));
  const elemental = skills.some((s) => (NATURE_IDS as readonly string[]).includes(s));
  if (elemental) {
    bump(state, MISSIONS_ELEMENTAL);
    if (mission.rank === 'V') bump(state, MISSIONS_VILLAGE_ELEMENTAL);
  }
  emit(state, { type: 'missionDone', mission: mission.id, ryo, rep });
}

// ---------- requirements ----------

/** What the mission needs from stage `from` on: that it opens (a run not yet begun), and a way to do each stage. */
export function missionRequirements(
  state: GameState,
  mission: Mission,
  from: number,
  content: ContentDb,
  rules: Rules,
): Req {
  const of: Req[] = [];
  if (from === 0 && mission.unlock) of.push(mission.unlock);
  for (let i = from; i < mission.stages.length; i++) {
    of.push(stageReq(state, mission, i, content, rules));
  }
  return { t: 'all', of };
}

// ---------- the action kind ----------

/** Time to wait for a fight that outlasts its stage, ms: the longest a fight can last. */
const waitMs = (content: ContentDb): number => content.balance.K.combat.fightCapMs;

/** Ends the stage in progress as done: goes on to the next, or pays the mission and starts it over. */
function advanceStage(
  state: GameState,
  at: number,
  mission: Mission,
  run: MissionRun,
  content: ContentDb,
  rules: Rules,
): boolean {
  const next = run.s + 1;
  const stage = mission.stages[run.s];
  if (stage) bump(state, missionStageKey(stage.t));
  const tk = run.p.who === SELF && run.p.tech !== '' ? [...run.tk, run.p.skill] : run.tk;
  if (next < mission.stages.length) {
    return beginStage(state, at, mission, { ...run, a: 0, tk }, next, content, rules);
  }
  payMission(state, mission, tk, content, rules);
  return beginRun(state, at, mission, content, rules);
}

export const missionKind: ActionKind = {
  has: (id, content) => {
    const m = missionOf(content, id);
    return m !== undefined && m.rank !== 'OP';
  },

  blocked(state, id, content, _rules, slot) {
    // A combat stage needs the fight to be free when it comes; say so at the start if it is not.
    const mission = missionOf(content, id);
    return mission?.stages.some((s) => s.t === 'combat') ? fightBusyReason(state, slot) : null;
  },

  requirements(state, id, content, rules) {
    const mission = missionOf(content, id);
    if (!mission) return null;
    const at = slotOf(state, id);
    const run = at >= 0 ? readRun(state.slots[at]?.data ?? null, mission) : null;
    if (!run) return missionRequirements(state, mission, 0, content, rules);
    // The items of the stage under way are gone already, and what it needs has its plan.
    const stage = mission.stages[run.s];
    return missionRequirements(
      state,
      mission,
      stage?.t === 'items' ? run.s + 1 : run.s,
      content,
      rules,
    );
  },

  missing(state, id, content) {
    const mission = missionOf(content, id);
    const stage = mission?.stages.find((s) => s.t === 'items' && !hasItem(state, s.item, s.n));
    return stage?.t === 'items' ? stage.item : null;
  },

  intervalMs(state, id, content, rules, slot) {
    const mission = missionOf(content, id);
    if (!mission) return 1;
    const run = readRun(state.slots[slot ?? slotOf(state, id)]?.data ?? null, mission);
    if (!run) return planStage(state, mission, 0, content, rules)?.ms ?? 1;
    return run.w === 1 ? waitMs(content) : run.p.ms;
  },

  start(state, slot, id, content, rules) {
    const mission = missionOf(content, id);
    if (mission) beginRun(state, slot, mission, content, rules);
  },

  stop(state, slot) {
    // The fight of a combat stage ends with the mission, but only if this slot owns it.
    if (state.combat?.owner === slot) state.combat = null;
  },

  complete(state, id, content, rules, slot) {
    const mission = missionOf(content, id);
    const at = slot ?? slotOf(state, id);
    if (!mission || at < 0) return 'abort';
    const run = readRun(state.slots[at]?.data ?? null, mission);
    // A run that cannot be read starts over. A stage is a step: only a finished mission counts.
    if (!run) return beginRun(state, at, mission, content, rules) ? 'step' : 'abort';
    const stage = mission.stages[run.s];
    if (!stage) return 'abort';
    if (stage.t === 'combat') {
      if (run.f !== 2) {
        // The stage's time is up, but it ends with its fight, which still goes on.
        store(state, at, { ...run, w: 1 });
        return 'step';
      }
      emit(state, { type: 'missionStage', mission: mission.id, stage: run.s, ok: true });
      payStageXp(state, mission, run.s, run.p, run.st, content, rules);
      return advanceStage(state, at, mission, run, content, rules) ? 'step' : 'abort';
    }
    const ok = stage.t === 'items' || nextFloat(state.rng, 'world') < run.p.chance;
    emit(state, { type: 'missionStage', mission: mission.id, stage: run.s, ok });
    payStageXp(state, mission, run.s, run.p, '', content, rules);
    if (ok) return advanceStage(state, at, mission, run, content, rules) ? 'step' : 'abort';
    // A failed attempt repeats the stage; nothing is lost but the time (a stage bought with Intel stays bought).
    const again = { ...run, a: run.a + 1 };
    const reuse = run.p.intel > 0 ? run.p : null;
    return beginStage(state, at, mission, again, run.s, content, rules, reuse) ? 'step' : 'abort';
  },

  combatEnded(state, at, result, content, rules) {
    const slot = state.slots[at];
    const mission = slot?.action ? missionOf(content, slot.action.id) : undefined;
    const run = mission && slot ? readRun(slot.data, mission) : null;
    const style = state.combat?.style ?? 'tai';
    state.combat = null;
    if (!mission || !run) return stopSlot(state, at, 'missing', content, rules);
    if (result === 'defeat') {
      // The Wounds are counted already. The stage starts over with a new fight; the stages before it stand.
      emit(state, { type: 'missionStage', mission: mission.id, stage: run.s, ok: false });
      const again = { ...run, a: run.a + 1 };
      if (!beginStage(state, at, mission, again, run.s, content, rules)) {
        stopSlot(state, at, 'defeated', content, rules);
      }
      return;
    }
    // After a won fight the pouch is topped up from the bank, as after any fight.
    refillPouch(state, content);
    if (run.w === 0) {
      // Won within the stage's time: the stage ends when its time does.
      store(state, at, { ...run, f: 2, st: style });
      return;
    }
    emit(state, { type: 'missionStage', mission: mission.id, stage: run.s, ok: true });
    payStageXp(state, mission, run.s, run.p, style, content, rules);
    if (!advanceStage(state, at, mission, run, content, rules)) {
      stopSlot(state, at, 'requirements', content, rules);
    }
  },
};

/** Checks a mission slot against the content after a load: a run that does not fit restarts from stage 1. */
export function repairMissions(state: GameState, content: ContentDb, rules: Rules): void {
  state.slots.forEach((slot, at) => {
    const mission =
      slot.action?.kind === MISSION_KIND ? missionOf(content, slot.action.id) : undefined;
    if (!mission) return;
    const run = readRun(slot.data, mission);
    const stage = run ? mission.stages[run.s] : undefined;
    const wanted = run?.f === 1 && stage?.t === 'combat' ? stage.enemy : null;
    // A fight belongs here only if this slot is its owner; any other fight is somebody else's.
    const fightHere = state.combat?.owner === at;
    const fightFits = wanted === null ? !fightHere : fightHere && state.combat?.enemy === wanted;
    if (run && fightFits) return;
    if (fightHere) state.combat = null;
    slot.progress = 0;
    if (!beginRun(state, at, mission, content, rules)) {
      stopSlot(state, at, 'requirements', content, rules);
    }
  });
}
