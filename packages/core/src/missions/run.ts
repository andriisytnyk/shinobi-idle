import { scrollPartId, type ContentDb, type Mission } from '@shinobi/content';
import { stopSlot, type ActionKind } from '../actions.ts';
import { addCurrency, addItem, hasItem, removeCurrency, removeItem } from '../bank.ts';
import { actionsKey, bump } from '../counters.ts';
import { emit, type MissionDoneEvent } from '../events.ts';
import {
  MS_PER_HOUR,
  MS_PER_SECOND,
  SECONDS_PER_HOUR,
  masteryLevel,
  masteryXpPerHour,
  rate,
} from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod, touchMods } from '../modifiers.ts';
import { gainXp, grantMastery } from '../progression.ts';
import { skillLevel, type Req } from '../requirements.ts';
import { nextFloat } from '../rng.ts';
import type { Rules } from '../rules.ts';
import type { GameState, JsonValue } from '../state.ts';
import { currencyOf, isNature } from '../vocab.ts';
import { entryOf } from '../combat/zones.ts';
import { drainPendingResources } from '../village.ts';
import { MISSION_KIND, newMissionCombat, releaseFight } from '../combat/system.ts';
import { asPerformer } from '../performer.ts';
import { refillPouch } from '../combat/pouch.ts';
import { restartReady } from '../combat/vitality.ts';
import { payOnStop } from '../combat/pending.ts';
import type { TeamSupport } from '../combat/fight-types.ts';
import { SELF, planStage, stageBaseMs, stageReq, teammates, type StagePlan } from './plan.ts';

export { MISSION_KIND };

/** Counters the quests read. */
export const missionDoneKey = (id: string): string => `missions.done.${id}`;
export const missionRankKey = (rank: string): string => `missions.rank.${rank}`;
/** Missions finished in which the player performed a stage with a technique of this skill. */
export const missionTechKey = (skill: string): string => `missions.tech.${skill}`;
/** Stages finished, by the kind of stage. */
export const missionStageKey = (kind: string): string => `missions.stage.${kind}`;
/** Missions of a rank finished with a stage the player performed with an elemental (nature) technique. */
export const missionElementalKey = (rank: string): string => `missions.elemental.${rank}`;
export const MISSIONS_TOTAL = 'missions.total';
/** Missions finished in which the player performed a stage with an elemental (nature) technique. */
export const MISSIONS_ELEMENTAL = 'missions.elemental';

/** The localization key of the stop for lost fights, and for a stage that cannot go on. */
const TOO_HARD = 'error.missionTooHard';
const CANNOT_GO_ON = 'error.requirementsNotMet';
const RUNNING_ELSEWHERE = 'error.missionRunning';
export const NEEDS_TEAM = 'error.missionNeedsTeam';

/**
 * The state of the mission in a slot, plain JSON: `s` the stage under way, `a` the failed
 * attempts at it, `r` the ration share (negative) taken off this run, `f` the fight of a combat
 * stage (0 none, 1 running, 2 won), `w` whether the stage's time is up while its fight still
 * runs, `q` whether the stage waits for the fight to be free, `st` the skill the fight's style XP
 * goes to, `tk` the skills of the techniques the player performed in this run, and `p` how the
 * stage is done.
 */
