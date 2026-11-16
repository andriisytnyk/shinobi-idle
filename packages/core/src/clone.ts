import type { ContentDb } from '@shinobi/content';
import { isCombatKind, MISSION_KIND } from './combat/system.ts';
import { counterValue } from './counters.ts';
import type { EntityRef } from './entity.ts';
import { indexOf } from './lookup.ts';
import type { ModifierProvider, Modifier } from './modifiers.ts';
import { SHARE_FULL, type ActionSlot, type GameState } from './state.ts';

/**
 * Action slots opened by techniques (the clone). A technique with `opensSlot: n` gives the player
 * slot `n` once it is known; slot 0 is always there. Two running slots share one speed pool
 * (`K.clone.pool`), and in a pair of running actions of which one makes what the other uses (the
 * kinds linked by the technique's `slotLinks`) the one that uses gets `K.clone.link` speed.
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

/** The shared speed of the running slots once two or more run, in thousandths of one action at full speed. */
export const sharePool = (content: ContentDb): number =>
  Math.round(SHARE_FULL * content.balance.K.clone.pool);

// ---------- what a clone may do ----------

/** The reason (localization key) a clone's slot refuses fights, operations and missions with a combat stage. */
export const CLONE_NO_FIGHT = 'error.cloneNoFight';

/**
 * Whether an action can hold a fight: a fight, an operation, or a mission with a combat stage.
 * A clone does not fight until the fight rules of the clone are in the fight engine.
 */
export function fightCapable(kind: string, id: string, content: ContentDb): boolean {
  if (isCombatKind(kind)) return true;
  return (
    kind === MISSION_KIND &&
    (indexOf(content)
      .missions.get(id)
      ?.stages.some((stage) => stage.t === 'combat') ??
      false)
  );
}

/** The refusal of starting `kind`/`id` in slot `slot` for the sake of the clone, or null. */
export function cloneRefusal(
  state: GameState,
  slot: number,
  kind: string,
  id: string,
  content: ContentDb,
): string | null {
  if (!isCloneSlot(state, content, slot)) return null;
  return fightCapable(kind, id, content) ? CLONE_NO_FIGHT : null;
}

// ---------- the link ----------

/** What an action makes and uses, and the speed key a link raises for the one that uses. */
interface Flow {
  makes: string[];
  uses: string[];
  speed: string;
}

/**
 * The actions of the built-in kinds that make or use items: gathering makes a herb, a craft uses
 * its ingredients and makes its product. Which pairs of kinds are linked is the data of the clone
 * technique (`slotLinks`); this flow says whether two actions of such kinds really feed each
 * other, so a new recipe or herb is linked to what it feeds without any entry of its own.
 */
const FLOWS: Readonly<Record<string, (id: string, content: ContentDb) => Flow | null>> = {
  gather(id, content) {
    const herb = indexOf(content).herbs.get(id);
    if (!herb) return null;
    const skill = herb.skill ?? content.skills.find((s) => s.activity === 'patch')?.id;
    return skill ? { makes: [id], uses: [], speed: `speed.skill.${skill}` } : null;
  },
  craft(id, content) {
    const recipe = indexOf(content).recipes.get(id);
    if (!recipe) return null;
    return {
      makes: [recipe.output.item],
      uses: recipe.ingredients.map((i) => i.item),
      speed: `speed.skill.${recipe.skill}`,
    };
  },
};

const flowOf = (action: { kind: string; id: string }, content: ContentDb): Flow | null =>
  Object.hasOwn(FLOWS, action.kind) ? (FLOWS[action.kind]?.(action.id, content) ?? null) : null;

/** A pair of action kinds a technique links: the one that feeds and the one that is fed. */
interface KindLink {
  technique: string;
  from: string;
  to: string;
}

const linkLists = new WeakMap<ContentDb, KindLink[]>();

/** The links of every technique of the content, in the order of the techniques. */
function linksOf(content: ContentDb): KindLink[] {
  let list = linkLists.get(content);
  if (!list) {
    list = content.techniques.flatMap((t) =>
      (t.slotLinks ?? []).map((l) => ({ technique: t.id, from: l.from, to: l.to })),
    );
    linkLists.set(content, list);
  }
  return list;
}

/** The link (a pair of kinds of a technique's data) by which `producer` feeds `consumer`, or null. */
function feedingLink(
  producer: { kind: string; id: string },
  consumer: { kind: string; id: string },
  content: ContentDb,
  known?: GameState,
): KindLink | null {
  const link = linksOf(content).find(
    (l) =>
      l.from === producer.kind &&
      l.to === consumer.kind &&
      (known === undefined || known.known[l.technique] === true),
  );
  if (!link) return null;
  const made = flowOf(producer, content)?.makes ?? [];
  const used = flowOf(consumer, content)?.uses ?? [];
  return made.some((item) => used.includes(item)) ? link : null;
}

