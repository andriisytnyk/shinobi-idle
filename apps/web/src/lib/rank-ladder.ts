import type { ContentDb, Exam, Operation, Req } from '@shinobi/content';
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

/** One thing a rank gives besides what it unlocks: more loadout slots, another nature, a pouch slot. */
export interface RankPerk {
  kind: 'slots' | 'natures' | 'pouch';
  /** The count the rank gives (for `pouch`, the extra slots). */
  n: number;
}

/**
 * What a rank adds to the player's kit, read from the balance: the loadout slots and the natures
 * a rank allows (shown when they exceed what the rank before gave) and the pouch slot of the
 * vest the balance ties to the rank.
 */
export function perksOf(content: ContentDb, rank: string): RankPerk[] {
  const K = content.balance.K;
  const order = content.playerRanks.map((r) => r.id);
  const at = order.indexOf(rank);
  const before = (table: Record<string, number>): number => {
    for (let i = at - 1; i >= 0; i--) {
      const value = table[order[i] ?? ''];
      if (value !== undefined) return value;
    }
    return 0;
  };
  const perks: RankPerk[] = [];
  const slots = K.loadout.slots[rank];
  if (slots !== undefined && slots > before(K.loadout.slots))
    perks.push({ kind: 'slots', n: slots });
  const natures = K.loadout.natures[rank];
  if (natures !== undefined && natures > before(K.loadout.natures))
    perks.push({ kind: 'natures', n: natures });
  const vest = content.pouchKinds.reduce((n, k) => n + (k.vest ?? 0), 0);
  if (K.pouch.vestRank === rank && vest > 0) perks.push({ kind: 'pouch', n: vest });
  return perks;
}

/** The quests a requirement tree names. */
function questsIn(req: Req, out: string[] = []): string[] {
  if (req.t === 'quest') out.push(req.id);
  else if (req.t === 'all' || req.t === 'any') for (const child of req.of) questsIn(child, out);
  return out;
}

/**
 * The operations that make up the rest of a two-part exam: those whose unlock flag a step of a
 * chain the exam waits for opens (the Forest of Death and the tournament for the Chunin exam).
 */
export function examOperations(content: ContentDb, exam: Exam): Operation[] {
  if (!exam.then) return [];
  const opened = new Set(
    questsIn(exam.then).flatMap((id) =>
      (content.quests.find((q) => q.id === id)?.steps ?? []).flatMap((s) => s.opens ?? []),
    ),
  );
  return content.operations.filter((op) => op.unlock?.t === 'flag' && opened.has(op.unlock.id));
}
