import {
  cloneSlots,
  evalReq,
  isAcademyRank,
  missionBoard,
  scrollOf,
  type Command,
  type Req,
  type ReqResult,
} from '@shinobi/core';
import type { ContentDb } from '@shinobi/content';
import type { Bot, BotContext } from '../bot.ts';
import { academyBot, leaves, trainLowest } from './academy.ts';

/** The techniques a requirement tree names. */
function techniquesIn(req: Req): string[] {
  if (req.t === 'technique') return [req.id];
  return req.t === 'all' || req.t === 'any' ? req.of.flatMap(techniquesIn) : [];
}

/** The chain of the content whose last step asks for a technique that opens an action slot. */
function cloneChain(content: ContentDb) {
  const opens = new Set(
    content.techniques.filter((t) => t.opensSlot !== undefined).map((t) => t.id),
  );
  return content.quests.find((q) =>
    q.steps.some(
      (s) => s.objective.t === 'req' && techniquesIn(s.objective.req).some((id) => opens.has(id)),
    ),
  );
}

/**
 * «Хочу клонів»: from a new game to the technique that opens the clone's slot. The Academy goes by
 * the Academy bot; after it the bot follows the chain that ends in the technique: it trains the
 * lowest unmet skill with the best action, runs the shortest mission of the rank a counter step
 * names, and reads the scroll when the step hands it over.
 */
export const clonesBot: Bot = {
  name: 'clones',
  description:
    'Хочу клонів: від нового збереження до Техніки тіньового клонування за лінією доручень.',
  goal: {
    label: 'Тіньове клонування',
    reached: (state, content) => cloneSlots(state, content).length > 0,
  },
  limitMs: 14 * 3_600_000,

  decide(ctx: BotContext): Command[] | null {
    const { state, content, rules } = ctx;
    if (isAcademyRank(content, state.player.rank)) return academyBot.decide(ctx);
    const out: Command[] = [];
    // The team of the village missions comes from the chakra paper test.
    const [first] = content.natures;
    if (state.team === null && first) out.push({ type: 'nature.choose', nature: first.id });

    const chain = cloneChain(content);
    const progress = chain && state.quests[chain.id];
    const objective = chain && progress ? chain.steps[progress.step]?.objective : undefined;
    if (!objective) return out.length > 0 ? out : null;
    const running = state.slots[0]?.action ?? null;
    const start = (kind: string, id: string): Command[] | null =>
      running?.kind === kind && running.id === id
        ? null
        : [{ type: 'action.start', slot: 0, kind, id }];

    if (objective.t === 'counter') {
      // `missions.rank.<rank>`: the shortest mission of that rank that can be started now.
      const rank = objective.counter.startsWith('missions.rank.')
        ? objective.counter.slice('missions.rank.'.length)
        : null;
      if (rank === null || running?.kind === 'mission') return out.length > 0 ? out : null;
      const doable = missionBoard(state, content, rules)
        .filter((m) => m.rank === rank && m.startable)
        .sort((a, b) => a.forecast.expectedMs - b.forecast.expectedMs);
      const pick = doable[0];
      return pick ? [...out, ...(start('mission', pick.id) ?? [])] : out.length > 0 ? out : null;
    }

    // A payment step belongs to another chain; the clone chain never asks for one.
    if (objective.t !== 'req') return out.length > 0 ? out : null;
    const unmet: ReqResult[] = leaves(evalReq(state, objective.req, content)).filter((r) => !r.met);
    // The scroll of the technique the step wants, when it is in the bank.
    for (const leaf of unmet) {
      if (leaf.req.t !== 'technique') continue;
      const scroll = scrollOf(leaf.req.id, content);
      if (scroll !== null && (state.bank[scroll] ?? 0) > 0) {
        return [...out, { type: 'item.use', id: scroll }];
      }
    }
    const trained = trainLowest(ctx, unmet, start);
    if (trained) return [...out, ...trained];
    return out.length > 0 ? out : null;
  },
};
