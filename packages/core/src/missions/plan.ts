import type { ContentDb, Mission, MissionStage, NatureId, Teammate } from '@shinobi/content';
import { MS_PER_MINUTE, masteryLevel } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod, type Modifier } from '../modifiers.ts';
import { evalReq, skillLevel, type Req, type ReqResult } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import { currencyOf, isNature, isTechSkill } from '../vocab.ts';
import { armedRation } from './ration.ts';

/** The performer of a stage when the player does it. */
export const SELF = 'self';

/**
 * How one stage is done: who does it (the player or a teammate), with which skill and technique,
 * how long one attempt takes and how likely it is to succeed. Plain JSON, kept in the slot.
 */
export interface StagePlan {
  /** `self` or the content id of the teammate. */
  who: string;
  /** The skill that was checked, and gets the XP when the player does it; empty for a combat or items stage. */
  skill: string;
  /** The technique performed, which gets the Mastery XP; empty when none. */
  tech: string;
  /** Skill level of the performer and the requirement it met. */
  level: number;
  min: number;
  /** Mastery level of the technique used (1 when none). */
  mastery: number;
  /** Whether this is a slower fallback. */
  slow: boolean;
  /** Intel spent to do the stage with no skill (0: none). */
  intel: number;
  /** Length of one attempt, ms. */
  ms: number;
  /** Chance that an attempt succeeds, 0..1. */
  chance: number;
}

/** A way to do a stage before its numbers are worked out. */
type Candidate = Omit<StagePlan, 'ms' | 'chance'>;

/**
 * One way to do a stage, met or not: what the planner chooses from, and what the interface lists.
 * `self` is the player by a skill or a named technique, `mate` a teammate, `skip` the Intel that
 * stands in for the skill, `free` a stage that asks for nothing (a fight, an items stage).
 */
export interface StageWay extends Candidate {
  kind: 'self' | 'mate' | 'skip' | 'free';
  /** Whether the way can be used now. */
  met: boolean;
  /** What the player needs for this way, with the known-technique condition of a nature; null for a teammate, Intel and a free way. */
  req: Req | null;
  /** `req` evaluated for the player; null where `req` is. */
  result: ReqResult | null;
  /** The Intel the player holds (an Intel way only; 0 otherwise); the price is `intel`. */
  have: number;
  /** This is the way the game will use. */
  used: boolean;
}

/** The ways of one stage, the one used (index into `ways`, -1 for none) and what the stage takes. */
export interface StageWays {
  ways: StageWay[];
  used: number;
  /** The items the stage takes when it begins, with what the player holds; null for any other stage. */
  takes: { item: string; need: number; have: number } | null;
}

/**
 * How the length of one attempt is made, as factors whose product is the time:
 * `ms = max(1, round(baseMs * level * mastery * slow * factor))`, where `factor` is the product
 * of the modifiers and the ration, never below `floor`.
 */
export interface DurationParts {
  /** The stage's share of the mission's base minutes, ms. */
  baseMs: number;
  /** The shortening by levels above the requirement, and by the Mastery of the technique (1 for a fight and an items stage). */
  level: number;
  mastery: number;
  /** `K.mission.slowAlt` on a slow fallback, else 1. */
  slow: number;
  /** The modifiers that went in, each key with its total and its sources: every mission's duration, and the key of the skill whose technique does the stage. */
  modifiers: { key: string; total: number; parts: Modifier[] }[];
  /** The product of the modifiers' totals, and the ration's `1 + share`. */
  modifiersTotal: number;
  ration: number;
  /** The share of its base time a stage cannot go below, and whether it binds here. */
  floor: number;
  floored: boolean;
  /** The duration factor that applies: `max(floor, modifiersTotal * ration)`. */
  factor: number;
  ms: number;
}
/** The time one attempt of a stage takes by its share of the mission's minutes, ms; the shares add up to the whole mission. */
export function stageBaseMs(mission: Mission, index: number): number {
  const total = mission.minutes * MS_PER_MINUTE;
  const sum = mission.shares.reduce((a, b) => a + b, 0);
  const upto = (n: number): number =>
    Math.round((total * mission.shares.slice(0, n).reduce((a, b) => a + b, 0)) / sum);
  return upto(index + 1) - upto(index);
}

/** The teammates of the team, with the nature each has in this game. */
export function teammates(
  state: GameState,
  content: ContentDb,
): { tm: Teammate; nature: NatureId }[] {
  const team = state.team;
  if (!team) return [];
  return content.team.map((tm) => ({ tm, nature: team[tm.natureOf] }));
}

