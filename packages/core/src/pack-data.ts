import type { ContentDb } from '@shinobi/content';
import type { DormantPack, JsonValue } from './state.ts';
import { GOAL_CAP } from './goal.ts';
import { PLACES, type Place } from './dormant-places.ts';
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

/** The suffix of the field that keeps ids of a missing pack found inside an entry that is kept (`report['core:wolf']` counting a pack's technique). */
export const NESTED = '~';

/** The fields of a dormant bucket: the dotted paths of the places of the state (`dormant-places.ts`). */
export const DORMANT_FIELDS: readonly string[] = PLACES.flatMap((p) => [
  p.path,
  `${p.path}${NESTED}`,
]);

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
export function sanitizePacks(raw: unknown): { id: string; version: string; since: number }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: { id: string; version: string; since: number }[] = [];
  for (const entry of raw.slice(0, MAX_PACKS)) {
    if (!isRecord(entry) || !validPackId(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({
      id: entry.id,
      version: typeof entry.version === 'string' ? entry.version.slice(0, 64) : '',
      since: Math.floor(balanceOf(entry.since)),
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

// ---------- moving the entries of a missing pack ----------

const asRecord = (x: unknown): Raw | undefined => (isRecord(x) ? x : undefined);

/** The value at a dotted path of `raw`, or undefined. */
function getAt(raw: Raw, path: string): unknown {
  let at: unknown = raw;
  for (const part of path.split('.')) {
    if (!isRecord(at) || !Object.hasOwn(at, part)) return undefined;
    at = at[part];
  }
  return at;
}

/** A copy of `raw` with the value at the path replaced; the branches on the way are copied, never changed in place. */
function setAt(raw: Raw, path: string, value: unknown): Raw {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return raw;
  if (rest.length === 0) return { ...raw, [head]: value };
  const inner = asRecord(raw[head]);
  if (inner === undefined) return raw;
  return { ...raw, [head]: setAt(inner, rest.join('.'), value) };
}

/** Whether an id names only the pack `pack` (at least once): what a returning pack may restore. */
const ownId = (pack: string, id: unknown): boolean => {
  if (typeof id !== 'string') return false;
  const packs = packsInKey(id);
  return packs.length > 0 && packs.every((p) => p === pack);
};

/** The pack of an id when it is not loaded, else undefined. */
const awayPack = (loaded: ReadonlySet<string>, id: unknown): string | undefined =>
  typeof id === 'string' ? packsInKey(id).find((p) => !loaded.has(p)) : undefined;

type Stash = (pack: string, path: string, key: string, value: unknown) => void;

/** The ids of missing packs that the keys inside a value name (a few levels deep). */
function awayPacksIn(loaded: ReadonlySet<string>, value: unknown, depth = 0): Set<string> {
  const out = new Set<string>();
  if (depth > 6 || !isRecord(value)) return out;
  for (const [key, inner] of Object.entries(value)) {
    for (const p of packsInKey(key)) if (!loaded.has(p)) out.add(p);
    for (const p of awayPacksIn(loaded, inner, depth + 1)) out.add(p);
  }
  return out;
}

/** Adds to `live` the entries of `copy` that are the pack's own and that `live` lacks, at any depth; live entries win. */
function mergeOwn(live: Raw, copy: Raw, pack: string, depth = 0): Raw {
  const out: Raw = { ...live };
  for (const [key, value] of Object.entries(copy)) {
    if (!safeKey(key)) continue;
    if (packsInKey(key).length > 0) {
      if (ownId(pack, key) && !Object.hasOwn(out, key)) out[key] = value;
    } else if (depth < 6 && isRecord(value) && isRecord(out[key])) {
      out[key] = mergeOwn(out[key] as Raw, value, pack, depth + 1);
    }
  }
  return out;
}

/** Moves the entries of one place that belong to a missing pack to the dormant bucket; returns the cleaned state. */
function stashPlace(raw: Raw, place: Place, loaded: ReadonlySet<string>, stash: Stash): Raw {
  const at = getAt(raw, place.path);
  const { path } = place;
  switch (place.rule) {
    case 'keys': {
      if (!isRecord(at)) return raw;
      const kept: Raw = {};
      for (const [key, value] of Object.entries(at)) {
        if (!safeKey(key)) continue;
        const away = awayPack(loaded, key);
        if (away === undefined) {
          kept[key] = value;
          // An entry that stays may still count ids of a pack that is away (a technique in a report).
          for (const inside of awayPacksIn(loaded, value)) {
            stash(inside, `${path}${NESTED}`, key, value);
          }
        } else stash(away, path, key, value);
      }
      return setAt(raw, path, kept);
    }
    case 'values': {
      if (!isRecord(at)) return raw;
      const kept: Raw = {};
      for (const [key, value] of Object.entries(at)) {
        if (!safeKey(key)) continue;
        const away = awayPack(loaded, value);
        if (away === undefined) kept[key] = value;
        else stash(away, path, key, value);
      }
      return setAt(raw, path, kept);
    }
    case 'list': {
      if (!Array.isArray(at)) return raw;
      const kept: unknown[] = [];
      at.forEach((id: unknown, index) => {
        const away = awayPack(loaded, id);
        if (away === undefined) kept.push(id);
        else stash(away, path, String(index), id);
      });
      return setAt(raw, path, kept);
    }
    case 'single': {
      const away = awayPack(loaded, at);
      if (away === undefined) return raw;
      stash(away, path, '0', at);
      return setAt(raw, path, null);
    }
    case 'saved': {
      if (!isRecord(at)) return raw;
      const kept: Raw = {};
      for (const [name, entry] of Object.entries(at)) {
        if (!safeKey(name)) continue;
        if (!isRecord(entry) || !Array.isArray(entry.techniques)) {
          kept[name] = entry;
          continue;
        }
        // Each missing pack keeps its own techniques of the loadout (with their positions) and the signature if it is its.
        const cuts = new Map<string, Raw>();
        const cutOf = (pack: string): Raw => {
          let cut = cuts.get(pack);
          if (!cut) cuts.set(pack, (cut = {}));
          return cut;
        };
        const techniques: unknown[] = [];
        entry.techniques.forEach((id: unknown, index) => {
          const away = awayPack(loaded, id);
          if (away === undefined) techniques.push(id);
          else cutOf(away)[String(index)] = id;
        });
        const sigAway = awayPack(loaded, entry.signature);
        if (sigAway !== undefined) cutOf(sigAway)['#sig'] = entry.signature;
        for (const [pack, cut] of cuts) stash(pack, path, name, cut);
        kept[name] = {
          ...entry,
          techniques,
          ...(sigAway === undefined ? {} : { signature: null }),
        };
      }
      return setAt(raw, path, kept);
    }
    case 'pouch': {
      if (!isRecord(at) || !Array.isArray(at.slots)) return raw;
      const slots = at.slots.map((slot: unknown, index: number) => {
        const id = isRecord(slot) ? slot.id : undefined;
        const away = awayPack(loaded, id);
        if (away === undefined) return slot;
        stash(away, path, String(index), slot);
        return { ...(isRecord(slot) ? slot : {}), id: '', n: 0 };
      });
      return setAt(raw, path, { ...at, slots });
    }
    case 'goals': {
      if (!Array.isArray(at)) return raw;
      const kept: unknown[] = [];
      at.forEach((goal: unknown, index) => {
        const away = awayPack(loaded, isRecord(goal) ? goal.id : undefined);
        if (away === undefined) kept.push(goal);
        else stash(away, path, String(index), goal);
      });
      return setAt(raw, path, kept);
    }
  }
}

/**
 * Moves every entry of `raw` that belongs to a pack the content does not have into `dormant`, and
 * returns a copy of `raw` without them. The places and how each is read are the table `PLACES`.
 * The rank and the natures of such a pack are settled separately (`settlePlayer`).
 */
export function stashMissing(
  raw: Raw,
  content: ContentDb,
  dormant: Record<string, DormantPack>,
  saved: ReadonlyMap<string, string>,
): Raw {
  const loaded = new Set(content.packs.map((p) => p.id));
  const stash: Stash = (pack, path, key, value) => {
    const target = bucket(dormant, pack, saved);
    const clean = cleanJson(value);
    if (!target || clean === undefined || key.length > MAX_TEXT) return;
    const branch = (target.data[path] ??= {});
    if (Object.keys(branch).length < MAX_ENTRIES) branch[key] = clean;
  };
  let out: Raw = { ...raw };
  for (const place of PLACES) out = stashPlace(out, place, loaded, stash);
  return out;
}

/** Puts the entries of a bucket that are the pack's own back into one place; returns the new state. */
function restorePlace(
  raw: Raw,
  place: Place,
  pack: string,
  entries: Record<string, JsonValue>,
  leftover?: Record<string, JsonValue>,
): Raw {
  const at = getAt(raw, place.path);
  const { path } = place;
  const mine = (id: unknown): boolean => ownId(pack, id);
  switch (place.rule) {
    case 'keys': {
      const now = isRecord(at) ? at : undefined;
      if (
        now === undefined &&
        path.includes('.') &&
        getAt(raw, path.slice(0, path.lastIndexOf('.'))) === undefined
      ) {
        return raw;
      }
      const merged: Raw = { ...(now ?? {}) };
      for (const [key, value] of Object.entries(entries)) {
        if (mine(key) && !Object.hasOwn(merged, key)) merged[key] = value;
      }
      return setAt(raw, path, merged);
    }
    case 'values': {
      const merged: Raw = { ...(isRecord(at) ? at : {}) };
      for (const [slot, id] of Object.entries(entries)) {
        if (mine(id) && !Object.hasOwn(merged, slot)) merged[slot] = id;
      }
      return setAt(raw, path, merged);
    }
    case 'list': {
      if (!Array.isArray(at)) return raw;
      const list = [...at];
      const back = Object.entries(entries)
        .map(([index, id]) => [Number(index), id] as const)
        .filter(([index, id]) => Number.isInteger(index) && index >= 0 && mine(id))
        .sort((x, y) => x[0] - y[0]);
      for (const [index, id] of back) {
        if (!list.includes(id)) list.splice(Math.min(index, list.length), 0, id);
      }
      return setAt(raw, path, list);
    }
    case 'single': {
      const id = entries['0'];
      return (at === null || at === undefined) && mine(id) ? setAt(raw, path, id) : raw;
    }
    case 'saved': {
      const saved = asRecord(at);
      if (!saved) return raw;
      const out: Raw = { ...saved };
      for (const [name, cut] of Object.entries(entries)) {
        const entry = asRecord(out[name]);
        if (!entry || !Array.isArray(entry.techniques) || !isRecord(cut)) continue;
        const techniques = [...entry.techniques];
        const sig = cut['#sig'];
        const back = Object.entries(cut)
          .filter(([index]) => index !== '#sig')
          .map(([index, id]) => [Number(index), id] as const)
          .filter(([index, id]) => Number.isInteger(index) && index >= 0 && mine(id))
          .sort((x, y) => x[0] - y[0]);
        for (const [index, id] of back) {
          if (!techniques.includes(id))
            techniques.splice(Math.min(index, techniques.length), 0, id);
        }
        out[name] = {
          ...entry,
          techniques,
          ...((entry.signature ?? null) === null && mine(sig) ? { signature: sig } : {}),
        };
      }
      return setAt(raw, path, out);
    }
    case 'pouch': {
      const pouch = asRecord(at);
      if (!pouch || !Array.isArray(pouch.slots)) return raw;
      const slots = [...pouch.slots];
      let next = raw;
      for (const [index, slot] of Object.entries(entries)) {
        if (!isRecord(slot) || !mine(slot.id)) continue;
        const at2 = Number(index);
        const have = slots[at2];
        const free =
          at2 < slots.length && isRecord(have) && (have.id === '' || have.id === undefined);
        if (free) {
          slots[at2] = { ...(isRecord(have) ? have : {}), id: slot.id, n: slot.n };
        } else {
          // The slot is taken or gone: the units go back to the bank.
          const bank = asRecord(getAt(next, 'bank')) ?? {};
          const id = slot.id as string;
          const had = typeof bank[id] === 'number' ? (bank[id] as number) : 0;
          next = setAt(next, 'bank', {
            ...bank,
            [id]: had + (typeof slot.n === 'number' ? slot.n : 0),
          });
        }
      }
      return setAt(next, path, { ...(asRecord(getAt(next, path)) ?? pouch), slots });
    }
    case 'goals': {
      if (!Array.isArray(at)) return raw;
      const list = [...at];
      const back = Object.entries(entries)
        .map(([index, goal]) => [Number(index), goal] as const)
        .filter(
          ([index, goal]) =>
            Number.isInteger(index) && index >= 0 && isRecord(goal) && mine(goal.id),
        )
        .sort((x, y) => x[0] - y[0]);
      for (const [index, goal] of back) {
        const g = goal as Raw;
        if (list.some((x) => isRecord(x) && x.kind === g.kind && x.id === g.id)) continue;
        // The goals the player pinned meanwhile win: a returning one goes back only where there is room.
        if (list.length < GOAL_CAP) list.splice(Math.min(index, list.length), 0, g);
        else if (leftover) leftover[String(index)] = goal as JsonValue;
      }
      return setAt(raw, path, list);
    }
  }
}

/**
 * Returns the dormant entries of packs that are present now to the places they came from and drops
 * their buckets. A pack gets back only ids of its own namespace, and an entry that the state already
 * has wins, so a tampered bucket cannot overwrite progress of the game or of another pack.
 */
/** A bucket that came back, with the id of its pack. */
export type RestoredPack = DormantPack & { packId: string };

export function restoreDormant(
  raw: Raw,
  content: ContentDb,
  dormant: Record<string, DormantPack>,
): { raw: Raw; restored: RestoredPack[] } {
  let out: Raw = { ...raw };
  const restored: RestoredPack[] = [];
  for (const pack of content.packs) {
    const held = dormant[pack.id];
    if (!held) continue;
    restored.push({ ...held, packId: pack.id });
    delete dormant[pack.id];
    const left: Record<string, JsonValue> = {};
    for (const place of PLACES) {
      const entries = held.data[place.path];
      if (entries) out = restorePlace(out, place, pack.id, entries, left);
      const nested = held.data[`${place.path}${NESTED}`];
      const live = asRecord(getAt(out, place.path));
      if (nested && live) {
        const merged: Raw = { ...live };
        for (const [key, copy] of Object.entries(nested)) {
          const at = merged[key];
          if (isRecord(at) && isRecord(copy)) merged[key] = mergeOwn(at, copy, pack.id);
        }
        out = setAt(out, place.path, merged);
      }
    }
    // Goals that found no room stay dormant and come back when the list has room again.
    if (Object.keys(left).length > 0) {
      dormant[pack.id] = { version: held.version, rank: null, natures: [], data: { goals: left } };
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
  restored: readonly RestoredPack[],
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
    if (
      held.rank !== null &&
      packOfId(held.rank) === held.packId &&
      rankIndex(content, held.rank) > rankIndex(content, rank)
    ) {
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
    // The saved order is kept: the natures the player still has and the pack's own come back in it.
    const now = natures;
    const kept = held.natures.filter(
      (n) => now.includes(n) || (isNature(content, n) && packOfId(n) === held.packId),
    );
    natures = [...kept, ...now.filter((n) => !kept.includes(n))];
  }
  return { rank: rank === '' ? null : rank, natures: [...new Set(natures)] };
}

/** The ids of the packs of a save that the content does not have and of the content's that the save lacks. */
export function packDiff(
  saved: readonly { id: string; version: string }[],
  content: ContentDb,
): { added: string[]; removed: string[]; updated: { id: string; from: string; to: string }[] } {
  const before = new Set(saved.map((p) => p.id));
  const after = new Set(content.packs.map((p) => p.id));
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    updated: content.packs.flatMap((p) => {
      const was = saved.find((s) => s.id === p.id);
      return was && was.version !== p.version
        ? [{ id: p.id, from: was.version, to: p.version }]
        : [];
    }),
  };
}

/** Whether a number is a usable balance: finite and not negative, cut at the biggest number a save keeps. */
export const balanceOf = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(x, MAX_NUMBER) : 0;
