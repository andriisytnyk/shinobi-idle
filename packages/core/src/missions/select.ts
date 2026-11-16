import type { ContentDb, Mission, MissionPay } from '@shinobi/content';
import { scrollPartId } from '@shinobi/content';
import { hasItem } from '../bank.ts';
import { isCloneSlot } from '../clone.ts';
import { fightBusyReason, isCombatKind } from '../combat/system.ts';
import { effectiveLoadout } from '../combat/loadout.ts';
import { MS_PER_HOUR, masteryLevel } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod, type Modifier } from '../modifiers.ts';
import { xpGain } from '../progression.ts';
import { evalReq, skillLevel, type Req, type ReqResult } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import { startRefusal } from '../start-check.ts';
import type { GameState } from '../state.ts';
import { currencyOf } from '../vocab.ts';
import { buildingLevel } from '../village-state.ts';
import { planStage, planStageParts, stageReq, type DurationParts, type StagePlan } from './plan.ts';
import { armedRation, rationItems, type RationItem } from './ration.ts';
import {
  MISSION_KIND,
  NEEDS_TEAM,
  fightXpShares,
  missionRequirements,
  resourceUnits,
  stageXp,
} from './run.ts';

/**
 * What one attempt at a stage gives the player. `lines` are the XP by skill: a skill stage pays its
 * skill, a fight pays the skills it always pays (as the grant adds it, bonuses counted, `certain`)
 * and its style share, whose skill depends on the techniques used and is known only when the fight
 * is over (`skill` null, `certain` false). Every amount has the bonuses that hold for any skill
 * (`xp.all`) and the fixed skills their own too; the style share cannot have the bonus of a skill
 * it does not know yet. `fight` is the whole of a fight's XP counted the same way. A stage a teammate does pays the player nothing.
 */
export interface StageXpForecast {
  lines: { skill: string | null; amount: number; certain: boolean }[];
  fight: { total: number; skills: string[] } | null;
  /** The technique whose Mastery grows. */
  mastery: string | null;
}

/** How one stage is done and how it goes now, and at the next Mastery step of the technique used. */
export interface StageForecast {
  index: number;
  kind: Mission['stages'][number]['t'];
  /** Localization key of the stage's label. */
  labelKey: string;
  /** The way the game would take, with the level it was met at, the requirement and the Mastery used; null when the stage is blocked. */
  path: Pick<
    StagePlan,
    'who' | 'skill' | 'tech' | 'slow' | 'intel' | 'level' | 'min' | 'mastery'
  > | null;
  /** Length of one attempt, ms, and the chance an attempt succeeds. */
  ms: number;
  chance: number;
  /** What the length is made of: the factors multiply out to `ms`; null when the stage is blocked. */
  duration: DurationParts | null;
  /** Expected time with the repeats of failed attempts, ms. */
  expectedMs: number;
  /** What one attempt gives the player. */
  xp: StageXpForecast;
  /** The same at the next Mastery level of the technique; null when no technique is used. */
  next: { ms: number; chance: number } | null;
}

/** Everything a finished mission can give. */
export interface MissionRewards {
  /** Currencies after the modifiers, in the order of the content: the money, Reputation (team missions only, `rule`), Intel and any currency the mission pays. */
  currencies: { currency: string; role: string | null; n: number; rule: 'team' | null }[];
  /** Items with their counts and the chance of each (a scroll part is a chance of one part). */
  items: { item: string; n: number; chance: number }[];
  /** Village resource units after the modifiers; null for none. */
  resource: { slug: string; units: number } | null;
  /** What a ration takes off the mission: the armed share (negative; 0 with none), and every ration of the content. */
  ration: { share: number; items: RationItem[] };
}

export interface MissionForecast {
  id: string;
  stages: StageForecast[];
  /** The mission's length with no failed attempt, and with them as expected, ms. */
  nominalMs: number;
  expectedMs: number;
  /** The chance that one run goes with no failed attempt: the stages' chances multiplied (0 when a stage has no way). */
  cleanChance: number;
  /** What it pays: ryo and Reputation after the modifiers, and the payments in kind. */
  ryo: number;
  rep: number;
  pay: MissionPay[];
  /** Village resource: the slug and the units one finished mission brings after the modifiers; null for none. */
  resource: { slug: string; units: number } | null;
  /** Everything it can give, for the interface to list. */
  rewards: MissionRewards;
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
  /** Per hour of running the mission over and over: ryo, Reputation and the XP of each skill that is certain (what is really added, caps and slowdowns counted). */
  ryoPerHour: number;
  repPerHour: number;
  xpPerHour: Record<string, number>;
  /** Per hour: the whole XP of the fights, the style share included (with the bonuses common to every skill), whichever skill it goes to. */
  fightXpPerHour: number;
  /** Every stage has a way now. */
  doable: boolean;
}

