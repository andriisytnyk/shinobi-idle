import type { ContentDb } from '@shinobi/content';
import {
  actionInfo,
  chakraDivisor,
  cloneSlots,
  hexKey,
  positionHex,
  type Command,
  type GameState,
  type Rules,
} from '@shinobi/core';
import type { EntityRef } from './route.ts';
import { actionRef } from './entities.ts';
import { IDLE_TIMING, slotTiming } from './timing.ts';
import type { ProgressTiming } from './time-progress.ts';

/**
 * The squad: the character and the clones as one list of performers. This module is the only place
 * that knows how a performer is read from the game state and what commands act on one. The clone
 * redesign (C3) changes the shape of a clone (a life by chakra, knowledge and a bag held until the
 * dispel, mind fatigue, a pouch at creation, one fight per performer); every bit that depends on it
 * sits in the `C3` section below as an optional value with a fallback, so wiring the real state
 * means editing that section alone.
 */

/** What a performer is doing: nothing, a plain action, a fight, or standing on a point. */
export type PerformerState = 'idle' | 'working' | 'fighting' | 'standing';

/** What a clone holds until it is dispelled. Every part is optional: it is the C3 model. */
export interface Held {
  /** Skill XP the clone has gathered and gives to the character on the dispel. */
  xp?: number | undefined;
  /** Mastery XP, likewise. */
  mastery?: number | undefined;
  /** The bag: items that go to the Bank on the dispel, by id. */
  bag?: Record<string, number> | undefined;
}

/** The mind fatigue a dispel causes (C3). */
export interface FatigueHit {
  durationMs: number;
  /** The slowdown it brings, as a fraction (0.1 = 10%). */
  slowdown: number;
}

export interface Performer {
  /** 0 is the character, 1 and up are the clones, by their number. */
  id: number;
  /** The action slot that carries the performer. */
  slot: number;
  clone: boolean;
  /** The number of the clone; 0 for the character. */
  n: number;
  state: PerformerState;
  action: { kind: string; id: string } | null;
  ref: EntityRef | null;
  /** The share of the chakra pool the performer has, as a fraction (1 = all of it). */
  chakraShare: number;
  /** The time the clone still lives by its chakra, ms (C3). */
  lifeMs?: number | undefined;
  /** The life the clone started with, ms (C3); with `lifeMs` it makes the life bar. */
  lifeMaxMs?: number | undefined;
  /** What the clone holds (C3). */
  held?: Held | undefined;
  /** The mind fatigue of the character, ms left (C3). */
  fatigueMs?: number | undefined;
}

/** The i18n key of the phrase that says what each kind of action is doing. */
export const ACTION_VERB: Readonly<Record<string, string>> = {
  gather: 'now.doing.gather',
  craft: 'now.doing.craft',
  drill: 'now.doing.drill',
  meditate: 'now.doing.meditate',
  course: 'now.doing.course',
  explore: 'now.doing.explore',
  walk: 'now.doing.walk',
  autosurvey: 'now.doing.autosurvey',
  stand: 'now.doing.stand',
  fight: 'now.doing.fight',
  mission: 'now.doing.mission',
  senseiTest: 'now.doing.exam',
};

// ---------- C3: the fields the clone redesign adds ----------

/** The fields of a clone that only the redesigned model has. Today none of them exists. */
interface C3Fields {
  lifeMs?: number | undefined;
  lifeMaxMs?: number | undefined;
  held?: Held | undefined;
  fatigueMs?: number | undefined;
  /** A clone that exists and does nothing: today a clone with no action does not exist. */
  idle?: boolean | undefined;
}

/** The C3 fields of the performer in `slot`. The wiring point for the real selectors. */
function c3Fields(_state: GameState, _content: ContentDb, _slot: number): C3Fields {
  return {};
}

/** The mind fatigue of the character, ms left. The wiring point for the real selector. */
function c3Fatigue(_state: GameState, _content: ContentDb): number | undefined {
  return undefined;
}

/** What the dispel of the clone in `slot` would bring to the character. The wiring point for the real selector. */
function c3DispelPreview(
  _state: GameState,
  _content: ContentDb,
  _slot: number,
): { held: Held | undefined; fatigue: FatigueHit | undefined } {
  return { held: undefined, fatigue: undefined };
}

/** The commands for a clone's life: today a clone is an action slot that a known technique opens. */
const c3 = {
  /** The slot a new clone would take, or -1 when no clone can be made now. */
  freeCloneSlot(state: GameState, content: ContentDb): number {
    return cloneSlots(state, content).find((c) => state.slots[c.slot]?.action == null)?.slot ?? -1;
  },
  /** Starts `action` in a new clone; the default pouch is C3's. */
  createWith(slot: number, kind: string, id: string): Command {
    return { type: 'action.start', slot, kind, id };
  },
};

