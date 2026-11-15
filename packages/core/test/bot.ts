import { content } from '@shinobi/content';
import type { SkillId } from '@shinobi/content';
import { advance, dispatch, rate, skillLevel, type GameState } from '../src/index.ts';

interface Candidate {
  skill: SkillId;
  kind: string;
  id: string;
  rate: number;
}

/** Every training action the content offers, with the XP per hour it pays. */
function candidates(state: GameState): Candidate[] {
  const out: Candidate[] = [];
  for (const t of content.techniques) {
    if (state.known[t.id] && t.role !== 'drill' && t.rank !== null) {
      out.push({ skill: t.skill, kind: 'practice', id: t.id, rate: rate(t.level, content) });
    }
  }
  for (const e of content.exercises) {
    out.push({ skill: 'cc', kind: 'drill', id: e.id, rate: rate(e.level, content) });
  }
  for (const p of content.practices) {
    out.push({ skill: 'med', kind: 'meditate', id: p.id, rate: rate(p.level, content) });
  }
  for (const o of content.obstacles) {
    out.push({ skill: 'ath', kind: 'obstacle', id: o.id, rate: rate(o.level, content) });
  }
  return out.sort((a, b) => b.rate - a.rate);
}

/** What each skill must reach before the graduation can finish. */
const TARGETS: Partial<Record<SkillId, number>> = { tai: 10, nin: 10, cc: 10, ath: 5, med: 5 };

const level = (state: GameState, skill: SkillId) => skillLevel(state, skill, content);

export interface Run {
  minutes: number;
  state: GameState;
}

/**
 * A greedy player that only uses `dispatch` and `advance`: it trains whichever needed skill pays
 * the most XP per hour, fights dummies once the quest asks for it, then takes the sensei test.
 */
export function greedyToGenin(state: GameState, limitMinutes = 240): Run {
  const step = 5000;
  while (state.player.rank === 'student' && state.now < limitMinutes * 60_000) {
    const quest = state.quests['core:graduation'];
    // The sensei test is the last step of the chain; the bot takes it once the first four are done.
    if (quest && quest.step >= 4) {
      const running = state.slots[0]?.action?.kind === 'senseiTest';
      if (running || dispatch(state, { type: 'exam.genin.start' }, content).ok) {
        advance(state, step, content);
        continue;
      }
    }
    const needed = (Object.keys(TARGETS) as SkillId[]).filter(
      (s) => level(state, s) < (TARGETS[s] ?? 0),
    );
    const dummiesWanted = needed.length === 0 && quest !== undefined && quest.step >= 3;
    if (dummiesWanted) {
      if (state.slots[0]?.action?.kind !== 'fight') {
        dispatch(
          state,
          { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' },
          content,
        );
      }
    } else if (needed.length > 0) {
      const best = candidates(state).find((c) => needed.includes(c.skill) && canStart(state, c));
      const now = state.slots[0]?.action;
      if (best && (now?.kind !== best.kind || now.id !== best.id)) {
        dispatch(state, { type: 'action.start', slot: 0, kind: best.kind, id: best.id }, content);
      }
    }
    advance(state, step, content);
  }
  return { minutes: state.now / 60_000, state };
}

function canStart(state: GameState, c: Candidate): boolean {
  const copy = structuredClone(state);
  return dispatch(copy, { type: 'action.start', slot: 0, kind: c.kind, id: c.id }, content).ok;
}
