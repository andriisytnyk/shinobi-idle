import type { ContentDb, SkillId } from '@shinobi/content';
import { indexOf } from './lookup.ts';
import {
  MS_PER_SECOND,
  masteryLevel,
  practiceIntervalSeconds,
  rate,
  techniqueCastSeconds,
} from './formulas.ts';
import { getMod } from './mod.ts';
import { evalReq, type Req, type ReqResult } from './requirements.ts';
import { defaultRules, type Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { levelAt, xpAt } from './xp.ts';

/*
 * Read-only views over the state for the UI and bots. Nothing here changes the state.
 */

/** The requirement that opens a skill, or null when it is open from the first day. */
export function skillUnlockReq(skill: SkillId, content: ContentDb): Req | null {
  return content.skills.find((s) => s.id === skill)?.unlockReq ?? null;
}

/** Evaluated unlock requirement of a skill; null when the skill has none. */
export function skillUnlockStatus(
  state: GameState,
  skill: SkillId,
  content: ContentDb,
): ReqResult | null {
  const req = skillUnlockReq(skill, content);
  return req ? evalReq(state, req, content) : null;
}

/** Whether the skill can be trained yet. */
export function isSkillUnlocked(state: GameState, skill: SkillId, content: ContentDb): boolean {
  return skillUnlockStatus(state, skill, content)?.met ?? true;
}

/** Everything a tile for one skill action needs. */
export interface ActionInfo {
  kind: string;
  id: string;
  skill: SkillId;
  /** Skill level at which the action unlocks. */
  level: number;
  /** Whether the action can be started now: skill open and every requirement met. */
  available: boolean;
  /** The evaluated requirement tree; null when the action is available. */
  req: ReqResult | null;
  /** Length of one cycle at full speed in ms, modifiers included. */
  intervalMs: number;
  /** Skill XP per hour at full speed, with modifiers and the Academy slowdown. */
  xpPerHour: number;
  masteryLevel: number;
  /** Fraction of the current mastery level, 0..1 (1 at the cap). */
  masteryProgress: number;
}

interface Facts {
  skill: SkillId;
  level: number;
  /** Cycle length in ms before modifiers. */
  baseMs: number;
}

/** The skill, unlock level and unmodified cycle of an action of a built-in kind; null otherwise. */
function factsOf(state: GameState, kind: string, id: string, content: ContentDb): Facts | null {
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
      );
      return {
        skill: t.skill,
        level: t.level,
        baseMs: ms(practiceIntervalSeconds(cast, content)),
      };
    }
    case 'drill': {
      const e = index.exercises.get(id);
      return e ? { skill: 'cc', level: e.level, baseMs: ms(K.drill) } : null;
    }
    case 'meditate': {
      const p = index.practices.get(id);
      return p ? { skill: 'med', level: p.level, baseMs: ms(K.meditate) } : null;
    }
    case 'obstacle': {
      const o = index.obstacles.get(id);
      return o ? { skill: 'ath', level: o.level, baseMs: ms(K.obstacle) } : null;
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
  const kind = rules.actionKinds[action.kind];
  if (!kind || !kind.has(action.id, content)) return null;
  const facts = factsOf(state, action.kind, action.id, content);
  if (!facts) return null;
  const { skill, level, baseMs } = facts;

  const parts: Req[] = [];
  const unlock = skillUnlockReq(skill, content);
  if (unlock) parts.push(unlock);
  const own = kind.requirements(state, action.id, content, rules);
  if (own) parts.push(...(own.t === 'all' ? own.of : [own]));
  const result = evalReq(state, { t: 'all', of: parts }, content);

  const intervalMs = kind.intervalMs(state, action.id, content, rules);
  const K = content.balance.K;
  let xpPerHour = (rate(level, content) * baseMs) / intervalMs;
  xpPerHour *= getMod(state, 'xp.all', content, rules).total;
  xpPerHour *= getMod(state, `xp.skill.${skill}`, content, rules).total;
  if (state.player.rank === 'student' && state.skills[skill].xp >= xpAt(K.academyCap)) {
    xpPerHour *= K.academySlow;
  }

  const mastery = masteryOf(state, action.id, content);
  return {
    kind: action.kind,
    id: action.id,
    skill,
    level,
    available: result.met,
    req: result.met ? null : result,
    intervalMs,
    xpPerHour,
    masteryLevel: mastery.level,
    masteryProgress: mastery.progress,
  };
}

/** The action kind and ids a skill trains through; empty for skills with no actions yet. */
function skillActionIds(skill: SkillId, content: ContentDb): { kind: string; id: string }[] {
  const by = <T extends { id: string; level: number }>(kind: string, list: readonly T[]) =>
    [...list].sort((a, b) => a.level - b.level).map((e) => ({ kind, id: e.id }));
  switch (skill) {
    case 'tai':
    case 'nin':
    case 'katon':
    case 'futon':
    case 'raiton':
    case 'doton':
    case 'suiton':
      return by(
        'practice',
        content.techniques.filter((t) => t.skill === skill),
      );
    case 'cc':
      return by('drill', content.exercises);
    case 'med':
      return by('meditate', content.practices);
    case 'ath':
      return by('obstacle', content.obstacles);
    default:
      return [];
  }
}

/** Every action of a skill with its tile data, lowest unlock level first. */
export function listSkillActions(
  state: GameState,
  skill: SkillId,
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