// ---------- reading the squad ----------

function stateOf(action: { kind: string } | null): PerformerState {
  if (!action) return 'idle';
  if (action.kind === 'fight' || action.kind === 'operation') return 'fighting';
  if (action.kind === 'stand') return 'standing';
  return 'working';
}

/** The performers: the character, then every clone that exists (and, in C3, every idle clone). */
export function performersOf(state: GameState, content: ContentDb): Performer[] {
  const out: Performer[] = [];
  const share = 1 / chakraDivisor(state, content);
  const make = (slot: number, n: number, extra: C3Fields): Performer => {
    const action = state.slots[slot]?.action ?? null;
    return {
      id: n,
      slot,
      clone: n > 0,
      n,
      state: stateOf(action),
      action: action ? { kind: action.kind, id: action.id } : null,
      ref: action ? actionRef(action, state, slot) : null,
      chakraShare: share,
      lifeMs: extra.lifeMs,
      lifeMaxMs: extra.lifeMaxMs,
      held: extra.held,
      fatigueMs: n === 0 ? c3Fatigue(state, content) : undefined,
    };
  };
  out.push(make(0, 0, {}));
  let n = 0;
  for (const c of cloneSlots(state, content)) {
    const extra = c3Fields(state, content, c.slot);
    // A clone that does nothing is no clone in today's model; C3 may have one that waits.
    if (state.slots[c.slot]?.action == null && extra.idle !== true) continue;
    n += 1;
    out.push(make(c.slot, n, extra));
  }
  return out;
}

/** A clone on the map: its number, state and the hex it stands on (`"q,r"`). */
export interface SquadFigure {
  id: number;
  n: number;
  slot: number;
  state: PerformerState;
  coord: string;
}

/** The figures of the clones for the map; a clone with no place of its own stands with the character. */
export function squadFigures(state: GameState, content: ContentDb): SquadFigure[] {
  return performersOf(state, content).flatMap((p) => {
    if (!p.clone) return [];
    const at = positionHex(state, content, p.slot);
    return at
      ? [{ id: p.id, n: p.n, slot: p.slot, state: p.state, coord: hexKey(at.q, at.r) }]
      : [];
  });
}

/** The counts of the panel's header: clones that exist, clones that can exist, clones that wait. */
export function squadCounts(
  list: readonly Performer[],
  state: GameState,
  content: ContentDb,
): { clones: number; max: number; free: number } {
  const clones = list.filter((p) => p.clone);
  return {
    clones: clones.length,
    max: Math.max(clones.length, cloneSlots(state, content).length),
    free: clones.filter((p) => p.state === 'idle').length,
  };
}

/** Whether another clone can be made now. */
export const canCreateClone = (state: GameState, content: ContentDb): boolean =>
  c3.freeCloneSlot(state, content) >= 0;

/** The share of the chakra a new clone takes, as the text of a fraction: ½, 1/3 ... */
export function newCloneShare(list: readonly Performer[]): string {
  const d = list.length + 1;
  return d === 2 ? '½' : `1/${d}`;
}

/** The performers that are in a fight, for the fight screen's switcher. */
export const fightersOf = (list: readonly Performer[]): Performer[] =>
  list.filter((p) => p.state === 'fighting');

/** Whether the squad shows at all: the player knows the clone technique. */
export const hasSquad = (state: GameState, content: ContentDb): boolean =>
  cloneSlots(state, content).length > 0;

const NOBODY: Performer = {
  id: 0,
  slot: 0,
  clone: false,
  n: 0,
  state: 'idle',
  action: null,
  ref: null,
  chakraShare: 1,
};

/** The performer the start buttons name: the picked one while it is there, else the first idle clone, else the character. */
export function defaultPerformer(list: readonly Performer[], picked: number | null): Performer {
  const chosen = picked === null ? undefined : list.find((p) => p.id === picked);
  return chosen ?? list.find((p) => p.clone && p.state === 'idle') ?? list[0] ?? NOBODY;
}

/** The performers that run `kind:id`, for the marks of a tile. */
export const runningBy = (list: readonly Performer[], kind: string, id: string): Performer[] =>
  list.filter((p) => p.action?.kind === kind && p.action.id === id);

/** What a choice in the performer menu would do. */
export type MenuNote = 'same' | 'replaces' | 'free';

export function noteFor(p: Performer, kind: string, id: string): MenuNote {
  if (p.action?.kind === kind && p.action.id === id) return 'same';
  return p.action ? 'replaces' : 'free';
}

// ---------- the progress of a performer's action ----------