/** The player's best level among the natures they own; 0 with none. */
function bestNatureLevel(state: GameState, content: ContentDb): number {
  return state.player.natures.reduce((best, n) => Math.max(best, skillLevel(state, n, content)), 0);
}

/**
 * A teammate's level in `skill`: the share `K.team.levelShare` of the player's level in the role
 * skill, or of the player's best nature for the teammate's own nature; at least 1. Null when the
 * teammate has no business with the skill.
 */
export function teammateLevel(
  state: GameState,
  member: { tm: Teammate; nature: NatureId },
  skill: string,
  content: ContentDb,
): number | null {
  const share = content.balance.K.team.levelShare;
  if (member.tm.skills.some((s) => s === skill)) {
    return Math.max(1, Math.floor(share * skillLevel(state, skill, content)));
  }
  if (isNature(content, skill) && member.nature === skill) {
    return Math.max(1, Math.floor(share * bestNatureLevel(state, content)));
  }
  return null;
}

/** The known technique of `skill` at or above `min` that the player has the most Mastery in (then the higher one). */
function bestTechnique(state: GameState, skill: string, min: number, content: ContentDb) {
  let best: { id: string; mastery: number; level: number } | null = null;
  for (const t of content.techniques) {
    if (t.skill !== skill || t.level < min || !state.known[t.id]) continue;
    const mastery = masteryLevel(state, t.id, content);
    if (!best || mastery > best.mastery || (mastery === best.mastery && t.level > best.level)) {
      best = { id: t.id, mastery, level: t.level };
    }
  }
  return best;
}

/** The known techniques of `skill` at or above `min` as requirement leaves, of which one is enough. */
const techniquesOf = (skill: string, min: number, content: ContentDb): Req => ({
  t: 'any',
  of: content.techniques
    .filter((t) => t.skill === skill && t.level >= min)
    .map((t): Req => ({ t: 'technique', id: t.id })),
});

type RawWay = Omit<StageWay, 'used' | 'result'>;

/** Every way the player or a teammate can do the stage, met or not, in the order the planner prefers on a tie. */
function waysOf(state: GameState, mission: Mission, index: number, content: ContentDb): RawWay[] {
  const stage = mission.stages[index];
  if (!stage) return [];
  const out: RawWay[] = [];
  const team = mission.team ? teammates(state, content) : [];
  const K = content.balance.K;
  const level = (skill: string): number => skillLevel(state, skill, content);

  /** One requirement `skill >= min`, done by the player, then by each teammate who has business with the skill. */
  const alternative = (skill: string, min: number, slow: boolean): void => {
    const lvl = level(skill);
    const base: Req = { t: 'skill', skill, level: min };
    const nature = isNature(content, skill);
    if (!isTechSkill(content, skill)) {
      out.push({
        kind: 'self',
        who: SELF,
        skill,
        tech: '',
        level: lvl,
        min,
        mastery: 1,
        slow,
        intel: 0,
        met: lvl >= min,
        req: base,
        have: 0,
      });
    } else {
      // A nature needs a known technique of the level; Taijutsu and Ninjutsu stand on the skill alone when none is known.
      const tech = bestTechnique(state, skill, min, content);
      const met = lvl >= min && (tech !== null || !nature);
      out.push({
        kind: 'self',
        who: SELF,
        skill,
        tech: met && tech ? tech.id : '',
        level: lvl,
        min,
        mastery: met && tech ? tech.mastery : 1,
        slow,
        intel: 0,
        met,
        req: nature ? { t: 'all', of: [base, techniquesOf(skill, min, content)] } : base,
        have: 0,
      });
    }
    for (const member of team) {
      const mate = teammateLevel(state, member, skill, content);
      if (mate === null) continue;
      out.push({
        kind: 'mate',
        who: member.tm.id,
        skill,
        tech: '',
        level: mate,
        min,
        mastery: K.team.mastery,
        slow,
        intel: 0,
        met: mate >= min,
        req: null,
        have: 0,
      });
    }
  };

  switch (stage.t) {
    case 'skill':
      alternative(stage.skill, stage.min, false);
      break;
    case 'tech':
      stage.any.forEach((alt, i) =>
        alternative(alt.skill, alt.min, mission.slow[index]?.includes(i) ?? false),
      );
      break;
    case 'named': {
      const techniques = indexOf(content).techniques;
      for (const id of [stage.technique, ...stage.alts]) {
        const t = techniques.get(id);
        if (!t) continue;
        const known = state.known[id] === true;
        out.push({
          kind: 'self',
          who: SELF,
          skill: t.skill,
          tech: id,
          level: level(t.skill),
          min: t.level,
          mastery: known ? masteryLevel(state, id, content) : 1,
          slow: false,
          intel: 0,
          met: known,
          req: { t: 'technique', id },
          have: 0,
        });
      }
      break;
    }
    case 'combat':
    case 'items':
      out.push({
        kind: 'free',
        who: SELF,
        skill: '',
        tech: '',
        level: 0,
        min: 0,
        mastery: 1,
        slow: false,
        intel: 0,
        met: true,
        req: null,
        have: 0,
      });
      break;
  }
  // Intel can stand in for a stage's skill: it is the way of last resort.
  const cost = mission.skip[index] ?? 0;
  const intel = currencyOf(content, 'study');
  if (cost > 0 && intel !== null) {
    const have = state.currencies[intel] ?? 0;
    out.push({
      kind: 'skip',
      who: SELF,
      skill: '',
      tech: '',
      level: 0,
      min: 0,
      mastery: 1,
      slow: false,
      intel: cost,
      met: have >= cost,
      req: null,
      have,
    });
  }
  return out;
}