export interface MissionRun {
  s: number;
  a: number;
  r: number;
  f: 0 | 1 | 2;
  w: 0 | 1;
  q: 0 | 1;
  st: string;
  tk: string[];
  p: StagePlan;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const whole = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;

/**
 * A saved plan, or null when it is not a usable one: every id must be one the content has (found
 * by own-property lookups only), every number in its range, and the length of an attempt within
 * the longest a stage can last.
 */
function readPlan(
  raw: unknown,
  mission: Mission,
  stage: number,
  content: ContentDb,
): StagePlan | null {
  if (!isRecord(raw)) return null;
  const K = content.balance.K;
  const { who, skill, tech, level, min, mastery, slow, intel, ms, chance } = raw;
  if (typeof who !== 'string' || typeof skill !== 'string' || typeof tech !== 'string') return null;
  if (who !== SELF && !content.team.some((t) => t.id === who)) return null;
  if (skill !== '' && !content.skills.some((s) => s.id === skill)) return null;
  if (tech !== '' && !indexOf(content).techniques.has(tech)) return null;
  if (!whole(level, 0, K.cap) || !whole(min, 0, K.cap) || !whole(mastery, 1, K.masteryCap)) {
    return null;
  }
  if (typeof slow !== 'boolean' || !whole(intel, 0, mission.skip[stage] ?? 0)) return null;
  // The longest a stage can last: its base time, slowed, and never longer than the offline cap.
  const longest = Math.min(
    K.offlineCapHours * MS_PER_HOUR,
    stageBaseMs(mission, stage) * K.mission.slowAlt * K.cap,
  );
  if (!whole(ms, 1, Math.max(1, longest)) || !num(chance) || chance < 0 || chance > 1) return null;
  return { who, skill, tech, level, min, mastery, slow, intel, ms, chance };
}

/** The run saved in a slot's data, or null when there is none or it does not fit `mission`. */
export function readRun(data: JsonValue, mission: Mission, content: ContentDb): MissionRun | null {
  if (!isRecord(data)) return null;
  const { s, a, r, f, w, q, st, tk } = data;
  if (!whole(s, 0, mission.stages.length - 1)) return null;
  if (!whole(a, 0, Number.MAX_SAFE_INTEGER) || !num(r) || r > 0 || r <= -1) return null;
  if (f !== 0 && f !== 1 && f !== 2) return null;
  if ((w !== 0 && w !== 1) || (q !== 0 && q !== 1)) return null;
  if (typeof st !== 'string' || (st !== '' && !content.skills.some((k) => k.id === st)))
    return null;
  if (!Array.isArray(tk) || tk.length > mission.stages.length) return null;
  if (!tk.every((x) => typeof x === 'string' && content.skills.some((k) => k.id === x)))
    return null;
  const p = readPlan(data.p, mission, s, content);
  return p ? { s, a, r, f, w, q, st, tk: tk as string[], p } : null;
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
    touchMods(state);
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
 * Intel of a bought stage, and starts the fight of a combat stage. If another slot owns the fight
 * the combat stage waits (`q`) and starts when the fight is free. False when the stage cannot
 * begin (no way to do it, or the items or Intel are gone); nothing is taken then.
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
  if (stage.t === 'combat' && !entry) return false;
  if (stage.t === 'items') removeItem(state, stage.item, stage.n);
  const intelCurrency = currencyOf(content, 'study');
  if (plan.intel > 0 && !reuse && intelCurrency !== null) {
    removeCurrency(state, intelCurrency, plan.intel);
  }
  const next: MissionRun = { ...run, s: index, p: plan, w: 0, q: 0, f: 0, st: '' };
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
    q: 0,
    st: '',
    tk: [],
    p: null,
  };
  return beginStage(state, at, mission, run, 0, content, rules);
}

// ---------- rewards ----------

/** What one attempt of a stage the player did earns: XP by skill, and the Mastery XP of the technique used. */
export interface StageXp {
  xp: [string, number][];
  mastery: { id: string; skill: string; amount: number } | null;
}

/** The skill a fight's style XP goes to: that of the technique last used, or the balance's default. */
export const styleSkill = (state: GameState, content: ContentDb): string =>
  state.combat?.style ?? content.balance.K.mission.defaultStyle;

