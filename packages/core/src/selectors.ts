import type { ContentDb } from '@shinobi/content';
import { actionKindOf } from './actions.ts';
import { indexOf } from './lookup.ts';
import {
  MS_PER_HOUR,
  MS_PER_SECOND,
  masteryLevel,
  practiceIntervalSeconds,
  rate,
  techniqueCastSeconds,
} from './formulas.ts';
import { builtObstacles, COURSE_KIND, courseSkill, lapXp } from './athletics.ts';
import { bushOf, bushSize, gatherAverageSeconds, herbSkill, regrowMs } from './field.ts';
import { getMod } from './mod.ts';
import { nonNativeLevel } from './natures.ts';
import { evalReq, skillLevel, type Req, type ReqResult } from './requirements.ts';
import { activitySkill, entitySkill, isAcademyRank, skillEntry } from './vocab.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { levelAt, xpAt } from './xp.ts';

/*
 * Read-only views over the state for the UI and bots. Nothing here changes the state.
 */

/** The requirement that opens a skill, or null when it is open from the first day. */
export function skillUnlockReq(skill: string, content: ContentDb): Req | null {
  return content.skills.find((s) => s.id === skill)?.unlockReq ?? null;
}

/** Evaluated unlock requirement of a skill; null when the skill has none. */
export function skillUnlockStatus(
  state: GameState,
  skill: string,
  content: ContentDb,
): ReqResult | null {
  const req = skillUnlockReq(skill, content);
  return req ? evalReq(state, req, content) : null;
}

/** Whether the skill can be trained yet. */
export function isSkillUnlocked(state: GameState, skill: string, content: ContentDb): boolean {
  return skillUnlockStatus(state, skill, content)?.met ?? true;
}

/** Everything a tile for one skill action needs. */
export interface ActionInfo {
  kind: string;
  id: string;
  skill: string;
  /** Skill level at which the action unlocks. */
  level: number;
  /** Whether the action can be started now: skill open and every requirement met. */
  available: boolean;
  /** A reason (localization key) the action cannot start besides its requirements, such as a course with no obstacle; null otherwise. */
  blocked: string | null;
  /** The evaluated requirement tree; null when the action is available. */
  req: ReqResult | null;
  /** Length of one cycle at full speed in ms, modifiers included. */
  intervalMs: number;
  /** Skill XP per hour at full speed, with modifiers and the Academy slowdown. */
  xpPerHour: number;
  masteryLevel: number;
  /** Fraction of the current mastery level, 0..1 (1 at the cap). */
  masteryProgress: number;
  /** Items a craft uses per cycle, with how many the bank holds; empty for other actions. */
  inputs: { item: string; n: number; have: number }[];
  /** What a craft makes per cycle (before any bonus unit); empty for other actions. */
  outputs: { item: string; n: number }[];
}

interface Facts {
  skill: string;
  level: number;
  /** Cycle length in ms before modifiers. */
  baseMs: number;
  /** Milliseconds of work one completion is paid for, before modifiers; defaults to `baseMs`. */
  rewardMs?: number;
  /** Skill XP one cycle pays when it is not the rate of one level (the course lap), before modifiers. */
  rewardXp?: number;
  /** Extra ms each completion costs on average at full speed, outside the cycle (herb regrow). */
  extraMs?: number;
  inputs?: { item: string; n: number }[];
  outputs?: { item: string; n: number }[];
}

/** The skill, unlock level and unmodified cycle of an action of a built-in kind; null otherwise. */
function factsOf(
  state: GameState,
  kind: string,
  id: string,
  content: ContentDb,
  rules: Rules,
): Facts | null {
  const index = indexOf(content);
  const K = content.balance.K;
  const ms = (seconds: number) => Math.round(seconds * MS_PER_SECOND);
  switch (kind) {
    case 'practice': {
      const t = index.techniques.get(id);
      if (!t) return null;
      const cast = techniqueCastSeconds(
        t.sealSeq.length,
        masteryLevel(state, id, content),
        content,
        nonNativeLevel(t.skill, state.player.natures, skillLevel(state, t.skill, content), content),
      );
      return {
        skill: t.skill,
        level: t.level,
        baseMs: ms(practiceIntervalSeconds(cast, content)),
      };
    }
    case 'drill': {
      const e = index.exercises.get(id);
      const skill = e ? entitySkill(content, 'drill', e) : null;
      return e && skill !== null ? { skill, level: e.level, baseMs: ms(K.drill) } : null;
    }
    case 'meditate': {
      const p = index.practices.get(id);
      const skill = p ? entitySkill(content, 'insight', p) : null;
      return p && skill !== null ? { skill, level: p.level, baseMs: ms(K.meditate) } : null;
    }
    case COURSE_KIND: {
      const skill = courseSkill(content);
      if (id !== skill || skill === null) return null;
      const laps = Math.max(1, builtObstacles(state, content).length);
      return {
        skill,
        level: 1,
        baseMs: laps * ms(K.obstacle),
        rewardXp: lapXp(state, content),
      };
    }
    case 'gather': {
      const h = index.herbs.get(id);
      const skill = h ? herbSkill(content, h) : null;
      if (!h || skill === null) return null;
      const bush = bushOf(state, id);
      const size = bush?.size ?? bushSize(state, id, content, rules);
      return {
        skill,
        level: h.level,
        baseMs: ms(K.gather),
        rewardMs: gatherAverageSeconds(size, content) * MS_PER_SECOND,
        extraMs: regrowMs(state, content, rules) / size,
      };
    }
    case 'craft': {
      const r = index.recipes.get(id);
      if (!r) return null;
      return {
        skill: r.skill,
        level: r.level,
        baseMs: ms(K.craft),
        rewardMs: K.craft * MS_PER_SECOND * K.craftXpMult,
        inputs: r.ingredients.map((i) => ({ item: i.item, n: i.n })),
        outputs: [r.output],
      };
    }
    default:
      return null;
  }
}