/** What the modifiers and `ration` (a share, negative) do to a stage of `skill`, never below the floor of the balance. */
function durationFactor(
  state: GameState,
  skill: string,
  tech: string,
  ration: number,
  content: ContentDb,
  rules: Rules,
): Pick<DurationParts, 'modifiers' | 'modifiersTotal' | 'ration' | 'floor' | 'floored' | 'factor'> {
  const all = computeMod(rules, state, 'mission.duration', content);
  const modifiers = [{ key: 'mission.duration', total: all.total, parts: all.parts }];
  let factor = all.total;
  // A stage a technique of a skill performs may be shortened by a key of that skill (`mission.duration.<skill>`).
  const key = `mission.duration.${skill}`;
  if (tech !== '' && Object.hasOwn(content.modifierKeys, key)) {
    const own = computeMod(rules, state, key, content);
    modifiers.push({ key, total: own.total, parts: own.parts });
    factor *= own.total;
  }
  const floor = content.balance.K.mission.minFactor;
  const unfloored = factor * (1 + ration);
  return {
    modifiers,
    modifiersTotal: factor,
    ration: 1 + ration,
    floor,
    floored: floor > unfloored,
    factor: Math.max(floor, unfloored),
  };
}

/** The numbers of an attempt of `c`: its length in ms with the parts it is made of, and its chance. */
function figures(
  state: GameState,
  mission: Mission,
  index: number,
  c: Candidate,
  ration: number,
  extraMastery: number,
  content: ContentDb,
  rules: Rules,
): { plan: StagePlan; parts: DurationParts } {
  const M = content.balance.K.mission;
  const above = Math.max(0, c.level - c.min);
  const mastery = c.mastery + extraMastery;
  const stage = mission.stages[index];
  // Neither a fight nor an item stage has a level to be above.
  const fixed = stage?.t === 'combat' || stage?.t === 'items';
  const byLevel = fixed ? 1 : Math.max(M.floor, 1 - M.perLevel * above);
  const byMastery = fixed ? 1 : Math.max(0, 1 - M.masteryTime * (mastery - 1));
  const slow = c.slow ? M.slowAlt : 1;
  const baseMs = stageBaseMs(mission, index);
  const duration = durationFactor(state, c.skill, c.tech, ration, content, rules);
  const ms = Math.max(1, Math.round(baseMs * byLevel * byMastery * slow * duration.factor));
  const chance = fixed
    ? 1
    : Math.min(
        M.success.cap,
        M.success.base + M.success.perLevel * above + M.success.perMastery * (mastery - 1),
      );
  return {
    // Only the plan's own fields are kept: the plan is saved in the slot.
    plan: {
      who: c.who,
      skill: c.skill,
      tech: c.tech,
      level: c.level,
      min: c.min,
      mastery: c.mastery,
      slow: c.slow,
      intel: c.intel,
      ms,
      chance,
    },
    parts: { baseMs, level: byLevel, mastery: byMastery, slow, ...duration, ms },
  };
}

/** Which way is preferred: the player's own normal way first, then a teammate or a slow fallback, then Intel. */
const tierOf = (c: Candidate): number => (c.intel > 0 ? 2 : c.who === SELF && !c.slow ? 0 : 1);

/** What the planner works out for a stage: every way, the one chosen with its numbers and the parts of its length. */
interface Resolved {
  ways: RawWay[];
  used: number;
  plan: StagePlan | null;
  parts: DurationParts | null;
}

