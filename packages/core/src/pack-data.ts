import type { ContentDb } from '@shinobi/content';
import type { DormantPack, JsonValue } from './state.ts';
import { isNature, packOfId, rankIndex } from './vocab.ts';

/*
 * What a save does with the data of packs that the content no longer has. The loader drops every
 * id the content does not know; for an id of a pack that is missing it first moves the entry to a
 * dormant bucket (`state.dormant[pack]`), and when the pack is back the entries return to the
 * branches they came from. Everything here reads untrusted text: keys are checked against the
 * names of `Object`, sizes are bounded and numbers are clamped.
 */

type Raw = Record<string, unknown>;

const isRecord = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The keyed branches of the state whose entries can belong to a pack, by the pack named in the key. */
export const DORMANT_FIELDS = [
  'skills',
  'pools',
  'mastery',
  'bank',
  'currencies',
  'known',
  'flags',
  'counters',
  'quests',
  'gear',
  'bushes',
  'meditation',
  'buffs',
  'bingo',
  'report',
] as const;

/** Most packs, most entries per branch and longest text a bucket keeps; the rest of a tampered save is dropped. */
const MAX_PACKS = 32;
const MAX_ENTRIES = 4000;
const MAX_TEXT = 256;
/** The biggest number a bucket keeps; bigger ones are cut. */
export const MAX_NUMBER = 1e15;
const JSON_DEPTH = 6;

const PACK_ID = /^[a-z][a-z0-9_]*$/;
const RESERVED: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

/** Whether a string may be a key of a record that came from a save: no member name of `Object`. */
export const safeKey = (key: string): boolean => !RESERVED.has(key);

/** A pack id as the manifests spell it, and not a name of `Object`. */
export const validPackId = (id: unknown): id is string =>
  typeof id === 'string' && PACK_ID.test(id) && safeKey(id);

/** Every pack id that a key names as `<pack>:<slug>` (`kills.testmod:wolf` names `testmod`). */
export function packsInKey(key: string): string[] {
  const out: string[] = [];
  for (const m of key.matchAll(/(?:^|[^a-z0-9_:])([a-z][a-z0-9_]*):[a-z0-9_]/g)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/** A value of plain JSON, bounded in depth, size and number size; undefined when it is none. */
export function cleanJson(x: unknown, depth = 0): JsonValue | undefined {
  if (x === null || typeof x === 'boolean') return x;
  if (typeof x === 'string') return x.length <= MAX_TEXT ? x : undefined;
  if (typeof x === 'number') {
    return Number.isFinite(x) ? Math.max(-MAX_NUMBER, Math.min(MAX_NUMBER, x)) : undefined;
  }
  if (depth >= JSON_DEPTH) return undefined;
  if (Array.isArray(x)) {
    if (x.length > MAX_TEXT) return undefined;
    const items = x.map((v) => cleanJson(v, depth + 1));
    return items.every((v) => v !== undefined) ? (items as JsonValue[]) : undefined;
  }
  if (!isRecord(x)) return undefined;
  const entries = Object.entries(x);
  if (entries.length > MAX_TEXT) return undefined;
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of entries) {
    const v = cleanJson(value, depth + 1);
    if (v === undefined || !safeKey(key)) return undefined;
    out[key] = v;
  }
  return out;
}

const text = (x: unknown, max = MAX_TEXT): string | null =>
  typeof x === 'string' && x.length > 0 && x.length <= max ? x : null;

/** The dormant buckets of a save, checked field by field. Anything unusable is dropped. */
export function sanitizeDormant(raw: unknown): Record<string, DormantPack> {
  const out: Record<string, DormantPack> = {};
  if (!isRecord(raw)) return out;
  for (const [pack, bucket] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_PACKS) break;
    if (!validPackId(pack) || pack === 'core' || !isRecord(bucket)) continue;
    const natures = Array.isArray(bucket.natures)
      ? bucket.natures.flatMap((n: unknown) => (text(n) !== null ? [n as string] : [])).slice(0, 16)
      : [];
    const data: Record<string, Record<string, JsonValue>> = {};
    if (isRecord(bucket.data)) {
      for (const field of DORMANT_FIELDS) {
        const source = bucket.data[field];
        if (!isRecord(source)) continue;
        const entries: Record<string, JsonValue> = {};
        for (const [key, value] of Object.entries(source).slice(0, MAX_ENTRIES)) {
          const v = cleanJson(value);
          if (key.length > 0 && key.length <= MAX_TEXT && safeKey(key) && v !== undefined) {
            entries[key] = v;
          }
        }
        if (Object.keys(entries).length > 0) data[field] = entries;
      }
    }
    out[pack] = {
      version: typeof bucket.version === 'string' ? bucket.version.slice(0, 64) : '',
      rank: text(bucket.rank),
      natures,
      data,
    };
  }
  return out;
}

/** The pack list of a save: valid ids with their versions, no repeats. */
export function sanitizePacks(raw: unknown): { id: string; version: string }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: { id: string; version: string }[] = [];
  for (const entry of raw.slice(0, MAX_PACKS)) {
    if (!isRecord(entry) || !validPackId(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({
      id: entry.id,
      version: typeof entry.version === 'string' ? entry.version.slice(0, 64) : '',
    });
  }
  return out;
}

/** The rank order of a save: ids only, bounded. */
export function sanitizeRankOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TEXT).flatMap((r: unknown) => (text(r) !== null ? [r as string] : []));
}

