import {
  COURSE_KIND,
  courseSkill,
  evalReq,
  examFor,
  graduateRank,
  isAcademyRank,
  listSkillActions,
  type ActionInfo,
  type Command,
  type ReqResult,
} from '@shinobi/core';
import type { Bot, BotContext } from '../bot.ts';

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
  goal: {
    label: 'Генін',
    reached: (state, content) => !isAcademyRank(content, state.player.rank),
  },

  decide({ state, content, rules }: BotContext): Command[] | null {
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
      // Athletics runs the course: the first time, the free obstacle of slot 1 has to be built.
      const course = courseSkill(content);
      if (
        course !== null &&
        target.req.skill === course &&
        Object.keys(state.course).length === 0
      ) {
        const free = content.obstacles.find((o) => o.slot === content.balance.K.athletics.freeSlot);
        if (!free) return null;
        return [
          { type: 'athletics.build', slot: free.slot, obstacle: free.id },
          ...(start(COURSE_KIND, course) ?? []),
        ];
      }
      let best: ActionInfo | null = null;
      for (const action of listSkillActions(state, target.req.skill, content, rules)) {
        if (action.available && (!best || action.xpPerHour > best.xpPerHour)) best = action;
      }
      return best ? start(best.kind, best.id) : null;
    }

    const rank = unmet.find((r) => r.req.t === 'rank')?.req;
    if (rank?.t === 'rank' && running?.kind !== 'senseiTest') {
      const graduation = graduateRank(content);
      const exam = graduation === null ? undefined : examFor(content, graduation);
      if (
        graduation !== null &&
        rank.rank === graduation &&
        exam &&
        evalReq(state, exam.checklist, content).met
      ) {
        return [{ type: 'exam.start', rank: graduation }];
      }
    }
    return null;
  },
};
