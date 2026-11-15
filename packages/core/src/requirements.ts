import type { ContentDb, NatureId, SkillId } from '@shinobi/content';
import type { EntityRef } from './entity.ts';
import { indexOf } from './lookup.ts';
import type { GameState, Rank } from './state.ts';
import { buildingLevel } from './village-state.ts';
import { levelAt, levelCap } from './xp.ts';

export type Req =
  | { t: 'skill'; skill: SkillId; level: number }
  | { t: 'technique'; id: string }
  | { t: 'rank'; rank: Rank }
  | { t: 'nature'; nature: NatureId }
  | { t: 'item'; id: string; n: number }
  | { t: 'quest'; id: string; step?: number | undefined }
  | { t: 'building'; id: string; level: number }
  | { t: 'flag'; id: string; n?: number | undefined }
  | { t: 'all'; of: Req[] }
  | { t: 'any'; of: Req[] };

export interface ReqResult {
  req: Req;
  met: boolean;
  current: number;
  target: number;
  /** The entity the requirement line points at, if there is one. */
  ref: EntityRef | null;
  /** Results of the nested requirements for `all` and `any`; empty otherwise. */
  children: ReqResult[];
}

export const RANK_ORDER: readonly Rank[] = ['student', 'genin', 'chunin'];

export function skillLevel(state: GameState, skill: SkillId, content: ContentDb): number {
  return levelAt(state.skills[skill].xp, levelCap(content));
}

const flagValue = (state: GameState, id: string): number => {
  const v = state.flags[id];
  return v === undefined ? 0 : v === true ? 1 : v;
};


function leaf(req: Req, current: number, target: number, ref: EntityRef | null): ReqResult {
  return { req, met: current >= target, current, target, ref, children: [] };
}

/** Evaluates a requirement tree against the state. */
export function evalReq(state: GameState, req: Req, content: ContentDb): ReqResult {
  switch (req.t) {
    case 'skill':
      return leaf(req, skillLevel(state, req.skill, content), req.level, {
        kind: 'skill',
        id: req.skill,
      });
    case 'technique':
      return leaf(req, state.known[req.id] ? 1 : 0, 1, { kind: 'technique', id: req.id });
    case 'rank':
      return leaf(req, RANK_ORDER.indexOf(state.player.rank), RANK_ORDER.indexOf(req.rank), null);
    case 'nature':
      return leaf(req, state.player.natures.includes(req.nature) ? 1 : 0, 1, {
        kind: 'skill',
        id: req.nature,
      });
    case 'item':
      return leaf(req, state.bank[req.id] ?? 0, req.n, { kind: 'item', id: req.id });
    case 'quest': {
      // Steps finished against steps asked for; without `step` the whole chain must be done.
      const total = indexOf(content).quests.get(req.id)?.steps.length ?? 1;
      const progress = state.quests[req.id];
      const current = progress ? (progress.done ? total : progress.step) : 0;
      return leaf(req, current, req.step ?? total, { kind: 'quest', id: req.id });
    }
    case 'building':
      return leaf(req, buildingLevel(state, req.id), req.level, {
        kind: 'building',
        id: req.id,
      });
    case 'flag':
      return leaf(req, flagValue(state, req.id), req.n ?? 1, null);
    case 'all':
    case 'any': {
      const children = req.of.map((r) => evalReq(state, r, content));
      const done = children.filter((c) => c.met).length;
      const all = req.t === 'all';
      return {
        req,
        met: all ? done === children.length : done > 0,
        current: done,
        target: all ? children.length : 1,
        ref: null,
        children,
      };
    }
  }
}
