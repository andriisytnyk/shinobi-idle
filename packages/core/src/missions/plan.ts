import {
  NATURE_IDS,
  isModifierKey,
  TECH_SKILL_IDS,
  type ContentDb,
  type Mission,
  type MissionStage,
  type NatureId,
  type SkillId,
  type Teammate,
} from '@shinobi/content';
import { MS_PER_MINUTE, masteryLevel } from '../formulas.ts';
import { indexOf } from '../lookup.ts';
import { computeMod } from '../modifiers.ts';
import { skillLevel, type Req } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';

/** The performer of a stage when the player does it. */
export const SELF = 'self';

const isNature = (s: string): s is NatureId => (NATURE_IDS as readonly string[]).includes(s);
const isTechSkill = (s: string): boolean => (TECH_SKILL_IDS as readonly string[]).includes(s);

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
    return Math.max(1, Math.floor(share * skillLevel(state, skill as SkillId, content)));
  }
  if (isNature(skill) && member.nature === skill) {
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

/** Every way the player or a teammate can do `stage` now. */
function candidates(
  state: GameState,
  mission: Mission,
  index: number,
  content: ContentDb,
): Candidate[] {
  const stage = mission.stages[index];
  if (!stage) return [];
  const out: Candidate[] = [];
  const team = mission.team ? teammates(state, content) : [];
  const K = content.balance.K;
  const self = (c: Omit<Candidate, 'who' | 'intel'>): void =>
    void out.push({ who: SELF, intel: 0, ...c });
  const level = (skill: string): number => skillLevel(state, skill as SkillId, content);

  /** One requirement `skill >= min`, done by the player, then by each teammate who can. */
  const alternative = (skill: string, min: number, slow: boolean): void => {
    if (!isTechSkill(skill)) {
      if (level(skill) >= min) {
        self({ skill, tech: '', level: level(skill), min, mastery: 1, slow });
      }
    } else {
      const tech = bestTechnique(state, skill, min, content);
      const lvl = level(skill);
      if (tech && lvl >= min) {
        self({ skill, tech: tech.id, level: lvl, min, mastery: tech.mastery, slow });
      } else if (!isNature(skill) && lvl >= min) {
        // Taijutsu and Ninjutsu stand on the skill alone when no technique of the level is known.
        self({ skill, tech: '', level: lvl, min, mastery: 1, slow });
      }
    }
    for (const member of team) {
      const lvl = teammateLevel(state, member, skill, content);
      if (lvl !== null && lvl >= min) {
        out.push({
          who: member.tm.id,
          skill,
          tech: '',
          level: lvl,
          min,
          mastery: K.team.mastery,
          slow,
          intel: 0,
        });
      }
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
        if (!t || !state.known[id]) continue;
        self({
          skill: t.skill,
          tech: id,
          level: level(t.skill),
          min: t.level,
          mastery: masteryLevel(state, id, content),
          slow: false,
        });
      }
      break;
    }
    case 'combat':
    case 'items':
      self({ skill: '', tech: '', level: 0, min: 0, mastery: 1, slow: false });
      break;
  }
  // Intel can stand in for a stage's skill: it is the way of last resort.
  const cost = mission.skip[index] ?? 0;
  if (cost > 0 && state.currencies.intel >= cost) {
    out.push({
      who: SELF,
      skill: '',
      tech: '',
      level: 0,
      min: 0,
      mastery: 1,
      slow: false,
      intel: cost,
    });
  }
  return out;
}

/** What `ration` (a share, negative) and the mission duration modifiers do to a stage of `skill`, never below the floor of the balance. */
function durationFactor(
  state: GameState,
  skill: string,
  tech: string,
  ration: number,
  content: ContentDb,
  rules: Rules,
): number {
  let factor = computeMod(rules.modifierProviders, state, 'mission.duration', content).total;
  // A stage a technique of a skill performs may be shortened by a key of that skill (`mission.duration.<skill>`).
  const key = `mission.duration.${skill}`;
  if (tech !== '' && isModifierKey(key)) {
    factor *= computeMod(rules.modifierProviders, state, key, content).total;
  }
  return Math.max(content.balance.K.mission.minFactor, factor * (1 + ration));
}

/** The numbers of an attempt of `c`: its length in ms and its chance. */
function figures(
  state: GameState,
  mission: Mission,
  index: number,
  c: Candidate,
  ration: number,
  extraMastery: number,
  content: ContentDb,
  rules: Rules,
): StagePlan {
  const M = content.balance.K.mission;
  const above = Math.max(0, c.level - c.min);
  const mastery = c.mastery + extraMastery;
  const stage = mission.stages[index];
  // Neither a fight nor an item stage has a level to be above.
  const fixed = stage?.t === 'combat' || stage?.t === 'items';
  const byLevel = fixed ? 1 : Math.max(M.floor, 1 - M.perLevel * above);
  const byMastery = fixed ? 1 : Math.max(0, 1 - M.masteryTime * (mastery - 1));
  const ms = Math.max(
    1,
    Math.round(
      stageBaseMs(mission, index) *
        byLevel *
        byMastery *
        (c.slow ? M.slowAlt : 1) *
        durationFactor(state, c.skill, c.tech, ration, content, rules),
    ),
  );
  const chance = fixed
    ? 1
    : Math.min(
        M.success.cap,
        M.success.base + M.success.perLevel * above + M.success.perMastery * (mastery - 1),
      );
  return { ...c, ms, chance };
}

/** Which way is preferred: the player's own normal way first, then a teammate or a slow fallback, then Intel. */
const tierOf = (c: Candidate): number => (c.intel > 0 ? 2 : c.who === SELF && !c.slow ? 0 : 1);

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
  const all = candidates(state, mission, index, content);
  const tier = Math.min(...all.map(tierOf));
  let best: StagePlan | null = null;
  for (const c of all) {
    if (tierOf(c) !== tier) continue;
    const plan = figures(
      state,
      mission,
      index,
      c,
      ration,
      c.tech ? extraMastery : 0,
      content,
      rules,
    );
    if (!best || plan.ms < best.ms) best = plan;
  }
  return best;
}

const ALL_MET: Req = { t: 'all', of: [] };

/** What a stage needs, as a requirement tree: the technique leaves are the ones that would do. */
function staticReq(stage: MissionStage, content: ContentDb): Req {
  const techniquesOf = (skill: string, min: number): Req => ({
    t: 'any',
    of: content.techniques
      .filter((t) => t.skill === skill && t.level >= min)
      .map((t) => ({ t: 'technique', id: t.id })),
  });
  switch (stage.t) {
    case 'skill':
      return { t: 'skill', skill: stage.skill, level: stage.min };
    case 'tech':
      return {
        t: 'any',
        of: stage.any.map((alt): Req => {
          const leaf: Req = { t: 'skill', skill: alt.skill, level: alt.min };
          return isNature(alt.skill)
            ? { t: 'all', of: [leaf, techniquesOf(alt.skill, alt.min)] }
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