/** Mastery level and the fraction of the way to the next one. */
function masteryOf(state: GameState, key: string, content: ContentDb) {
  const cap = content.balance.K.masteryCap;
  const xp = state.mastery[key]?.xp ?? 0;
  const level = levelAt(xp, cap);
  const progress = level >= cap ? 1 : (xp - xpAt(level)) / (xpAt(level + 1) - xpAt(level));
  return { level, progress: Math.min(1, Math.max(0, progress)) };
}

/** Describes one action by kind and id, or null if the rule set or content does not know it. */
export function actionInfo(
  state: GameState,
  action: { kind: string; id: string },
  content: ContentDb,
  rules: Rules = defaultRules,
): ActionInfo | null {
  const kind = actionKindOf(rules, action.kind);
  if (!kind || !kind.has(action.id, content)) return null;
  const facts = factsOf(state, action.kind, action.id, content, rules);
  if (!facts) return null;
  const { skill, level, baseMs } = facts;
  const rewardMs = facts.rewardMs ?? baseMs;

  const parts: Req[] = [];
  const unlock = skillUnlockReq(skill, content);
  if (unlock) parts.push(unlock);
  const own = kind.requirements(state, action.id, content, rules);
  if (own) parts.push(...(own.t === 'all' ? own.of : [own]));
  const result = evalReq(state, { t: 'all', of: parts }, content);
  const blocked = kind.blocked?.(state, action.id, content, rules) ?? null;

  const K = content.balance.K;
  let intervalMs = kind.intervalMs(state, action.id, content, rules);
  // An empty bush's regrow is counted in the average (extraMs), not in the steady cycle.
  if (facts.extraMs !== undefined && bushOf(state, action.id)?.stock === 0) {
    intervalMs -= regrowMs(state, content, rules);
  }
  let xpPerHour =
    facts.rewardXp === undefined
      ? (rate(level, content) * rewardMs) / (intervalMs + (facts.extraMs ?? 0))
      : (facts.rewardXp * MS_PER_HOUR) / intervalMs;
  xpPerHour *= getMod(state, 'xp.all', content, rules).total;
  xpPerHour *= getMod(state, `xp.skill.${skill}`, content, rules).total;
  if (
    isAcademyRank(content, state.player.rank) &&
    (skillEntry(state, skill)?.xp ?? 0) >= xpAt(K.academyCap)
  ) {
    xpPerHour *= K.academySlow;
  }

  const mastery = masteryOf(state, action.id, content);
  return {
    kind: action.kind,
    id: action.id,
    skill,
    level,
    available: result.met && blocked === null,
    blocked,
    req: result.met ? null : result,
    intervalMs,
    xpPerHour,
    masteryLevel: mastery.level,
    masteryProgress: mastery.progress,
    inputs: (facts.inputs ?? []).map((i) => ({ ...i, have: state.bank[i.item] ?? 0 })),
    outputs: facts.outputs ?? [],
  };
}

/** The action kind and ids a skill trains through; empty for skills with no actions yet. */
function skillActionIds(skill: string, content: ContentDb): { kind: string; id: string }[] {
  const by = <T extends { id: string; level: number }>(kind: string, list: readonly T[]) =>
    [...list].sort((a, b) => a.level - b.level).map((e) => ({ kind, id: e.id }));
  const data = indexOf(content).skills.get(skill);
  // What a skill trains follows from its activity; the list-based activities belong to the first skill that has them.
  const owns = (activity: string): boolean => activitySkill(content, activity) === skill;
  switch (data?.activity) {
    case 'tech':
      return by(
        'practice',
        content.techniques.filter((t) => t.skill === skill),
      );
    case 'drill':
      return by(
        'drill',
        content.exercises.filter((e) => entitySkill(content, 'drill', e) === skill),
      );
    case 'insight':
      return by(
        'meditate',
        content.practices.filter((p) => entitySkill(content, 'insight', p) === skill),
      );
    case 'course':
      return owns('course') ? [{ kind: COURSE_KIND, id: skill }] : [];
    case 'patch':
      return by(
        'gather',
        content.herbs.filter((h) => entitySkill(content, 'patch', h) === skill),
      );
    case 'recipe':
    case 'station':
      return by(
        'craft',
        content.recipes.filter((r) => r.skill === skill),
      );
    default:
      return [];
  }
}

/** Every action of a skill with its tile data, lowest unlock level first. */
export function listSkillActions(
  state: GameState,
  skill: string,
  content: ContentDb,
  rules: Rules = defaultRules,
): ActionInfo[] {
  const out: ActionInfo[] = [];
  for (const action of skillActionIds(skill, content)) {
    const info = actionInfo(state, action, content, rules);
    if (info) out.push(info);
  }
  return out;
}