function resolve(
  state: GameState,
  mission: Mission,
  index: number,
  content: ContentDb,
  rules: Rules,
  ration: number,
  extraMastery: number,
): Resolved {
  const ways = waysOf(state, mission, index, content);
  const tier = Math.min(...ways.filter((w) => w.met).map(tierOf));
  let best: { plan: StagePlan; parts: DurationParts } | null = null;
  let used = -1;
  ways.forEach((c, i) => {
    if (!c.met || tierOf(c) !== tier) return;
    const found = figures(
      state,
      mission,
      index,
      c,
      ration,
      c.tech ? extraMastery : 0,
      content,
      rules,
    );
    if (best === null || found.plan.ms < best.plan.ms) {
      best = found;
      used = i;
    }
  });
  const chosen = best as { plan: StagePlan; parts: DurationParts } | null;
  return { ways, used, plan: chosen?.plan ?? null, parts: chosen?.parts ?? null };
}

/**
 * The way the game would do a stage now. The player does it whenever they meet it by a normal
 * way; a teammate does it only when the player cannot, or can only by a slower fallback; Intel
 * is the last resort. Within a kind of way the fastest wins (the player first on a tie).
 * `ration` is the share (negative) a ration takes off, `extraMastery` adds mastery levels to the
 * technique used (to preview the next step). Null when no way works.
 */
export function planStage(
  state: GameState,
  mission: Mission,
  index: number,
  content: ContentDb,
  rules: Rules,
  ration = 0,
  extraMastery = 0,
): StagePlan | null {
  return resolve(state, mission, index, content, rules, ration, extraMastery).plan;
}

/** `planStage` with the parts the length of the chosen attempt is made of (for the forecast). */
export function planStageParts(
  state: GameState,
  mission: Mission,
  index: number,
  content: ContentDb,
  rules: Rules,
  ration = 0,
  extraMastery = 0,
): { plan: StagePlan; parts: DurationParts } | null {
  const r = resolve(state, mission, index, content, rules, ration, extraMastery);
  return r.plan && r.parts ? { plan: r.plan, parts: r.parts } : null;
}

/**
 * Every way to do stage `stageIndex` of a mission, each with what it needs, whether it is met now,
 * its price where it has one (Intel), and which one the game will use (with the armed ration, as a
 * run that begins now would). The same resolution drives `planStage`, so the forecast, the run
 * and a page that lists the ways cannot disagree. Empty for a mission or stage the content lacks.
 */
export function missionStageWays(
  state: GameState,
  missionId: string,
  stageIndex: number,
  content: ContentDb,
  rules: Rules,
): StageWays {
  const mission = indexOf(content).missions.get(missionId);
  const stage = mission?.stages[stageIndex];
  if (!mission || !stage) return { ways: [], used: -1, takes: null };
  const { ways, used } = resolve(
    state,
    mission,
    stageIndex,
    content,
    rules,
    armedRation(state, content),
    0,
  );
  return {
    ways: ways.map((w, i) => ({
      ...w,
      result: w.req ? evalReq(state, w.req, content) : null,
      used: i === used,
    })),
    used,
    takes:
      stage.t === 'items'
        ? { item: stage.item, need: stage.n, have: state.bank[stage.item] ?? 0 }
        : null,
  };
}

const ALL_MET: Req = { t: 'all', of: [] };

/** What a stage needs, as a requirement tree: the technique leaves are the ones that would do. */
function staticReq(stage: MissionStage, content: ContentDb): Req {
  switch (stage.t) {
    case 'skill':
      return { t: 'skill', skill: stage.skill, level: stage.min };
    case 'tech':
      return {
        t: 'any',
        of: stage.any.map((alt): Req => {
          const leaf: Req = { t: 'skill', skill: alt.skill, level: alt.min };
          return isNature(content, alt.skill)
            ? { t: 'all', of: [leaf, techniquesOf(alt.skill, alt.min, content)] }
            : leaf;
        }),
      };
    case 'named':
      return {
        t: 'any',
        of: [stage.technique, ...stage.alts].map((id): Req => ({ t: 'technique', id })),
      };
    case 'items':
      return { t: 'item', id: stage.item, n: stage.n };
    case 'combat':
      return ALL_MET;
  }
}

/** The requirement of one stage now: met (empty) when a way to do it exists, else what would do. */
export function stageReq(
  state: GameState,
  mission: Mission,
  index: number,
  content: ContentDb,
  rules: Rules,
): Req {
  const stage = mission.stages[index];
  if (!stage) return ALL_MET;
  if (stage.t === 'items') return staticReq(stage, content);
  return planStage(state, mission, index, content, rules) ? ALL_MET : staticReq(stage, content);
}
