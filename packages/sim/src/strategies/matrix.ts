import { content as builtIn, type ContentDb, type NatureId } from '@shinobi/content';
import {
  CLONE_OPEN_MS,
  CLONE_RUN_MS,
  cloneSlots,
  defaultRules,
  isNature,
  levelAt,
  levelCap,
  moneyOf,
  STAND_KIND,
  type GameState,
  type Rules,
} from '@shinobi/core';
import { runBot, type Milestone, type RunResult } from '../runner.ts';
import { createStrategyBot, STRATEGIES, type Strategy, type StrategyId } from './strategies.ts';

const HOUR = 3_600_000;

/** Targets of the documents (balance model, plan stage 9) the report judges the runs by. */
export const TARGETS = {
  geninHours: { min: 0.5, max: 1.5 },
  chuninHours: { min: 20, max: 50 },
  /** Cadence (author, 18.11): a stretch without anything new is at most this share of the game time at its end, and at most `maxGapHours`; stretches under `minAllowedHours` are always fine. */
  maxGapShare: 0.2,
  maxGapHours: 8,
  minAllowedHours: 2,
  minSkillAtEnd: 20,
  firstHours: 3,
} as const;

/** The milestones the gap is measured between: ranks, quest steps, the clone technique, and the tens of a skill. */
export const GAP_SKILL_LEVELS: readonly number[] = [10, 20, 30, 40, 50];

/** Every ordered triple of natures: the first is the native one, the others are taken as Chakra Control allows. Ten sets of three, each with its first nature. */
export function naturesTriples(content: ContentDb): NatureId[][] {
  const ids = content.natures.map((n) => n.id as NatureId);
  const out: NatureId[][] = [];
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      for (let c = b + 1; c < ids.length; c++)
        out.push([ids[a] as NatureId, ids[b] as NatureId, ids[c] as NatureId]);
    }
  }
  return out;
}

/** Time share per kind of work: game ms, skill XP and ryo earned while a kind ran in slot 0. */
export interface KindTotals {
  ms: number;
  xp: number;
  ryo: number;
}

export interface RunMetrics {
  strategy: StrategyId;
  triple: string[];
  seed: number;
  ended: RunResult['ended'];
  /** Game hours the run lasted. */
  hours: number;
  /** Skill levels after the first three hours (trainable skills only). */
  levelsAt3h: Record<string, number>;
  /** Hours to each milestone; null when it was not reached. */
  genin: number | null;
  clone: number | null;
  chunin: number | null;
  cap: number | null;
  /** Longest stretch between two milestones, hours, with what stood at its start; the stretch to the end of the run counts. */
  longestGap: { hours: number; after: string };
  /** The stretch that exceeds the cadence rule the most (hours over what the rule allows there), whether or not it does. */
  cadence: { hours: number; allowed: number; after: string };
  /** Share of the run (and of the time since the clone opened) in which the clone's slot worked. */
  cloneShareRun: number;
  cloneShareOpen: number | null;
  /** Work by kind: missions, practice (every other skill-training action), fights. */
  mission: KindTotals;
  practice: KindTotals;
  fight: KindTotals;
  /** The part of `fight` fought with bodies of the character's own at its side (combat shadow clones). */
  fightAlly: KindTotals;
  /** Fights begun in slot 0, and how many of them had an ally at some point. */
  fights: number;
  fightsWithAllies: number;
  /** Skill XP the clones handed over when dispelled (after what the game keeps), and all skill XP the character holds at the end. */
  cloneXp: number;
  totalXp: number;
  /** Game ms an action ran in slot 0, and in a clone's slot (a clone that only stands does not count). */
  actionMs: { main: number; clone: number };
  /** Final levels (trainable skills) and the lowest among them. */
  levels: Record<string, number>;
  minLevel: number;
  /** The lowest skill level (trainable skills) the moment the last rank was taken (the step it was taken in is looked at); null when it never was. */
  minLevelAtChunin: number | null;
  rank: string;
  rejected: number;
  firstRejection: string | null;
  /** The last thing the story policy could not move on. */
  blocked: string | null;
  /** The quests the run opened: the step it stood at (counted from 0), or `done`. */
  quests: Record<string, string>;
  /** Defeats the player took, by enemy id. */
  defeats: Record<string, number>;
  /** Game hours at which each quest chain was finished. */
  questsDoneAt: Record<string, number>;
  /** Operations whose first-clear flag stands. */
  opsCleared: string[];
}

const FIGHT_KINDS = new Set(['fight', 'operation']);

function trainable(state: GameState, content: ContentDb): string[] {
  return content.skills
    .filter((s) => !isNature(content, s.id) || state.player.natures.includes(s.id))
    .map((s) => s.id);
}