/** Whether `producer` makes an item `consumer` uses, and the data of the clone links the two kinds. */
export function feeds(
  producer: { kind: string; id: string },
  consumer: { kind: string; id: string },
  content: ContentDb,
): boolean {
  return feedingLink(producer, consumer, content) !== null;
}

/** Whether one of two actions feeds the other. */
export function linked(
  a: { kind: string; id: string },
  b: { kind: string; id: string },
  content: ContentDb,
): boolean {
  return feeds(a, b, content) || feeds(b, a, content);
}

/**
 * The link bonus: while two slots run a pair in which one action feeds the other, the one that is
 * fed (the consumer) gets `K.clone.link` speed (one entry per speed key, so two recipes of one
 * skill do not add it twice). The source is the technique whose data links the pair.
 */
export const cloneLinkProvider: ModifierProvider = (state, content) => {
  if (state.slots.length < 2) return [];
  const bonus = content.balance.K.clone.link;
  if (bonus <= 0) return [];
  const running = state.slots.flatMap((slot) => (slot.action ? [slot.action] : []));
  if (running.length < 2) return [];
  const parts = new Map<string, Modifier>();
  for (const producer of running) {
    for (const consumer of running) {
      if (producer === consumer) continue;
      const link = feedingLink(producer, consumer, content, state);
      const speed = link ? flowOf(consumer, content)?.speed : undefined;
      if (!link || speed === undefined || parts.has(speed)) continue;
      const source: EntityRef = { kind: 'technique', id: link.technique };
      parts.set(speed, { key: speed, op: 'add', value: bonus, group: 'character', source });
    }
  }
  return [...parts.values()];
};

// ---------- telemetry ----------

/** Counter keys the clone telemetry keeps (whole ms of game time). */
export const CLONE_OPEN_MS = 'clone.openMs';
export const CLONE_RUN_MS = 'clone.runMs';
export const CLONE_PAIR_PREFIX = 'clone.pair.';

const part = (a: { kind: string; id: string }): string => `${a.kind}=${a.id}`;

/** The counter key of a pair of actions run together, the two in a fixed order. */
export function pairKey(a: { kind: string; id: string }, b: { kind: string; id: string }): string {
  const [x, y] = [part(a), part(b)].sort();
  return `${CLONE_PAIR_PREFIX}${x}|${y}`;
}

/** Adds `dt` ms of game time to the clone telemetry: how long a clone slot existed, ran, and which pairs ran together. */
export function trackClone(state: GameState, dt: number, content: ContentDb): void {
  if (state.slots.length < 2 || cloneSlots(state, content).length === 0) return;
  const c = state.counters;
  c[CLONE_OPEN_MS] = (c[CLONE_OPEN_MS] ?? 0) + dt;
  const running: { kind: string; id: string }[] = [];
  let cloneRuns = false;
  for (const [index, slot] of state.slots.entries()) {
    if (!slot.action || slot.share <= 0) continue;
    running.push(slot.action);
    if (isCloneSlot(state, content, index)) cloneRuns = true;
  }
  if (cloneRuns) c[CLONE_RUN_MS] = (c[CLONE_RUN_MS] ?? 0) + dt;
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
  /** Whether the pair is linked (the bonus applied). */
  linked: boolean;
}

/** What the balance stage reads: how long a clone slot existed and was used, and the pairs run together. */
export interface CloneTelemetry {
  /** Game time since the first slot opened, ms. */
  openMs: number;
  /** Game time a clone slot ran an action, ms. */
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
export function cloneTelemetry(state: GameState, content: ContentDb): CloneTelemetry {
  const openMs = counterValue(state, CLONE_OPEN_MS);
  const runMs = counterValue(state, CLONE_RUN_MS);
  const pairs: ClonePair[] = [];
  for (const [key, ms] of Object.entries(state.counters)) {
    if (!key.startsWith(CLONE_PAIR_PREFIX)) continue;
    const [x, y] = key.slice(CLONE_PAIR_PREFIX.length).split('|');
    const a = splitPart(x ?? '');
    const b = splitPart(y ?? '');
    if (a && b) pairs.push({ a, b, ms, linked: linked(a, b, content) });
  }
  pairs.sort((p, q) => q.ms - p.ms || (pairKey(p.a, p.b) < pairKey(q.a, q.b) ? -1 : 1));
  return { openMs, runMs, share: openMs > 0 ? runMs / openMs : 0, pairs };
}
