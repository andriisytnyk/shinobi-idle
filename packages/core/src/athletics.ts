import type { ContentDb, Obstacle } from '@shinobi/content';
import type { ActionKind } from './actions.ts';
import { removeCurrency } from './bank.ts';
import { checkpointProvider } from './checkpoints.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { MS_PER_SECOND, SECONDS_PER_HOUR, masteryXpPerAction, rate } from './formulas.ts';
import { indexOf } from './lookup.ts';
import { meditationProvider } from './meditation.ts';
import {
  bonusOf,
  computeMod,
  cycleFactor,
  type Modifier,
  type ModifierProvider,
} from './modifiers.ts';
import { gainXp, grantMastery } from './progression.ts';
import { evalReq } from './requirements.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';

/** The action kind of the Athletics course: one lap runs every built obstacle. */
export const COURSE_KIND = 'course';
/** The course has no entity of its own: its action id is the Athletics skill. */
export const COURSE_ID = 'ath';

/** The built obstacles, lowest slot first. */
export function builtObstacles(state: GameState, content: ContentDb): Obstacle[] {
  const index = indexOf(content);
  return Object.entries(state.course)
    .sort(([a], [b]) => Number(a) - Number(b))
    .flatMap(([, id]) => {
      const obstacle = index.obstacles.get(id);
      return obstacle ? [obstacle] : [];
    });
}

/** The two obstacles one can choose between in a slot. */
export function slotOptions(slot: number, content: ContentDb): Obstacle[] {
  return content.obstacles.filter((o) => o.slot === slot);
}

/** The slot numbers of the course, lowest first. */
export function courseSlotNumbers(content: ContentDb): number[] {
  return [...new Set(content.obstacles.map((o) => o.slot))].sort((a, b) => a - b);
}

/** Ryo for building `obstacle` now: the base price times the slot squared, after `obstacle.cost`; slot 1 is free the first time. */
export function buildCost(
  state: GameState,
  obstacle: Obstacle,
  content: ContentDb,
  rules: Rules,
): number {
  const K = content.balance.K;
  const empty = state.course[`${obstacle.slot}`] === undefined;
  if (obstacle.slot === K.athletics.freeSlot && empty) return 0;
  const mod = computeMod(rules.modifierProviders, state, 'obstacle.cost', content).total;
  return Math.max(0, Math.round(K.obstacleBase * obstacle.slot ** 2 * mod));
}

/** Why `obstacle` cannot be built now, as a localization key; null when it can. */
export function buildBlocked(
  state: GameState,
  obstacle: Obstacle,
  content: ContentDb,
  rules: Rules,
): string | null {
  if (state.course[`${obstacle.slot}`] === obstacle.id) return 'error.alreadyBuilt';
  if (!evalReq(state, { t: 'skill', skill: 'ath', level: obstacle.level }, content).met) {
    return 'error.slotLocked';
  }
  if (obstacle.req && !evalReq(state, obstacle.req, content).met) return 'error.requirementsNotMet';
  if (state.currencies.ryo < buildCost(state, obstacle, content, rules)) {
    return 'error.notEnoughRyo';
  }
  return null;
}

/** Builds one of the two obstacles of a slot, replacing what stands there. */
export function buildObstacle(
  state: GameState,
  slot: number,
  obstacleId: string,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const obstacle = indexOf(content).obstacles.get(obstacleId);
  if (!obstacle) return { ok: false, reason: 'error.unknownObstacle' };
  if (obstacle.slot !== slot) return { ok: false, reason: 'error.invalidSlot' };
  const blocked = buildBlocked(state, obstacle, content, rules);
  if (blocked) return { ok: false, reason: blocked };
  removeCurrency(state, 'ryo', buildCost(state, obstacle, content, rules));
  state.course[`${slot}`] = obstacle.id;
  emit(state, { type: 'obstacleBuilt', slot, obstacle: obstacle.id });
  return { ok: true };
}

/** Time of one obstacle in a lap at full speed, before modifiers, in ms. */
const obstacleMs = (content: ContentDb): number =>
  Math.round(content.balance.K.obstacle * MS_PER_SECOND);