function bucket(
  dormant: Record<string, DormantPack>,
  pack: string,
  saved: ReadonlyMap<string, string>,
): DormantPack | null {
  if (!validPackId(pack) || pack === 'core') return null;
  const have = dormant[pack];
  if (have) return have;
  if (Object.keys(dormant).length >= MAX_PACKS) return null;
  return (dormant[pack] = { version: saved.get(pack) ?? '', rank: null, natures: [], data: {} });
}

/**
 * Moves the entries of `raw` that belong to a pack the content does not have into `dormant`, and
 * returns a copy of `raw` without them. The entries are found by the pack named in their key. The
 * rank and the natures of such a pack are settled separately (`settlePlayer`).
 */
export function stashMissing(
  raw: Raw,
  content: ContentDb,
  dormant: Record<string, DormantPack>,
  saved: ReadonlyMap<string, string>,
): Raw {
  const loaded = new Set(content.packs.map((p) => p.id));
  const out: Raw = { ...raw };
  for (const field of DORMANT_FIELDS) {
    const source = raw[field];
    if (!isRecord(source)) continue;
    const kept: Raw = {};
    for (const [key, value] of Object.entries(source)) {
      if (!safeKey(key)) continue;
      const away = packsInKey(key).find((p) => !loaded.has(p));
      if (away === undefined) {
        kept[key] = value;
        continue;
      }
      const target = bucket(dormant, away, saved);
      const clean = cleanJson(value);
      if (!target || clean === undefined || key.length > MAX_TEXT) continue;
      const branch = (target.data[field] ??= {});
      if (Object.keys(branch).length < MAX_ENTRIES) branch[key] = clean;
    }
    out[field] = kept;
  }
  return out;
}

/**
 * Returns the dormant entries of packs that are present now to the branches of `raw` and drops
 * their buckets. An entry that `raw` already has wins.
 */
export function restoreDormant(
  raw: Raw,
  content: ContentDb,
  dormant: Record<string, DormantPack>,
): { raw: Raw; restored: DormantPack[] } {
  const out: Raw = { ...raw };
  const restored: DormantPack[] = [];
  for (const pack of content.packs) {
    const held = dormant[pack.id];
    if (!held) continue;
    restored.push(held);
    delete dormant[pack.id];
    for (const [field, entries] of Object.entries(held.data)) {
      const now = isRecord(out[field]) ? (out[field] as Raw) : {};
      const merged: Raw = { ...now };
      for (const [key, value] of Object.entries(entries)) {
        if (!Object.hasOwn(merged, key)) merged[key] = value;
      }
      out[field] = merged;
    }
  }
  return { raw: out, restored };
}

/**
 * The rank and the natures a save names, settled against the content: a rank the content does not
 * know falls back along the saved rank order to the highest rank it does know (its own pack's
 * bucket keeps it), natures it does not know are dropped (their buckets keep the saved list), and
 * what returning packs kept comes back.
 */
export function settlePlayer(
  player: Raw,
  content: ContentDb,
  savedOrder: readonly string[],
  restored: readonly DormantPack[],
  dormant: Record<string, DormantPack>,
  saved: ReadonlyMap<string, string>,
): { rank: string | null; natures: string[] } {
  const loaded = new Set(content.packs.map((p) => p.id));
  const first = content.playerRanks[0]?.id ?? null;
  let rank = typeof player.rank === 'string' ? player.rank : '';
  if (rankIndex(content, rank) < 0) {
    const pack = packOfId(rank);
    if (rank !== '' && !loaded.has(pack)) {
      const target = bucket(dormant, pack, saved);
      if (target && text(rank) !== null) target.rank = rank;
    }
    let fallback = first;
    for (let i = savedOrder.indexOf(rank) - 1; i >= 0; i--) {
      const earlier = savedOrder[i];
      if (earlier !== undefined && rankIndex(content, earlier) >= 0) {
        fallback = earlier;
        break;
      }
    }
    rank = fallback ?? '';
  }
  // A returning pack gives its rank back when it is higher than the one held.
  for (const held of restored) {
    if (held.rank !== null && rankIndex(content, held.rank) > rankIndex(content, rank)) {
      rank = held.rank;
    }
  }

  const list: string[] = Array.isArray(player.natures)
    ? player.natures.flatMap((n: unknown) => (typeof n === 'string' ? [n] : []))
    : [];
  let natures = list.filter((n) => isNature(content, n));
  for (const n of list) {
    if (isNature(content, n)) continue;
    const pack = packOfId(n);
    if (loaded.has(pack)) continue;
    const target = bucket(dormant, pack, saved);
    if (target) target.natures = list.filter((x) => text(x) !== null).slice(0, 16);
  }
  for (const held of restored) {
    if (held.natures.length === 0) continue;
    const back = held.natures.filter((n) => isNature(content, n));
    natures = [...back, ...natures.filter((n) => !back.includes(n))];
  }
  return { rank: rank === '' ? null : rank, natures: [...new Set(natures)] };
}

/** The ids of the packs of a save that the content does not have and of the content's that the save lacks. */
export function packDiff(
  saved: readonly { id: string }[],
  content: ContentDb,
): { added: string[]; removed: string[] } {
  const before = new Set(saved.map((p) => p.id));
  const after = new Set(content.packs.map((p) => p.id));
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
  };
}

/** Whether a number is a usable balance: finite and not negative, cut at the biggest number a save keeps. */
export const balanceOf = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(x, MAX_NUMBER) : 0;
