import type { ContentDb } from '@shinobi/content';
import { actionKindOf } from './actions.ts';
import { indexOf } from './lookup.ts';
import {
  MS_PER_HOUR,
  MS_PER_SECOND,
  cycleSeconds,
  cycleXp,
  masteryLevel,
  masteryXpPerAction,
  practiceIntervalSeconds,
  practiceXp,
  techniqueCastSeconds,
} from './formulas.ts';
import { builtObstacles, COURSE_KIND, courseSkill, lapBaseMs, lapXp } from './athletics.ts';
import {
  bushOf,
  bushSize,
  FIELDWORK_KIND,
  fieldworkSkill,
  gatherAverageSeconds,
  herbSkill,
  regrowMs,
} from './field.ts';
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
  /** Length of one cycle at full speed in ms before modifiers: the explicit cycle of the action. */
  baseMs: number;
  /** Length of one cycle at full speed in ms, modifiers included. */
  intervalMs: number;
  /** Skill XP per hour at full speed, with modifiers and the Academy slowdown. */
  xpPerHour: number;
  /** Skill XP one completed cycle pays, with modifiers and the Academy slowdown; it does not change with mastery. */
  xpPerCycle: number;
  /** Mastery XP per hour at full speed at the action's current mastery level, with modifiers (the mean over the obstacles for the course). */
  masteryPerHour: number;
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
  /** Skill XP one completed cycle pays, before modifiers. */
  rewardXp: number;
  /** What one completion pays mastery for: a mastery key and the seconds of work (before modifiers) it is paid for; defaults to the action itself and its cycle. A lap pays each obstacle. */
  masteryParts?: { key: string; seconds: number }[];
  /** Extra ms each completion costs on average at full speed, outside the cycle (herb regrow). */
  extraMs?: number;
  inputs?: { item: string; n: number }[];
  outputs?: { item: string; n: number }[];
}

/** How a practice cycle divides: the focus, then the cast of the technique, in ms of an unmodified cycle. */
export interface PracticeSplit {
  focusMs: number;
  castMs: number;
  /** The whole cycle: `focusMs + castMs`. */
  intervalMs: number;
}

/**
 * The cycle of practising a technique as the player sees it: first the focus, then the cast, which
 * is the cast time of the technique (its own number, shortened by mastery, stretched when the
 * nature is not the player's own). A cycle that would be shorter than the least one is padded with
 * focus. Null when `id` is no technique.
 */
export function practiceSplit(
  state: GameState,
  id: string,
  content: ContentDb,
): PracticeSplit | null {
  const t = indexOf(content).techniques.get(id);
  if (!t) return null;
  const cast = techniqueCastSeconds(
    t,
    masteryLevel(state, id, content),
    content,
    nonNativeLevel(t.skill, state.player.natures, skillLevel(state, t.skill, content), content),
  );
  const castMs = Math.round(cast * MS_PER_SECOND);
  const intervalMs = Math.round(practiceIntervalSeconds(cast, content, t.level) * MS_PER_SECOND);
  return { focusMs: intervalMs - castMs, castMs, intervalMs };
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
  const ms = (seconds: number) => Math.round(seconds * MS_PER_SECOND);
  switch (kind) {
    case 'practice': {
      const t = index.techniques.get(id);
      if (!t) return null;
      const cast = techniqueCastSeconds(
        t,
        masteryLevel(state, id, content),
        content,
        nonNativeLevel(t.skill, state.player.natures, skillLevel(state, t.skill, content), content),
      );
      return {
        skill: t.skill,
        level: t.level,
        baseMs: ms(practiceIntervalSeconds(cast, content, t.level)),
        rewardXp: practiceXp(t, content),
      };
    }
    case 'drill': {
      const e = index.exercises.get(id);
      const skill = e ? entitySkill(content, 'drill', e) : null;
      return e && skill !== null
        ? {
            skill,
            level: e.level,
            baseMs: ms(cycleSeconds('drill', e, content)),
            rewardXp: cycleXp('drill', e, content),
          }
        : null;
    }
    case 'meditate': {
      const p = index.practices.get(id);
      const skill = p ? entitySkill(content, 'insight', p) : null;
      return p && skill !== null
        ? {
            skill,
            level: p.level,
            baseMs: ms(cycleSeconds('meditate', p, content)),
            rewardXp: cycleXp('meditate', p, content),
          }
        : null;
    }
    case COURSE_KIND: {
      const skill = courseSkill(content);
      if (id !== skill || skill === null) return null;
      return {
        skill,
        level: 1,
        baseMs: lapBaseMs(state, content),
        rewardXp: lapXp(state, content),
        masteryParts: builtObstacles(state, content).map((o) => ({
          key: o.id,
          seconds: cycleSeconds('obstacle', o, content),
        })),
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
        baseMs: ms(cycleSeconds('gather', h, content)),
        rewardXp: cycleXp('gather', h, content),
        masteryParts: [{ key: id, seconds: gatherAverageSeconds(h, size, content) }],
        extraMs: regrowMs(state, content, rules) / size,
      };
    }
    case FIELDWORK_KIND: {
      const w = index.fieldworks.get(id);
      const skill = w ? fieldworkSkill(content, w) : null;
      if (!w || skill === null) return null;
      return {
        skill,
        level: w.level,
        baseMs: ms(w.cycle),
        rewardXp: w.xp,
        masteryParts: [{ key: id, seconds: w.cycle }],
        outputs: w.drops.flatMap((d) => d.payout.items ?? []),
      };
    }
    case 'craft': {
      const r = index.recipes.get(id);
      if (!r) return null;
      return {
        skill: r.skill,
        level: r.level,
        baseMs: ms(cycleSeconds('craft', r, content)),
        rewardXp: cycleXp('craft', r, content),
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
  // The cycle with the regrow pause of a bush (extraMs), which is part of what a gather costs on average.
  const cycleMs = intervalMs + (facts.extraMs ?? 0);
  let xpPerCycle = facts.rewardXp;
  xpPerCycle *= getMod(state, 'xp.all', content, rules).total;
  xpPerCycle *= getMod(state, `xp.skill.${skill}`, content, rules).total;
  if (
    isAcademyRank(content, state.player.rank) &&
    (skillEntry(state, skill)?.xp ?? 0) >= xpAt(K.academyCap)
  ) {
    xpPerCycle *= K.academySlow;
  }
  const xpPerHour = (xpPerCycle * MS_PER_HOUR) / cycleMs;

  // Mastery follows the unmodified cycle and the action's own mastery level.
  const payers = facts.masteryParts ?? [{ key: action.id, seconds: baseMs / MS_PER_SECOND }];
  const perCycle =
    payers.length === 0
      ? 0
      : payers.reduce(
          (sum, p) =>
            sum + masteryXpPerAction(masteryLevel(state, p.key, content), p.seconds, content),
          0,
        ) / payers.length;
  const masteryPerHour =
    (perCycle *
      getMod(state, 'mastery.xp.all', content, rules).total *
      getMod(state, `mastery.xp.skill.${skill}`, content, rules).total *
      MS_PER_HOUR) /
    cycleMs;

  const mastery = masteryOf(state, action.id, content);
  return {
    kind: action.kind,
    id: action.id,
    skill,
    level,
    available: result.met && blocked === null,
    blocked,
    req: result.met ? null : result,
    baseMs,
    intervalMs,
    xpPerHour,
    xpPerCycle,
    masteryPerHour,
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
    case 'map':
      return owns('map')
        ? by(
            FIELDWORK_KIND,
            content.fieldworks.filter((w) => fieldworkSkill(content, w) === skill),
          )
        : [];
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
