import type { ContentDb } from '@shinobi/content';
import { counterValue } from './counters.ts';
import type { ActionSlot, GameState } from './state.ts';

/**
 * Action slots opened by techniques (the clone). A technique with `opensSlot: n` gives the player
 * slot `n` once it is known; slot 0 is always there. A clone is made into a slot (`clone-life.ts`) and
 * works there at full speed; the character and every clone each have their own speed.
 */

/** A slot that a known technique opened. */
export interface CloneSlot {
  slot: number;
  technique: string;
}

const openers = new WeakMap<ContentDb, { slot: number; technique: string }[]>();

/** The techniques of the content that open a slot, by slot. */
function openersOf(content: ContentDb): { slot: number; technique: string }[] {
  let list = openers.get(content);
  if (!list) {
    list = content.techniques
      .filter((t) => t.opensSlot !== undefined)
      .map((t) => ({ slot: t.opensSlot as number, technique: t.id }))
      .sort((a, b) => a.slot - b.slot);
    openers.set(content, list);
  }
  return list;
}

/** The slots the player's known techniques open, in slot order. */
export function cloneSlots(state: GameState, content: ContentDb): CloneSlot[] {
  return openersOf(content).filter((o) => state.known[o.technique] === true);
}

/** How many action slots the player has: one, and one more for the highest slot a known technique opens. */
export function slotCount(state: GameState, content: ContentDb): number {
  return Math.max(1, ...cloneSlots(state, content).map((o) => o.slot + 1));
}

/** The technique whose clone works in slot `slot`, or null for a slot of the player. */
export function cloneTechniqueOf(
  state: GameState,
  content: ContentDb,
  slot: number,
): string | null {
  return cloneSlots(state, content).find((o) => o.slot === slot)?.technique ?? null;
}

/** Whether slot `slot` is a clone's. */
export const isCloneSlot = (state: GameState, content: ContentDb, slot: number): boolean =>
  cloneTechniqueOf(state, content, slot) !== null;

const emptySlot = (): ActionSlot => ({ action: null, progress: 0, share: 0, data: null });

/**
 * Opens the slots the known techniques give. A slot is only added, never taken away, so it is safe
 * wherever a technique may just have been learned. Returns whether a slot was added.
 */
export function growSlots(state: GameState, content: ContentDb): boolean {
  const want = slotCount(state, content);
  let grown = false;
  while (state.slots.length < want) {
    state.slots.push(emptySlot());
    grown = true;
  }
  return grown;
}

// ---------- the clones that exist ----------

/**
 * How many clones exist now: the bodies the character has made and not yet dispelled. This is the
 * `n` the chakra pool is divided by (`chakraDivisor`).
 */
export const cloneCount = (state: GameState, _content?: ContentDb): number =>
  Object.keys(state.clones).length;

/**
 * What the chakra pool is divided by: `n + 1` for `n` clones that exist. Every performer's pool, the
 * clone's and the character's, is the character's pool divided by it; 1 with no clone.
 */
export const chakraDivisor = (state: GameState, content?: ContentDb): number =>
  cloneCount(state, content) + 1;

// ---------- telemetry ----------

/** Counter keys the clone telemetry keeps (whole ms of game time). */
export const CLONE_OPEN_MS = 'clone.openMs';
export const CLONE_RUN_MS = 'clone.runMs';
export const CLONE_PAIR_PREFIX = 'clone.pair.';

const part = (a: { kind: string; id: string }): string => `${a.kind}=${a.id}`;

/** The counter key of a pair of actions run together, the two in a fixed order. */
export function pairKey(a: { kind: string; id: string }, b: { kind: string; id: string }): string {
  // The same pair is asked for at every step of a long fight: the last answer is kept.
  const last = lastPair;
  if (last && last.ak === a.kind && last.ai === a.id && last.bk === b.kind && last.bi === b.id)
    return last.key;
  const [x, y] = [part(a), part(b)].sort();
  const key = `${CLONE_PAIR_PREFIX}${x}|${y}`;
  lastPair = { ak: a.kind, ai: a.id, bk: b.kind, bi: b.id, key };
  return key;
}

let lastPair: { ak: string; ai: string; bk: string; bi: string; key: string } | null = null;

/** Adds `dt` ms of game time to the clone telemetry: how long the clone technique was known with a slot open, how long a clone existed, and which pairs ran together. */
export function trackClone(state: GameState, dt: number, content: ContentDb): void {
  if (state.slots.length < 2 || cloneSlots(state, content).length === 0) return;
  const c = state.counters;
  c[CLONE_OPEN_MS] = (c[CLONE_OPEN_MS] ?? 0) + dt;
  const running: { kind: string; id: string }[] = [];
  for (const slot of state.slots) {
    if (!slot.action || slot.share <= 0) continue;
    running.push(slot.action);
  }
  if (Object.keys(state.clones).length > 0) c[CLONE_RUN_MS] = (c[CLONE_RUN_MS] ?? 0) + dt;
  const [first, second] = running;
  if (running.length === 2 && first && second) {
    const key = pairKey(first, second);
    c[key] = (c[key] ?? 0) + dt;
  }
}

/** A pair of actions that ran in two slots at once, and for how long. */
export interface ClonePair {
  a: { kind: string; id: string };
  b: { kind: string; id: string };
  ms: number;
}

/** What the balance stage reads: how long a clone existed, and the pairs run together. */
export interface CloneTelemetry {
  /** Game time since the first slot opened, ms. */
  openMs: number;
  /** Game time a clone existed, ms. */
  runMs: number;
  /** `runMs / openMs`; 0 when no slot was open. */
  share: number;
  /** Pairs by time, longest first. */
  pairs: ClonePair[];
}

const splitPart = (text: string): { kind: string; id: string } | null => {
  const at = text.indexOf('=');
  return at < 1 ? null : { kind: text.slice(0, at), id: text.slice(at + 1) };
};

/** The clone telemetry of a state (a selector; the counters carry the data and are saved with it). */
export function cloneTelemetry(state: GameState): CloneTelemetry {
  const openMs = counterValue(state, CLONE_OPEN_MS);
  const runMs = counterValue(state, CLONE_RUN_MS);
  const pairs: ClonePair[] = [];
  for (const [key, ms] of Object.entries(state.counters)) {
    if (!key.startsWith(CLONE_PAIR_PREFIX)) continue;
    const [x, y] = key.slice(CLONE_PAIR_PREFIX.length).split('|');
    const a = splitPart(x ?? '');
    const b = splitPart(y ?? '');
    if (a && b) pairs.push({ a, b, ms });
  }
  pairs.sort((p, q) => q.ms - p.ms || (pairKey(p.a, p.b) < pairKey(q.a, q.b) ? -1 : 1));
  return { openMs, runMs, share: openMs > 0 ? runMs / openMs : 0, pairs };
}
