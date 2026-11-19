import type { ContentDb } from '@shinobi/content';
import {
  actionInfo,
  chakraDivisor,
  cloneRefusal,
  cloneSlots,
  dispelPreview as corePreview,
  fatigueLeftMs,
  freeCloneSlot,
  hexKey,
  lifeLeftMs,
  LIFE_FULL,
  positionHex,
  STAND_ID,
  STAND_KIND,
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
 * that knows how a performer is read from the game state and what commands act on one. A clone is a
 * body with a life by chakra, the knowledge and the bag it holds until it is dispelled, and it stands
 * (idle) when its action stops; the selectors are the core's (`clone-life.ts`, `performer.ts`).
 */

/** What a performer is doing: nothing, a plain action, a fight, or standing on a point. */
export type PerformerState = 'idle' | 'working' | 'fighting' | 'standing';

/** What a clone holds until it is dispelled. */
export interface Held {
  /** Skill XP the clone has gathered and gives to the character on the dispel. */
  xp?: number | undefined;
  /** Mastery XP, likewise. */
  mastery?: number | undefined;
  /** The bag: items that go to the Bank on the dispel, by id. */
  bag?: Record<string, number> | undefined;
}

/** The mind fatigue a dispel causes. */
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
  /** The number of the clone, which is its slot; 0 for the character. */
  n: number;
  state: PerformerState;
  /** What it does; null for the character with nothing to do and for a clone that stands (idle). */
  action: { kind: string; id: string } | null;
  ref: EntityRef | null;
  /** The share of the chakra pool the performer has, as a fraction (1 = all of it). */
  chakraShare: number;
  /** The time the clone still lives by its chakra, ms. */
  lifeMs?: number | undefined;
  /** The share of its chakra the clone has left, 0 to 1: the life bar. */
  lifeFraction?: number | undefined;
  /** What the clone holds. */
  held?: Held | undefined;
  /** The mind fatigue of the character, ms left. */
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

// ---------- reading the squad ----------

/** Whether the action is what a clone does when it has nothing to do: it stands where it is. */
const isStanding = (action: { kind: string; id: string } | null): boolean =>
  action?.kind === STAND_KIND && action.id === STAND_ID;

function stateOf(action: { kind: string } | null): PerformerState {
  if (!action) return 'idle';
  if (action.kind === 'fight' || action.kind === 'operation') return 'fighting';
  if (action.kind === 'stand') return 'standing';
  return 'working';
}

/** What the clone in `slot` holds, summed for the panel: skill XP, Mastery and the bag. */
function heldOf(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  slot: number,
): Held | undefined {
  const held = corePreview(state, slot, content, rules);
  if (!held) return undefined;
  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
  return {
    xp: sum(Object.values(held.xp)),
    mastery: sum(Object.values(held.mastery).map((m) => m.amount)),
    bag: held.bag,
  };
}

/** The mind fatigue and slowdown a dispel would leave, when it leaves any. */
const fatigueHit = (ms: number, content: ContentDb): FatigueHit | undefined =>
  ms > 0 ? { durationMs: ms, slowdown: content.balance.K.clone.fatigue.slow } : undefined;

/**
 * The performers: the character, then every clone that exists, in slot order. A clone with nothing
 * to do (it stands where it was made, or where its action ended) is idle; a number is its slot.
 */
export function performersOf(state: GameState, content: ContentDb, rules: Rules): Performer[] {
  const out: Performer[] = [];
  const share = 1 / chakraDivisor(state, content);
  out.push({
    id: 0,
    slot: 0,
    clone: false,
    n: 0,
    ...described(state, 0),
    chakraShare: share,
    fatigueMs: fatigueLeftMs(state, content, rules),
  });
  const slots = Object.keys(state.clones)
    .map(Number)
    .sort((a, b) => a - b);
  for (const slot of slots) {
    const body = state.clones[slot];
    if (!body) continue;
    out.push({
      id: slot,
      slot,
      clone: true,
      n: slot,
      ...described(state, slot),
      chakraShare: share,
      lifeMs: lifeLeftMs(state, slot, content, rules),
      lifeFraction: Math.max(0, Math.min(1, body.life / LIFE_FULL)),
      held: heldOf(state, content, rules, slot),
    });
  }
  return out;
}

/** What the performer in `slot` does: its action, picture and state. A clone that stands does nothing. */
function described(state: GameState, slot: number): Pick<Performer, 'state' | 'action' | 'ref'> {
  const raw = state.slots[slot]?.action ?? null;
  const action = raw && !(slot > 0 && isStanding(raw)) ? { kind: raw.kind, id: raw.id } : null;
  return {
    state: stateOf(action),
    action,
    ref: raw && action ? actionRef(raw, state, slot) : null,
  };
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
export function squadFigures(state: GameState, content: ContentDb, rules: Rules): SquadFigure[] {
  return performersOf(state, content, rules).flatMap((p) => {
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

/** Whether another clone can be made now: the core's own answer, the one `clone.create` gives. */
export const canCreateClone = (state: GameState, content: ContentDb): boolean =>
  cloneRefusal(state, content) === null;

/** The slot a new clone would take, or null when none can be made now. */
export const newCloneSlot = (state: GameState, content: ContentDb): number | null =>
  cloneRefusal(state, content) === null ? freeCloneSlot(state, content) : null;

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

// ---------- the dispel ----------

export interface DispelPreview {
  performer: Performer;
  held: Held | undefined;
  /** The items of the bag, by id, that go to the Bank. */
  bag: { id: string; n: number }[];
  fatigue: FatigueHit | undefined;
  /** Whether the clone holds nothing to give. */
  empty: boolean;
}

/** What dispelling `performer` would hand over: the core's own preview, the figures the dispel pays. */
export function dispelPreview(
  state: GameState,
  content: ContentDb,
  rules: Rules,
  performer: Performer,
): DispelPreview {
  const held = heldOf(state, content, rules, performer.slot);
  const fatigue = fatigueHit(
    corePreview(state, performer.slot, content, rules)?.fatigueMs ?? 0,
    content,
  );
  const bag = Object.entries(held?.bag ?? {}).map(([id, n]) => ({ id, n }));
  const empty = !held?.xp && !held?.mastery && bag.length === 0 && !fatigue;
  return { performer, held, bag, fatigue, empty };
}

// ---------- the offline report ----------

/** The part of the report one performer gets. */
export interface ReportSection {
  /** 0 for the character, else the clone's number (its slot). */
  n: number;
  clone: boolean;
  stopped: { kind: string; id: string; reason: string }[];
  /** The clone was dispelled while away: why, and the skill XP it handed over (summed). */
  dispelled?: { cause: 'manual' | 'life' | 'death'; xp: number } | undefined;
}

/**
 * The sections of the report by performer, the character first: what each performer stopped doing,
 * and, for a clone dispelled while away, why and the XP it handed over. The skills list above them
 * is the character's total, the clones' XP included.
 */
export function reportSections(
  stopped: readonly { slot: number; kind: string; id: string; reason: string }[],
  dispelled: readonly {
    slot: number;
    cause: 'manual' | 'life' | 'death';
    xp: Readonly<Record<string, number>>;
  }[] = [],
): ReportSection[] {
  const sections = new Map<number, ReportSection>();
  const of = (n: number): ReportSection => {
    const section = sections.get(n) ?? { n, clone: n > 0, stopped: [] };
    sections.set(n, section);
    return section;
  };
  for (const stop of stopped)
    of(stop.slot).stopped.push({ kind: stop.kind, id: stop.id, reason: stop.reason });
  for (const d of dispelled) {
    const xp = Object.values(d.xp).reduce((sum, n) => sum + n, 0);
    const section = of(d.slot);
    section.dispelled = { cause: d.cause, xp: (section.dispelled?.xp ?? 0) + xp };
  }
  return [...sections.values()].sort((x, y) => x.n - y.n);
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
