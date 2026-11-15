import type { ContentDb } from '@shinobi/content';
import type { EntityRef } from './route.ts';
import { rankIndex } from './vocab.ts';

export interface RankEntry {
  id: string;
  /** `done`: held or passed; `current`: the rank held now; `ahead`: not reached. */
  state: 'done' | 'current' | 'ahead';
  /** The exam that leads to the rank, when it has one. */
  exam: string | null;
  /** Entities that wait for the rank: skills and missions whose requirement names it. */
  opens: EntityRef[];
}

/** Whether a requirement tree names this rank. */
function needsRank(req: unknown, rank: string): boolean {
  if (req === null || typeof req !== 'object') return false;
  const node = req as { t?: string; rank?: string; of?: unknown[] };
  if (node.t === 'rank') return node.rank === rank;
  return Array.isArray(node.of) && node.of.some((child) => needsRank(child, rank));
}

/** The ranks in order with what each one is and opens, read from the content. */
export function rankEntries(content: ContentDb, current: string): RankEntry[] {
  const at = rankIndex(content, current);
  const withReq: { ref: EntityRef; req: unknown }[] = [
    ...content.skills.map((s) => ({ ref: { kind: 'skill', id: s.id }, req: s.unlockReq })),
    ...content.missions.map((m) => ({ ref: { kind: 'mission', id: m.id }, req: m.unlock })),
  ];
  return content.playerRanks.map((rank, i) => ({
    id: rank.id,
    state: i < at ? 'done' : i === at ? 'current' : 'ahead',
    exam: content.exams.find((e) => e.rank === rank.id)?.id ?? null,
    opens: withReq.filter((e) => needsRank(e.req, rank.id)).map((e) => e.ref),
  }));
}