function milestoneLabel(m: Milestone, content: ContentDb): string {
  const t = (k: string) => content.locales.uk[k] ?? k;
  switch (m.type) {
    case 'rank':
      return `ранг ${m.id}`;
    case 'questStep':
      return `«${t(`quest.${m.id}.name`)}» крок ${m.step}`;
    case 'renownRank':
      return `ранг Репутації «${t(`renownRank.${m.id}.name`)}»`;
    case 'questDone':
      return `«${t(`quest.${m.id}.name`)}» завершено`;
    case 'skill':
      return `${t(`skill.${m.id}.name`)} ${m.level}`;
  }
}

export interface MatrixRun {
  strategy: Strategy;
  triple: readonly NatureId[];
  seed: number;
  hours: number;
  content?: ContentDb;
  rules?: Rules;
}

/** Plays one strategy with one triple on one seed and measures it. */
export function measureRun(options: MatrixRun): RunMetrics {
  const content = options.content ?? builtIn;
  const rules = options.rules ?? defaultRules;
  const bot = createStrategyBot(options.strategy, options.triple);
  const money = moneyOf(content);
  const cap = levelCap(content);

  let levelsAt3h: Record<string, number> | null = null;
  let cloneAt: number | null = null;
  let capAt: number | null = null;
  let minAtChunin: number | null = null;
  const kinds = {
    mission: { ms: 0, xp: 0, ryo: 0 },
    practice: { ms: 0, xp: 0, ryo: 0 },
    fight: { ms: 0, xp: 0, ryo: 0 },
    fightAlly: { ms: 0, xp: 0, ryo: 0 },
  };
  let fights = 0;
  let fightsWithAllies = 0;
  let cloneXp = 0;
  const actionMs = { main: 0, clone: 0 };
  let seenFight: object | null = null;
  let seenAlly = false;
  let prev: {
    kind: 'mission' | 'practice' | 'fight' | null;
    ally: boolean;
    xp: number;
    ryo: number;
    now: number;
  } | null = null;

  const totalXp = (state: GameState): number =>
    Object.values(state.skills).reduce((a, s) => a + s.xp, 0);

  const result = runBot(bot, {
    seed: options.seed,
    content,
    rules,
    limitMs: options.hours * HOUR,
    rejectLimit: Number.MAX_SAFE_INTEGER,
    ...(options.strategy.sessions ? { away: options.strategy.sessions } : {}),
    observer: {
      step(state, ms) {
        if (prev) {
          const dt = state.now - prev.now;
          const dxp = totalXp(state) - prev.xp;
          const dryo = Math.max(0, (state.currencies[money] ?? 0) - prev.ryo);
          const buckets = [prev.kind ? kinds[prev.kind] : null];
          if (prev.kind === 'fight' && prev.ally) buckets.push(kinds.fightAlly);
          for (const b of buckets) {
            if (!b) continue;
            b.ms += dt;
            b.xp += dxp;
            b.ryo += dryo;
          }
        }
        const action = state.slots[0]?.action ?? null;
        const kind = action
          ? action.kind === 'mission'
            ? 'mission'
            : FIGHT_KINDS.has(action.kind)
              ? 'fight'
              : 'practice'
          : null;
        // A fight is counted once, when its object appears; it has allies when one was ever made in it.
        const fight = state.combat?.phase === 'fight' ? state.combat.fight : null;
        if (fight !== seenFight) {
          if (seenFight !== null) {
            fights++;
            if (seenAlly) fightsWithAllies++;
          }
          seenFight = fight;
          seenAlly = false;
        }
        if (fight && (fight.allied ?? 0) > 0) seenAlly = true;
        prev = {
          kind,
          ally: kind === 'fight' && fight !== null && (fight.allied ?? 0) > 0,
          xp: totalXp(state),
          ryo: state.currencies[money] ?? 0,
          now: state.now,
        };
        if (action) actionMs.main += ms;
        for (let at = 1; at < state.slots.length; at++) {
          const held = state.slots[at]?.action;
          if (held && held.kind !== STAND_KIND) actionMs.clone += ms;
        }
        if (levelsAt3h === null && state.now >= TARGETS.firstHours * HOUR) {
          levelsAt3h = Object.fromEntries(
            trainable(state, content).map((id) => [id, levelAt(state.skills[id]?.xp ?? 0, cap)]),
          );
        }
        if (cloneAt === null && cloneSlots(state, content).length > 0) cloneAt = state.now;
      },
      // Looked at after time has moved, so the step that ends the run (the vest, the cap) is seen too.
      after(state) {
        if (
          minAtChunin === null &&
          state.player.rank === content.playerRanks[content.playerRanks.length - 1]?.id
        ) {
          minAtChunin = Math.min(
            ...trainable(state, content).map((id) => levelAt(state.skills[id]?.xp ?? 0, cap)),
          );
        }
        if (
          capAt === null &&
          state.player.natures.length > 0 &&
          trainable(state, content).every((id) => levelAt(state.skills[id]?.xp ?? 0, cap) >= cap)
        ) {
          capAt = state.now;
        }
      },
      event(event) {
        if (event.type === 'cloneDispelled') {
          cloneXp += Object.values(event.xp).reduce((a, b) => a + b, 0);
        }
      },
    },
  });

  // The fight still going at the end counts too.
  if (seenFight !== null) {
    fights++;
    if (seenAlly) fightsWithAllies++;
  }

  const state = result.state;
  const levels = Object.fromEntries(
    trainable(state, content).map((id) => [id, levelAt(state.skills[id]?.xp ?? 0, cap)]),
  );
  const rankAt = (rank: string): number | null => {
    const m = result.timeline.find((x) => x.type === 'rank' && x.id === rank);
    return m ? m.at / HOUR : null;
  };
  const graduate = content.playerRanks.find((r) => r.academy !== true)?.id ?? 'genin';
  const last = content.playerRanks[content.playerRanks.length - 1]?.id ?? 'chunin';

  // Milestones: ranks, quest steps, the clone technique, and every tenth level of a skill (the first time).
  const marks: { at: number; label: string }[] = [{ at: 0, label: 'старт' }];
  const seen = new Set<string>();
  for (const m of result.timeline) {
    if (m.type === 'skill') {
      if (!GAP_SKILL_LEVELS.includes(m.level)) continue;
      const key = `${m.id}:${m.level}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    marks.push({ at: m.at, label: milestoneLabel(m, content) });
  }
  if (cloneAt !== null) marks.push({ at: cloneAt, label: 'техніка клонування' });
  marks.sort((a, b) => a.at - b.at);
  let gap = { hours: 0, after: 'старт' };
  let cadence: { hours: number; allowed: number; after: string } = {
    hours: 0,
    allowed: TARGETS.maxGapHours,
    after: 'старт',
  };
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i] as { at: number; label: string };
    const to = marks[i + 1]?.at ?? result.endedAt;
    if ((to - from.at) / HOUR > gap.hours)
      gap = { hours: (to - from.at) / HOUR, after: from.label };
    const span = (to - from.at) / HOUR;
    const allowed = Math.min(
      TARGETS.maxGapHours,
      Math.max(TARGETS.minAllowedHours, TARGETS.maxGapShare * (to / HOUR)),
    );
    if (span / allowed > cadence.hours / cadence.allowed)
      cadence = { hours: span, allowed, after: from.label };
  }

  const openMs = state.counters[CLONE_OPEN_MS] ?? 0;
  const runMs = state.counters[CLONE_RUN_MS] ?? 0;
  return {
    strategy: options.strategy.id,
    triple: [...options.triple],
    seed: options.seed,
    ended: result.ended,
    hours: result.endedAt / HOUR,
    levelsAt3h: levelsAt3h ?? Object.fromEntries(Object.keys(levels).map((id) => [id, 0])),
    genin: rankAt(graduate),
    clone: cloneAt === null ? null : cloneAt / HOUR,
    chunin: rankAt(last),
    cap: capAt === null ? null : capAt / HOUR,
    longestGap: gap,
    cadence,
    cloneShareRun: result.endedAt > 0 ? runMs / result.endedAt : 0,
    cloneShareOpen: openMs > 0 ? runMs / openMs : null,
    mission: kinds.mission,
    practice: kinds.practice,
    fight: kinds.fight,
    fightAlly: kinds.fightAlly,
    fights,
    fightsWithAllies,
    cloneXp,
    totalXp: totalXp(state),
    actionMs,
    levels,
    minLevel: Math.min(...Object.values(levels)),
    minLevelAtChunin: minAtChunin,
    rank: state.player.rank,
    rejected: result.rejected,
    firstRejection: result.firstRejection,
    blocked: bot.memory.blocked,
    quests: Object.fromEntries(
      Object.entries(state.quests).map(([id, q]) => [id, q.done ? 'done' : String(q.step)]),
    ),
    defeats: Object.fromEntries(
      Object.entries(state.counters)
        .filter(([key, n]) => key.startsWith('defeats.') && n > 0)
        .map(([key, n]) => [key.slice('defeats.'.length), n]),
    ),
    questsDoneAt: Object.fromEntries(
      result.timeline.flatMap((m) => (m.type === 'questDone' ? [[m.id, m.at / HOUR]] : [])),
    ),
    opsCleared: content.operations
      .filter((o) => state.flags[o.clearFlag] !== undefined)
      .map((o) => o.id),
  };
}

export { STRATEGIES };
