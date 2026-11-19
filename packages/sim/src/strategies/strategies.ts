import type { NatureId } from '@shinobi/content';
import {
  buyPrice,
  evalReq,
  isAcademyRank,
  learnReq,
  listSkillActions,
  moneyOf,
  scrollOf,
  shopEntries,
  type ActionInfo,
  COURSE_KIND,
  SENSEI_TEST_KIND,
  type Command,
} from '@shinobi/core';
import type { Bot, BotContext } from '../bot.ts';
import { academyBot } from '../bots/academy.ts';
import {
  bestMission,
  clonePlan,
  createMemory,
  exploreAny,
  fightBest,
  housekeeping,
  noteDefeats,
  objectivePlan,
  startIn,
  storyPlan,
  trainAny,
  trainLowestOf,
  trainableSkills,
  TUNING,
  type Memory,
  type Plan,
  type Toolkit,
} from './toolkit.ts';
import { KIND_CRAFT } from '../constants.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The collector works on this many of the least mastered actions in turn, each for this long. */
const COLLECTOR_POOL = 6;
const COLLECTOR_TURN_MS = 15 * MINUTE;

export type StrategyId = 'story' | 'collector' | 'fighter' | 'peaceful' | 'offline';

/** How an away player is awake: `awakeMs` at the start of every `periodMs`. */
export interface Sessions {
  periodMs: number;
  awakeMs: number;
}

export interface Strategy {
  id: StrategyId;
  /** Ukrainian name for the report. */
  label: string;
  description: string;
  /** Whether a fight may be started just to train (a peaceful player never does). */
  fightsToTrain: boolean;
  /** Whether the pace targets (Chunin hours, cadence, lowest skill at the vest) judge this bot: the story bot, which follows every step of the story and trains the lowest skill in turn. The peaceful bot reaches the vest too but keeps to missions and never trains the crafts, so its numbers are listed for reference. */
  judged: boolean;
  sessions?: Sessions;
  /** The main activity: the plan for slot 0 once the Academy is behind the player. */
  main(tk: Toolkit): Plan;
}

/** Every unfinished operation that is open, tried in the order of the content. */
function operations(tk: Toolkit): Plan {
  const { content, state } = tk.ctx;
  for (const op of content.operations) {
    if (state.flags[op.clearFlag] !== undefined) continue;
    const plan = objectivePlan(tk, { t: 'req', req: { t: 'flag', id: op.clearFlag } });
    if (
      plan !== null &&
      plan.length > 0 &&
      plan.some((c) => c.type === 'action.start' && c.kind === 'operation')
    ) {
      return plan;
    }
    if (plan !== null && plan.length === 0) return plan;
  }
  return null;
}

/** The story steps that are about killing something: the only part of the story a fighter plays. */
function killSteps(tk: Toolkit): Plan {
  const { content, state } = tk.ctx;
  for (const quest of content.quests) {
    const progress = state.quests[quest.id];
    const step = progress && !progress.done ? quest.steps[progress.step] : undefined;
    if (step?.objective.t !== 'counter' || !step.objective.counter.startsWith('kills.')) continue;
    const plan = objectivePlan(
      tk,
      step.objective as unknown as { t: string } & Record<string, unknown>,
    );
    if (plan !== null && plan.length > 0 && plan.some((c) => c.type === 'action.start'))
      return plan;
  }
  return null;
}

/** The action of any skill with the lowest Mastery (the collector's pick), among what can be started now. */
function lowestMastery(tk: Toolkit): Plan {
  const { state, content, rules } = tk.ctx;
  const open: ActionInfo[] = [];
  for (const skill of trainableSkills(tk)) {
    if (content.skills.find((s) => s.id === skill)?.group === 'combat') continue;
    for (const a of listSkillActions(state, skill, content, rules)) {
      if (!a.available || a.kind === KIND_CRAFT) continue;
      if (a.kind === COURSE_KIND && Object.keys(state.course).length === 0) continue;
      if (a.masteryProgress >= 1 && a.masteryLevel >= content.balance.K.masteryCap) continue;
      open.push(a);
    }
  }
  // The few least mastered actions in turn, so the collection grows evenly.
  open.sort(
    (a, b) =>
      a.masteryLevel - b.masteryLevel ||
      a.masteryProgress - b.masteryProgress ||
      (a.id < b.id ? -1 : 1),
  );
  const pool = open.slice(0, COLLECTOR_POOL);
  const pick = pool[Math.floor(state.now / COLLECTOR_TURN_MS) % Math.max(1, pool.length)];
  return pick ? startIn(tk, pick.kind, pick.id) : null;
}