/**
 * The XP and Mastery XP of one attempt of a stage the player did, before modifiers: a share of the
 * practice rate at the level of the stage (never above the mission's rate cap), by the attempt's
 * time. A combat stage pays what a fight pays, in the same proportions, at the enemy's level. A
 * teammate's stage pays nothing. `style` is the skill of the fight's style XP.
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
  const hours = plan.ms / MS_PER_SECOND / SECONDS_PER_HOUR;
  if (plan.skill !== '') {
    const skill = plan.skill;
    const level = Math.min(skillLevel(state, skill, content), mission.rateCap);
    const tech = indexOf(content).techniques.get(plan.tech);
    return {
      xp: [[skill, K.missionXpShare * rate(level, content) * hours]],
      mastery: tech
        ? {
            id: tech.id,
            skill: tech.skill,
            amount:
              K.missionXpShare *
              masteryXpPerHour(masteryLevel(state, tech.id, content), content) *
              hours,
          }
        : null,
    };
  }
  const shares = fightXpShares(mission, index, plan, content);
  if (!shares) return none;
  return { xp: [[style, shares.style], ...shares.others], mastery: null };
}

/**
 * The XP of one attempt at a combat stage, before modifiers, split as a fight splits its own: the
 * style share, whose skill depends on the techniques the player uses (it is known only when the
 * fight is over), and the shares of the skills that are paid whatever the techniques are. Null
 * for any other stage, and for a teammate's.
 */
