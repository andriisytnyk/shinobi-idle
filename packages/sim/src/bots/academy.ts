import type { ContentDb } from '@shinobi/content';
import {
  evalReq,
  examFor,
  listSkillActions,
  type ActionInfo,
  type Command,
  type GameState,
  type ReqResult,
} from '@shinobi/core';
import type { Bot } from '../bot.ts';

const leaves = (r: ReqResult): ReqResult[] =>
  r.children.length > 0 ? r.children.flatMap(leaves) : [r];

/**
 * Act 1: follows the objective of the active quest step. It trains the lowest-level skill the
 * step still wants with the action that pays the most XP, fights the enemy a kill objective
 * names, and starts the rank exam once the exam's checklist holds.
 */
export const academyBot: Bot = {
  name: 'academy',
  description: 'Академія: від нового збереження до Геніна за квестом «Випуск».',
  isDone: (state) => state.player.rank !== 'student',

  decide(state: Readonly<GameState>, content: ContentDb): Command[] | null {
    const quest = content.quests.find((q) => {
      const progress = state.quests[q.id];
      return progress && !progress.done;
    });
    const progress = quest && state.quests[quest.id];
    const objective = quest && progress ? quest.steps[progress.step]?.objective : undefined;
    if (!objective) return null;
    const running = state.slots[0]?.action ?? null;
    const start = (kind: string, id: string): Command[] | null =>
      running?.kind === kind && running.id === id
        ? null
        : [{ type: 'action.start', slot: 0, kind, id }];

    if (objective.t === 'counter') {
      return objective.counter.startsWith('kills.')
        ? start('fight', objective.counter.slice('kills.'.length))
        : null;
    }

    const unmet = leaves(evalReq(state, objective.req, content)).filter((r) => !r.met);
    const skills = unmet.filter((r) => r.req.t === 'skill');
    if (skills.length > 0) {
      // Lowest current level first; the first listed wins a tie.
      const target = skills.reduce((a, b) => (b.current < a.current ? b : a));
      if (target.req.t !== 'skill') return null;
      let best: ActionInfo | null = null;
      for (const action of listSkillActions(state, target.req.skill, content)) {
        if (action.available && (!best || action.xpPerHour > best.xpPerHour)) best = action;
      }
      return best ? start(best.kind, best.id) : null;
    }

    const rank = unmet.find((r) => r.req.t === 'rank')?.req;
    if (rank?.t === 'rank' && running?.kind !== 'senseiTest') {
      const exam = examFor(content, 'genin');
      if (rank.rank === 'genin' && exam && evalReq(state, exam.checklist, content).met) {
        return [{ type: 'exam.genin.start' }];
      }
    }
    return null;
  },
};