/** The collector's shopping: every scroll the shop sells for a technique that is not yet known and can already be read. */
function collectScrolls(tk: Toolkit): Command[] {
  const { state, content } = tk.ctx;
  const out: Command[] = [];
  let purse = state.currencies[moneyOf(content)] ?? 0;
  for (const t of content.techniques) {
    if (state.known[t.id]) continue;
    const scroll = scrollOf(t.id, content);
    if (scroll === null || (state.bank[scroll] ?? 0) > 0) continue;
    const entry = shopEntries(content).find((s) => s.item === scroll);
    if (!entry || !evalReq(state, entry.req, content).met) continue;
    if (!evalReq(state, learnReq(t, content), content).met) continue;
    const price = buyPrice(scroll, content) ?? Infinity;
    if (price > purse) continue;
    purse -= price;
    out.push({ type: 'shop.buy', item: scroll, n: 1 });
  }
  return out;
}

const phase = (tk: Toolkit, ms: number, parts: number): number =>
  Math.floor(tk.ctx.state.now / ms) % parts;

/** Whether the away player is about to leave: the last minutes of the session. */
function leavingSoon(tk: Toolkit, s: Sessions): boolean {
  const at = tk.ctx.state.now % s.periodMs;
  return at >= s.awakeMs - 3 * MINUTE;
}

/** Something that runs for hours without help: the lowest skill that trains by itself (no goods, no fight). */
function robustTraining(tk: Toolkit): Plan {
  const { content } = tk.ctx;
  const skills = trainableSkills(tk).filter((s) => {
    const def = content.skills.find((d) => d.id === s);
    return def && def.group !== 'combat' && def.activity !== 'station' && def.activity !== 'recipe';
  });
  return trainLowestOf(tk, skills);
}

export const STRATEGIES: Readonly<Record<StrategyId, Strategy>> = {
  story: {
    id: 'story',
    label: 'Сюжетник',
    description: 'Іде за ланцюжками доручень і іспитом; між кроками тренує найнижчу навичку.',
    fightsToTrain: true,
    judged: true,
    // A quarter of the time goes to the lowest skill, as a player who spreads his training does (the story asks for only some).
    main: (tk) =>
      (phase(tk, 30 * MINUTE, 4) === 3 ? trainAny(tk) : null) ?? storyPlan(tk) ?? trainAny(tk),
  },
  collector: {
    id: 'collector',
    label: 'Колекціонер',
    description: 'Майстерності й колекції: сувої, найменш опановані дії, розвідка всіх клітин.',
    fightsToTrain: true,
    judged: false,
    main(tk) {
      const slice = phase(tk, 20 * MINUTE, 4);
      if (slice === 3) return exploreAny(tk) ?? lowestMastery(tk) ?? trainAny(tk);
      return lowestMastery(tk) ?? trainAny(tk);
    },
  },
  fighter: {
    id: 'fighter',
    label: 'Лише бій',
    description: 'Бої й операції, коли можливо; з сюжету бере лише вбивства.',
    fightsToTrain: true,
    judged: false,
    main: (tk) => operations(tk) ?? killSteps(tk) ?? fightBest(tk) ?? trainAny(tk),
  },
  peaceful: {
    id: 'peaceful',
    label: 'Мирний',
    description: 'Місії, ремесла й тренування; боїв лише стільки, скільки змушує сюжет.',
    fightsToTrain: false,
    judged: false,
    main(tk) {
      if (phase(tk, 30 * MINUTE, 2) === 0) {
        return bestMission(tk) ?? storyPlan(tk) ?? trainAny(tk);
      }
      return storyPlan(tk) ?? trainAny(tk);
    },
  },
  offline: {
    id: 'offline',
    label: 'Офлайн-гравець',
    description: 'Сесія 10 хвилин раз на 8 годин; перед виходом ставить тривалу дію.',
    fightsToTrain: true,
    judged: false,
    sessions: { periodMs: 8 * HOUR, awakeMs: 10 * MINUTE },
    main(tk) {
      const sessions = this.sessions;
      if (sessions && leavingSoon(tk, sessions)) return robustTraining(tk) ?? trainAny(tk);
      return storyPlan(tk) ?? trainAny(tk);
    },
  },
};