/** The cycle of the action in `slot`, ms at full speed; null when it has no cycle to show. */
export function cycleOf(
  state: GameState,
  slot: number,
  content: ContentDb,
  rules: Rules,
): number | null {
  const action = state.slots[slot]?.action;
  if (!action) return null;
  const info = actionInfo(state, action, content, rules);
  const kind = rules.actionKinds[action.kind];
  return info?.intervalMs ?? kind?.intervalMs(state, action.id, content, rules, slot) ?? null;
}

export function timingOf(
  state: GameState,
  slot: number,
  content: ContentDb,
  rules: Rules,
): ProgressTiming {
  const ms = cycleOf(state, slot, content, rules);
  return ms === null ? IDLE_TIMING : slotTiming(state, slot, ms);
}

// ---------- commands ----------

export const startCommand = (p: Pick<Performer, 'slot'>, kind: string, id: string): Command => ({
  type: 'action.start',
  slot: p.slot,
  kind,
  id,
});

export const stopCommand = (p: Pick<Performer, 'slot' | 'clone'>): Command =>
  p.clone ? { type: 'clone.dispel', slot: p.slot } : { type: 'action.stop', slot: p.slot };

/** The command that makes a new clone work at `kind:id`, or null when no clone can be made now. */
export function newCloneCommand(
  state: GameState,
  content: ContentDb,
  kind: string,
  id: string,
): Command | null {
  const slot = c3.freeCloneSlot(state, content);
  return slot < 0 ? null : c3.createWith(slot, kind, id);
}

// ---------- the dispel ----------

export interface DispelPreview {
  performer: Performer;
  held: Held | undefined;
  /** The items of the bag, by id, that go to the Bank. */
  bag: { id: string; n: number }[];
  fatigue: FatigueHit | undefined;
  /** Whether the clone holds nothing to give (today it never does: its work is already the character's). */
  empty: boolean;
}

export function dispelPreview(
  state: GameState,
  content: ContentDb,
  performer: Performer,
): DispelPreview {
  const { held, fatigue } = c3DispelPreview(state, content, performer.slot);
  const bag = Object.entries(held?.bag ?? {}).map(([id, n]) => ({ id, n }));
  const empty = !held?.xp && !held?.mastery && bag.length === 0 && !fatigue;
  return { performer, held, bag, fatigue, empty };
}

// ---------- the offline report ----------

/** The part of the report one performer gets. */
export interface ReportSection {
  /** 0 for the character, else the clone's number. */
  n: number;
  clone: boolean;
  stopped: { kind: string; id: string; reason: string }[];
}

/**
 * The sections of the report by performer, the character first. The engine's summary groups the
 * XP by skill only; the stops carry their slot, so the sections list what each performer stopped
 * doing. When C3's summary names the gains of each performer they join here.
 */
export function reportSections(
  stopped: readonly { slot: number; kind: string; id: string; reason: string }[],
  state: GameState,
  content: ContentDb,
): ReportSection[] {
  const slots = cloneSlots(state, content).map((c) => c.slot);
  const sections = new Map<number, ReportSection>();
  for (const stop of stopped) {
    const n = slots.indexOf(stop.slot) + 1;
    const section = sections.get(n) ?? { n, clone: n > 0, stopped: [] };
    section.stopped.push({ kind: stop.kind, id: stop.id, reason: stop.reason });
    sections.set(n, section);
  }
  return [...sections.values()].sort((a, b) => a.n - b.n);
}

// ---------- the notices ----------

/** What the squad says between two looks at it. */
export interface SquadNotice {
  key: 'squad.notice.free' | 'squad.notice.left';
  n: number;
  /** Minutes left, for `squad.notice.left`. */
  min?: number;
}

/** The warning is given once the clone has this long to live. */
export const LIFE_WARNING_MS = 5 * 60_000;

/**
 * The notices of a change in the squad. `before` and `after` are the performers at two moments;
 * `warned` holds the clones already warned (it is updated). A clone that was busy and is now idle
 * is «вільний»; a clone whose life fell under five minutes is warned once.
 */
export function squadNotices(
  before: readonly Performer[],
  after: readonly Performer[],
  warned: Set<number>,
): SquadNotice[] {
  const out: SquadNotice[] = [];
  for (const p of after) {
    if (!p.clone) continue;
    const was = before.find((b) => b.id === p.id);
    if (was && was.state !== 'idle' && p.state === 'idle') {
      out.push({ key: 'squad.notice.free', n: p.n });
    }
    if (p.lifeMs === undefined) continue;
    if (p.lifeMs > LIFE_WARNING_MS) warned.delete(p.id);
    else if (!warned.has(p.id)) {
      warned.add(p.id);
      out.push({
        key: 'squad.notice.left',
        n: p.n,
        min: Math.max(1, Math.ceil(p.lifeMs / 60_000)),
      });
    }
  }
  for (const id of [...warned]) if (!after.some((p) => p.id === id)) warned.delete(id);
  return out;
}