/** What one attempt at stage `index` gives, from its plan. */
function stageXpForecast(
  state: GameState,
  mission: Mission,
  index: number,
  plan: StagePlan,
  content: ContentDb,
  rules: Rules,
): StageXpForecast {
  const fight = fightXpShares(mission, index, plan, content);
  if (fight) {
    const common = computeMod(rules.modifierProviders, state, 'xp.all', content).total;
    const style = fight.style * common;
    const lines: StageXpForecast['lines'] = [{ skill: null, amount: style, certain: false }];
    for (const [skill, amount] of fight.others) {
      lines.push({ skill, amount: xpGain(state, skill, amount, content, rules), certain: true });
    }
    return {
      lines,
      fight: {
        total: lines.reduce((sum, l) => sum + l.amount, 0),
        skills: fight.others.map(([skill]) => skill),
      },
      mastery: null,
    };
  }
  const earned = stageXp(state, mission, index, plan, '', content);
  return {
    lines: earned.xp.map(([skill, amount]) => ({
      skill,
      amount: xpGain(state, skill, amount, content, rules),
      certain: true,
    })),
    fight: null,
    mastery: earned.mastery?.id ?? null,
  };
}

/** What the mission can give, from the figures the forecast has worked out. */
function rewardsOf(
  state: GameState,
  mission: Mission,
  ryo: number,
  rep: number,
  resource: MissionForecast['resource'],
  content: ContentDb,
): MissionRewards {
  const money = currencyOf(content, 'money');
  const renown = currencyOf(content, 'renown');
  const study = currencyOf(content, 'study');
  const amounts = new Map<string, number>();
  const add = (currency: string | null, n: number): void => {
    if (currency !== null && n > 0) amounts.set(currency, (amounts.get(currency) ?? 0) + n);
  };
  add(money, ryo);
  add(renown, rep);
  const items: MissionRewards['items'] = [];
  const known = indexOf(content).items;
  for (const pay of mission.pay) {
    if (pay.kind === 'item') items.push({ item: pay.item, n: pay.n, chance: 1 });
    else if (pay.kind === 'intel') add(study, pay.n);
    else if (pay.kind === 'currency') add(pay.currency, pay.n);
    else {
      const part = scrollPartId(pay.technique);
      if (known.has(part)) {
        items.push({ item: part, n: 1, chance: content.balance.K.partDrop[pay.chance] ?? 0 });
      }
    }
  }
  return {
    currencies: content.currencies.flatMap((c) => {
      const n = amounts.get(c.id) ?? 0;
      return n > 0
        ? [
            {
              currency: c.id,
              role: c.role ?? null,
              n,
              rule: c.id === renown ? ('team' as const) : null,
            },
          ]
        : [];
    }),
    items,
    resource,
    ration: { share: armedRation(state, content), items: rationItems(state, content) },
  };
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
  const stages: StageForecast[] = [];
  const xpAmount: Record<string, number> = {};
  let fightXp = 0;
  let nominal = 0;
  let expected = 0;
  let doable = true;
  mission.stages.forEach((stage, index) => {
    const found = planStageParts(state, mission, index, content, rules, ration);
    const labelKey = `mission.${mission.id}.stage.${index}.label`;
    if (!found) {
      doable = false;
      stages.push({
        index,
        kind: stage.t,
        labelKey,
        path: null,
        ms: 0,
        chance: 0,
        duration: null,
        expectedMs: 0,
        xp: { lines: [], fight: null, mastery: null },
        next: null,
      });
      return;
    }
    const { plan, parts } = found;
    const after =
      plan.tech !== '' ? planStage(state, mission, index, content, rules, ration, 1) : null;
    const attempts = 1 / Math.max(plan.chance, Number.EPSILON);
    nominal += plan.ms;
    expected += plan.ms * attempts;
    const xp = stageXpForecast(state, mission, index, plan, content, rules);
    // The XP of an attempt as the grant would add it, once per expected attempt.
    for (const line of xp.lines) {
      if (line.certain && line.skill !== null) {
        xpAmount[line.skill] = (xpAmount[line.skill] ?? 0) + line.amount * attempts;
      }
    }
    if (xp.fight) fightXp += xp.fight.total * attempts;
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
        level: plan.level,
        min: plan.min,
        mastery: plan.mastery,
      },
      ms: plan.ms,
      chance: plan.chance,
      duration: parts,
      expectedMs: plan.ms * attempts,
      xp,
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
  const resource = mission.resource
    ? { slug: mission.resource, units: resourceUnits(state, mission, content, rules) }
    : null;
  return {
    id: mission.id,
    stages,
    nominalMs: nominal,
    expectedMs: expected,
    cleanChance: stages.reduce((p, s) => p * s.chance, 1),
    ryo,
    rep,
    pay: mission.pay,
    resource,
    rewards: rewardsOf(state, mission, ryo, rep, resource, content),
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
    fightXpPerHour: hours > 0 ? fightXp / hours : 0,
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

/** The first unmet leaf of a requirement result, depth first: the one thing to do next. */
export function firstUnmetLeaf(node: ReqResult): ReqResult | null {
  if (node.met) return null;
  for (const child of node.children) {
    const found = firstUnmetLeaf(child);
    if (found) return found;
  }
  return node.children.length === 0 ? node : null;
}

/**
 * The tree a mission pinned as the goal shows: its own unlock (when it has one, met or not, so
 * the tree reads as a whole), then the first stage whose requirement is not met: with every way
 * that would do, the technique conditions of a nature included, or the items an items stage
 * takes. Later stages are left out until this one is done. A missing team is not a requirement
 * of the tree (the start refusal `error.missionNeedsTeam` says it).
 */
export function missionGoalReq(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): Req {
  const of: Req[] = [];
  if (mission.unlock) of.push(mission.unlock);
  for (let i = 0; i < mission.stages.length; i++) {
    const req = stageReq(state, mission, i, content, rules);
    if (!evalReq(state, req, content).met) {
      of.push(req);
      break;
    }
  }
  return { t: 'all', of };
}

// ---------- when a forecast is stale ----------

/**
 * A cheap digest of everything a mission forecast and its blocker read, for a caller that keeps
 * forecasts and recomputes them when this changes: every modifier the rule set's providers give
 * now (so gear, tonics, the village, the world and any pack's modifiers are in it without being
 * named), the levels of the skills, the Mastery of the techniques known, the rank, the natures,
 * the team, the loadout, the flags, the levels of the buildings, every currency, and the items
 * the stages take and the rations, with the armed ration. Slots are not in it: a caller reads
 * the slot rules live.
 */
export function missionInputs(state: GameState, content: ContentDb, rules: Rules): string {
  const parts: (string | number)[] = [state.player.rank];
  for (const m of rules.modifierProviders.flatMap((p) => p(state, content))) {
    parts.push(`${m.key}${m.op}${m.value}${m.group}`);
  }
  for (const skill of content.skills) parts.push(skillLevel(state, skill.id, content));
  for (const id of Object.keys(state.known)) parts.push(masteryLevel(state, id, content));
  parts.push(state.player.natures.join(','), JSON.stringify(state.team));
  parts.push(effectiveLoadout(state, content).join(','), JSON.stringify(state.flags));
  for (const b of content.buildings) parts.push(buildingLevel(state, b.id));
  for (const c of content.currencies) parts.push(state.currencies[c.id] ?? 0);
  const items = new Set<string>(rationItems(state, content).map((r) => r.id));
  for (const m of content.missions) {
    for (const stage of m.stages) if (stage.t === 'items') items.add(stage.item);
  }
  for (const id of items) parts.push(state.bank[id] ?? 0, state.buffs[id]?.charges ?? 0);
  return parts.join('|');
}

// ---------- can it be started ----------

/** The slot a mission is started in: the first one with nothing in it, else the first slot. */
export function missionStartSlot(state: GameState, content?: ContentDb): number {
  // With the content, a clone's slot is not the player's: it is asked for on its own.
  const free = state.slots.findIndex(
    (s, i) => s.action === null && !(content && isCloneSlot(state, content, i)),
  );
  return free >= 0 ? free : 0;
}

/** Why `dispatch` refuses to start a mission: the localization key, and what the interface needs to explain it. */
export interface MissionRefusal {
  reason: string;
  /** The action in another slot that refuses (the same mission under way: `error.missionRunning`; the one that holds the fight: `error.fightBusy`). */
  by: { slot: number; kind: string; id: string } | null;
  /** The items the stages take that the player lacks, with what is held and needed (`error.missingIngredient`). */
  missing: { item: string; have: number; need: number }[];
  /** What blocks the mission: the stage (null for its unlock) and the requirement tree with its first unmet leaf; null when the refusal is not a requirement. */
  blocker: { stage: number | null; result: ReqResult; first: ReqResult | null } | null;
  /** The mission's own unlock (the rank) evaluated, when it is what is closed. */
  unlock: ReqResult | null;
}

/** The answer `dispatch` would give to starting a mission in `slot` now. */
export interface MissionStatus {
  /** The slot asked about. */
  slot: number;
  /** The slot that runs this mission now; -1 when it does not run. */
  runningAt: number;
  startable: boolean;
  refusal: MissionRefusal | null;
}

/** The other slot that makes `reason` for a mission started in `slot`. */
function holderOf(
  state: GameState,
  slot: number,
  mission: Mission,
  reason: string,
  content: ContentDb,
): MissionRefusal['by'] {
  const missions = indexOf(content).missions;
  for (const [index, other] of state.slots.entries()) {
    const action = other.action;
    if (index === slot || !action) continue;
    if (reason === 'error.missionRunning') {
      if (action.kind === MISSION_KIND && action.id === mission.id) {
        return { slot: index, kind: action.kind, id: action.id };
      }
    } else if (reason === fightBusyReason(state, slot, content)) {
      // A mission with a combat stage ahead holds the fight too, even while it is not fighting.
      const holds =
        action.kind === MISSION_KIND &&
        (missions.get(action.id)?.stages.some((s) => s.t === 'combat') ?? false);
      if (isCombatKind(action.kind) || holds) {
        return { slot: index, kind: action.kind, id: action.id };
      }
    }
  }
  return null;
}

/**
 * What `dispatch({ type: 'action.start', slot, kind: 'mission', id })` would answer now: startable,
 * or the exact refusal with its parameters. It runs the command's own checks (`startRefusal`), so
 * the slot rules (`error.missionRunning`, `error.fightBusy`), the team, the missing items and the
 * closed rank are those the command gives. `blocker` is `missionBlocker`'s answer when the caller
 * has it from a moment ago (a board refreshed at a coarse rate); the slot rules are always read live.
 */
export function missionStatus(
  state: GameState,
  missionId: string,
  slot: number,
  content: ContentDb,
  rules: Rules,
  blocker?: ReturnType<typeof missionBlocker>,
): MissionStatus {
  const mission = indexOf(content).missions.get(missionId);
  const runningAt = state.slots.findIndex(
    (s) => s.action?.kind === MISSION_KIND && s.action.id === missionId,
  );
  const refusal =
    blocker !== undefined && mission && runningAt < 0
      ? startRefusal(state, slot, MISSION_KIND, missionId, content, rules, blocker?.result ?? null)
      : startRefusal(state, slot, MISSION_KIND, missionId, content, rules);
  if (!refusal) return { slot, runningAt, startable: true, refusal: null };
  // What blocks the mission by its requirements is reported with a requirement refusal and with a missing team (the team is only the first thing dispatch names); a slot rule is reported alone.
  const requirement = refusal.req !== undefined || refusal.reason === NEEDS_TEAM;
  const found =
    requirement && mission
      ? blocker !== undefined
        ? blocker
        : missionBlocker(state, mission, content, rules)
      : null;
  return {
    slot,
    runningAt,
    startable: false,
    refusal: {
      reason: refusal.reason,
      by: mission ? holderOf(state, slot, mission, refusal.reason, content) : null,
      missing:
        requirement && mission
          ? mission.stages.flatMap((s) =>
              s.t === 'items' && !hasItem(state, s.item, s.n)
                ? [{ item: s.item, have: state.bank[s.item] ?? 0, need: s.n }]
                : [],
            )
          : [],
      blocker: found
        ? { stage: found.stage, result: found.result, first: firstUnmetLeaf(found.result) }
        : null,
      unlock: requirement && mission?.unlock ? evalReq(state, mission.unlock, content) : null,
    },
  };
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
  /** The mission's own unlock requirement evaluated, as the content gives it for this mission; null when it has none. */
  unlock: ReqResult | null;
  /** It can be started now in the slot a start would use. */
  startable: boolean;
  /** The answer `dispatch` would give for the slot a start would use. */
  status: MissionStatus;
  blocker: ReturnType<typeof missionBlocker>;
  forecast: MissionForecast;
}

/** The board line of one mission. */
export function missionEntry(
  state: GameState,
  mission: Mission,
  content: ContentDb,
  rules: Rules,
): BoardEntry {
  const blocker = missionBlocker(state, mission, content, rules);
  const unlock = mission.unlock ? evalReq(state, mission.unlock, content) : null;
  const status = missionStatus(
    state,
    mission.id,
    missionStartSlot(state, content),
    content,
    rules,
    blocker,
  );
  return {
    id: mission.id,
    rank: mission.rank,
    nameKey: `mission.${mission.id}.name`,
    clientKey: `mission.${mission.id}.client`,
    team: mission.team,
    open: unlock === null || unlock.met,
    unlock,
    startable: status.startable,
    status,
    blocker,
    forecast: missionForecast(state, mission, content, rules),
  };
}

/** The missions of the board: every mission but the operation, with what blocks it and how it would go. */
export function missionBoard(state: GameState, content: ContentDb, rules: Rules): BoardEntry[] {
  return content.missions.filter((m) => m.board).map((m) => missionEntry(state, m, content, rules));
}