/** Skill XP of one lap, before modifiers: every built obstacle pays its slot's rate for the obstacle's time. */
export function lapXp(state: GameState, content: ContentDb): number {
  const K = content.balance.K;
  let sum = 0;
  for (const o of builtObstacles(state, content)) {
    sum += (rate(o.level, content) * K.obstacle) / SECONDS_PER_HOUR;
  }
  return sum;
}

/** Length of one lap in ms: the built obstacles times the obstacle time, after speed modifiers; at least 1. */
export function lapIntervalMs(state: GameState, content: ContentDb, rules: Rules): number {
  const count = Math.max(1, builtObstacles(state, content).length);
  const factor = cycleFactor(rules.modifierProviders, state, 'ath', content);
  return Math.max(1, Math.round(count * obstacleMs(content) * factor));
}

export const courseKind: ActionKind = {
  has: (id) => id === COURSE_ID,
  skill: () => 'ath',
  requirements: () => ({ t: 'skill', skill: 'ath', level: 1 }),
  blocked: (state) => (Object.keys(state.course).length === 0 ? 'error.noObstacles' : null),
  intervalMs: (state, _id, content, rules) => lapIntervalMs(state, content, rules),
  complete(state, _id, content, rules) {
    const built = builtObstacles(state, content);
    if (built.length === 0) return 'abort';
    gainXp(state, 'ath', lapXp(state, content), content, rules);
    const mastery = masteryXpPerAction(content.balance.K.obstacle, content);
    for (const o of built) grantMastery(state, o.id, 'ath', mastery, content, rules);
  },
};

/**
 * Built obstacles: the bonus and the penalty of each, resized by `obstacle.bonus` and
 * `obstacle.penalty`, plus the pillar of the full course. The two scaling keys are read from
 * pool checkpoints and Meditation only, so an obstacle never scales itself.
 */
export const obstacleProvider: ModifierProvider = (state, content) => {
  if (Object.keys(state.course).length === 0) return [];
  const built = builtObstacles(state, content);
  const sources = [checkpointProvider, meditationProvider];
  const scale = {
    bonus: Math.max(0, 1 + bonusOf(sources, state, 'obstacle.bonus', content)),
    penalty: Math.max(0, 1 + bonusOf(sources, state, 'obstacle.penalty', content)),
  };
  const out: Modifier[] = [];
  for (const o of built) {
    for (const m of o.mods) {
      const k = scale[m.side];
      out.push({
        key: m.key,
        op: m.op,
        value: m.op === 'add' ? m.value * k : 1 + (m.value - 1) * k,
        group: 'character',
        source: { kind: 'obstacle', id: o.id },
      });
    }
  }
  const { pillarCount, pillarXp } = content.balance.K.athletics;
  if (built.length >= pillarCount) {
    out.push({
      key: 'xp.skill.ath',
      op: 'add',
      value: pillarXp,
      group: 'character',
      source: { kind: 'skill', id: 'ath' },
    });
  }
  return out;
};

/** One obstacle choice of a slot, for a screen. */
export interface ObstacleOption {
  id: string;
  built: boolean;
  /** Ryo it would cost now. */
  cost: number;
  /** Why it cannot be built now (a localization key), or null. */
  blocked: string | null;
}

export interface CourseSlotInfo {
  slot: number;
  /** Athletics level that opens the slot. */
  level: number;
  open: boolean;
  built: string | null;
  options: ObstacleOption[];
}

/** The slots of the course with their obstacles and what each costs. */
export function listCourse(state: GameState, content: ContentDb, rules: Rules): CourseSlotInfo[] {
  return courseSlotNumbers(content).map((slot) => {
    const options = slotOptions(slot, content);
    const level = Math.min(...options.map((o) => o.level));
    return {
      slot,
      level,
      open: evalReq(state, { t: 'skill', skill: 'ath', level }, content).met,
      built: state.course[`${slot}`] ?? null,
      options: options.map((o) => ({
        id: o.id,
        built: state.course[`${slot}`] === o.id,
        cost: buildCost(state, o, content, rules),
        blocked: buildBlocked(state, o, content, rules),
      })),
    };
  });
}