export const STRATEGY_IDS = Object.keys(STRATEGIES) as StrategyId[];

/** A strategy bot and what it remembered, for the report. */
export interface StrategyBot extends Bot {
  memory: Memory;
  strategy: Strategy;
}

/**
 * The bot of one strategy for one triple of natures (the first is the native one). A new instance
 * is made for every run: it remembers bans and win-rate estimates.
 */
export function createStrategyBot(strategy: Strategy, triple: readonly NatureId[]): StrategyBot {
  const mem = createMemory();
  return {
    name: `${strategy.id}:${triple.join('+')}`,
    description: strategy.description,
    // Nothing is left to measure once the last rank is held: the skill cap is not a target (author, 18.11).
    goal: {
      label: 'жилет Чуніна',
      reached: (state, content) =>
        state.player.rank === content.playerRanks[content.playerRanks.length - 1]?.id,
    },
    reviewMs: TUNING.reviewMs,
    memory: mem,
    strategy,

    decide(ctx: BotContext): Command[] | null {
      const { state, content } = ctx;
      const tk: Toolkit = { ctx, mem, triple, fightsToTrain: strategy.fightsToTrain };
      if (isAcademyRank(content, state.player.rank)) {
        // An away player sets the lowest skill to train before leaving; otherwise the Academy bot plays.
        if (strategy.sessions && leavingSoon(tk, strategy.sessions)) return robustTraining(tk);
        return academyBot.decide(ctx);
      }
      noteDefeats(tk);
      const out = housekeeping(tk);
      // An exam under way is let to finish; one that starts now takes the slot.
      if (
        out.some((c) => c.type === 'exam.start') ||
        state.slots[0]?.action?.kind === SENSEI_TEST_KIND
      ) {
        return out;
      }
      if (strategy.id === 'collector') out.push(...collectScrolls(tk));
      const plan = strategy.main.call(strategy, tk);
      if (plan) out.push(...plan);
      const started = plan?.find((c) => c.type === 'action.start' && c.slot === 0);
      const slot0 =
        started && started.type === 'action.start'
          ? { kind: started.kind, id: started.id }
          : (state.slots[0]?.action ?? null);
      const mainSkill = slot0 ? skillOfAction(tk, slot0) : null;
      out.push(...clonePlan(tk, mainSkill));
      // A scroll is read once: the housekeeping and the story plan may both ask for the same one.
      // A village runs one build at a time: the first is the only one the game takes.
      const read = new Set<string>();
      let built = false;
      const unique = out.filter((c) => {
        if (c.type === 'village.build') {
          if (built) return false;
          built = true;
          return true;
        }
        if (c.type !== 'item.use') return true;
        if (read.has(c.id)) return false;
        read.add(c.id);
        return true;
      });
      return unique.length > 0 ? unique : null;
    },
  };
}

function skillOfAction(tk: Toolkit, action: { kind: string; id: string }): string | null {
  const { state, content, rules } = tk.ctx;
  for (const s of content.skills) {
    if (
      listSkillActions(state, s.id, content, rules).some(
        (a) => a.kind === action.kind && a.id === action.id,
      )
    ) {
      return s.id;
    }
  }
  return null;
}