export function fightXpShares(
  mission: Mission,
  index: number,
  plan: StagePlan,
  content: ContentDb,
): { style: number; others: [string, number][] } | null {
  if (plan.who !== SELF) return null;
  const K = content.balance.K;
  const stage = mission.stages[index];
  const entry = stage?.t === 'combat' ? entryOf(content, stage.enemy) : undefined;
  if (!entry || plan.skill !== '') return null;
  const hours = plan.ms / MS_PER_SECOND / SECONDS_PER_HOUR;
  // The weights are those of the fight's own XP: the style skill and each of the other fight skills.
  const weights: Record<string, number> = K.combatXp;
  const others = K.mission.fightSkills.filter((s) => Object.hasOwn(weights, s));
  const total = K.combatXp.style + others.reduce((sum, s) => sum + (weights[s] ?? 0), 0);
  const pool = K.missionXpShare * rate(Math.min(entry.cl, mission.rateCap), content) * hours;
  return {
    style: (pool * K.combatXp.style) / total,
    others: others.map((s): [string, number] => [s, (pool * (weights[s] ?? 0)) / total]),
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
    ? computeMod(rules, state, mission.resourceMod, content).total
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
  const mods = rules;
  const ryo = Math.round(mission.ryo * computeMod(mods, state, 'mission.ryo', content).total);
  const rep = mission.team
    ? Math.round(mission.rep * computeMod(mods, state, 'mission.rep', content).total)
    : 0;
  const money = currencyOf(content, 'money');
  const reputation = currencyOf(content, 'renown');
  const intel = currencyOf(content, 'study');
  // What is really granted, for the event.
  const granted = new Map<string, number>();
  const gotItems = new Map<string, number>();
  const credit = (currency: string, n: number): void => {
    if (addCurrency(state, currency, n) && n > 0) {
      granted.set(currency, (granted.get(currency) ?? 0) + n);
    }
  };
  if (money !== null) credit(money, ryo);
  if (reputation !== null) credit(reputation, rep);
  const items = indexOf(content).items;
  for (const pay of mission.pay) {
    if (pay.kind === 'item') {
      if (addItem(state, pay.item, pay.n)) {
        gotItems.set(pay.item, (gotItems.get(pay.item) ?? 0) + pay.n);
        emit(state, { type: 'itemGained', id: pay.item, n: pay.n });
      }
    } else if (pay.kind === 'currency') {
      credit(pay.currency, pay.n);
    } else if (pay.kind === 'intel') {
      if (intel !== null) credit(intel, pay.n);
    } else {
      const part = scrollPartId(pay.technique);
      if (items.has(part) && nextFloat(state.rng, 'loot') < (K.partDrop[pay.chance] ?? 0)) {
        addItem(state, part, 1);
        gotItems.set(part, (gotItems.get(part) ?? 0) + 1);
        emit(state, { type: 'itemGained', id: part, n: 1 });
      }
    }
  }
  let resource: MissionDoneEvent['resource'] = null;
  if (mission.resource) {
    const units = resourceUnits(state, mission, content, rules);
    const pending = state.missions.pending;
    pending[mission.resource] = (pending[mission.resource] ?? 0) + units;
    // With a village the units go straight to it; without one they wait until it appears.
    const added = drainPendingResources(state, content)[mission.resource] ?? 0;
    const waiting = state.village ? 0 : units;
    resource = { slug: mission.resource, units, added, lost: units - added - waiting, waiting };
  }
  // One finished mission is one completed action, however many stages it had.
  state.stats.completed++;
  bump(state, actionsKey(MISSION_KIND));
  bump(state, MISSIONS_TOTAL);
  bump(state, missionDoneKey(mission.id));
  bump(state, missionRankKey(mission.rank));
  const skills = [...new Set(performed)];
  for (const skill of skills) bump(state, missionTechKey(skill));
  if (skills.some((s) => isNature(content, s))) {
    bump(state, MISSIONS_ELEMENTAL);
    bump(state, missionElementalKey(mission.rank));
  }
  emit(state, {
    type: 'missionDone',
    mission: mission.id,
    ryo,
    rep,
    currencies: [...granted].map(([currency, n]) => ({ currency, n })),
    items: [...gotItems].map(([id, n]) => ({ id, n })),
    resource,
  });
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
  has: (id, content) => missionOf(content, id)?.board ?? false,

  blocked(state, id, content, _rules, slot) {
    const mission = missionOf(content, id);
    if (!mission || slot === undefined) return null;
    // The same mission cannot run in two slots at once.
    const other = state.slots.findIndex(
      (s, i) => i !== slot && s.action?.kind === MISSION_KIND && s.action.id === id,
    );
    if (other >= 0) return RUNNING_ELSEWHERE;
    // A team mission goes with the team, which exists once the nature test is passed.
    if (mission.team && state.team === null) return NEEDS_TEAM;
    // Every performer has a fight of its own: a combat stage never waits for another one's fight.
    return null;
  },

  requirements(state, id, content, rules) {
    const mission = missionOf(content, id);
    if (!mission) return null;
    const at = slotOf(state, id);
    const run = at >= 0 ? readRun(state.slots[at]?.data ?? null, mission, content) : null;
    if (!run) return missionRequirements(state, mission, 0, content, rules);
    // The stage under way is met: its items are gone, its Intel is paid, a way has been found.
    const stage = mission.stages[run.s];
    const settled = stage?.t === 'items' || run.p.intel > 0;
    return missionRequirements(state, mission, settled ? run.s + 1 : run.s, content, rules);
  },

  missing(state, id, content) {
    const mission = missionOf(content, id);
    const stage = mission?.stages.find((s) => s.t === 'items' && !hasItem(state, s.item, s.n));
    return stage?.t === 'items' ? stage.item : null;
  },

  abortCause: () => CANNOT_GO_ON,

  intervalMs(state, id, content, rules, slot) {
    const mission = missionOf(content, id);
    if (!mission) return 1;
    const run = readRun(state.slots[slot ?? slotOf(state, id)]?.data ?? null, mission, content);
    if (!run) return planStage(state, mission, 0, content, rules)?.ms ?? 1;
    if (run.q === 1) return content.balance.K.combat.xpTickMs;
    return run.w === 1 ? waitMs(content) : run.p.ms;
  },

  start(state, slot, id, content, rules) {
    const mission = missionOf(content, id);
    if (mission) beginRun(state, slot, mission, content, rules);
  },

  stop(state, slot, _id, content, rules) {
    // The fight of a combat stage ends with the mission, but only if this slot owns it; a dispelled clone is paid what it earned.
    releaseFight(state, slot, content, rules);
    payOnStop(state, slot, content, rules);
    if (state.combat?.owner === slot) state.combat = null;
  },

  complete(state, id, content, rules, slot) {
    const mission = missionOf(content, id);
    const at = slot ?? slotOf(state, id);
    if (!mission || at < 0) return 'abort';
    const run = readRun(state.slots[at]?.data ?? null, mission, content);
    // A run that cannot be read starts over. A stage is a step: only a finished mission counts.
    if (!run) return beginRun(state, at, mission, content, rules) ? 'step' : 'abort';
    const stage = mission.stages[run.s];
    if (!stage) return 'abort';
    if (run.q === 1) {
      // The stage waited for the fight to be free: begin it now if it is, else wait on.
      const entry = stage.t === 'combat' ? entryOf(content, stage.enemy) : undefined;
      if (!entry) return 'abort';
      // A stage that waits for health (after a lost try) goes on waiting until the health a player waits for is back.
      if (run.a > 0 && !restartReady(state, content)) {
        const resting = state.slots[at];
        if (resting) resting.progress = 0;
        return 'step';
      }
      // (A run saved while it waited for a free fight, before every performer had its own: it begins its fight now.)
      state.combat = newMissionCombat(
        state,
        entry,
        supportOf(state, mission, content),
        content,
        rules,
        at,
      );
      store(state, at, { ...run, q: 0, f: 1 });
      const waiting = state.slots[at];
      if (waiting) waiting.progress = 0;
      return 'step';
    }
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
    const ok = stage.t === 'items' || nextFloat(state.rng, 'action') < run.p.chance;
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
    const run = mission && slot ? readRun(slot.data, mission, content) : null;
    const style = styleSkill(state, content);
    state.combat = null;
    if (!mission || !run) return stopSlot(state, at, 'missing', content, rules);
    if (result === 'defeat') {
      // The Wounds are counted already. The stage starts over with a new fight; the stages before it stand,
      // until the fight has been lost as many times in a row as the balance allows.
      emit(state, { type: 'missionStage', mission: mission.id, stage: run.s, ok: false });
      const again = { ...run, a: run.a + 1 };
      if (again.a >= content.balance.K.mission.maxDefeats) {
        return stopSlot(state, at, 'requirements', content, rules, TOO_HARD);
      }
      // The retry waits for health first (the wait is the stage's own `q` state, one tick at a time): at the health a defeat leaves, three quick tries would be three Wounds.
      if (!restartReady(state, content)) {
        store(state, at, { ...again, q: 1, f: 0, w: 0, st: '' });
        const resting = state.slots[at];
        if (resting) resting.progress = 0;
        return;
      }
      if (!beginStage(state, at, mission, again, run.s, content, rules)) {
        stopSlot(state, at, 'requirements', content, rules, CANNOT_GO_ON);
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
      stopSlot(state, at, 'requirements', content, rules, CANNOT_GO_ON);
    }
  },
};

/** Checks a mission slot against the content after a load: a run that does not fit restarts from stage 1. */
export function repairMissions(state: GameState, content: ContentDb, rules: Rules): void {
  state.slots.forEach((slot, at) => {
    const mission =
      slot.action?.kind === MISSION_KIND ? missionOf(content, slot.action.id) : undefined;
    if (!mission) return;
    asPerformer(state, at, () => repairMission(state, slot, at, mission, content, rules));
  });
}

function repairMission(
  state: GameState,
  slot: GameState['slots'][number],
  at: number,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): void {
  {
    const run = readRun(slot.data, mission, content);
    const stage = run ? mission.stages[run.s] : undefined;
    const wanted = run?.f === 1 && stage?.t === 'combat' ? stage.enemy : null;
    // A fight belongs here only if this slot is its owner; any other fight is somebody else's.
    const fightHere = state.combat?.owner === at;
    const fightFits = wanted === null ? !fightHere : fightHere && state.combat?.enemy === wanted;
    if (run && fightFits) return;
    // A run whose fight is gone (a save of an older fight loop) keeps its stage, attempts and ration: the stage's
    // fight starts afresh. The run restarts only when no fight can be made for it.
    if (run && wanted !== null && state.combat === null) {
      const entry = entryOf(content, wanted);
      if (entry && stage?.t === 'combat') {
        state.combat = newMissionCombat(
          state,
          entry,
          supportOf(state, mission, content),
          content,
          rules,
          at,
        );
        return;
      }
    }
    if (fightHere) state.combat = null;
    slot.progress = 0;
    if (!beginRun(state, at, mission, content, rules)) {
      stopSlot(state, at, 'requirements', content, rules, CANNOT_GO_ON);
    }
  }
}
