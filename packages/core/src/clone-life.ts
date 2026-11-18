import type { ContentDb } from '@shinobi/content';
import { actionKindOf, rebalanceShares, stopSlot } from './actions.ts';
import { addCurrency, addItem, removeItem } from './bank.ts';
import { cloneTechniqueOf, growSlots, slotCount } from './clone.ts';
import { playerMaxChakra } from './combat/stats.ts';
import { refillPouch } from './combat/pouch.ts';
import { followChakraPool } from './combat/system.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { MS_PER_HOUR, MS_PER_SECOND, masteryLevel, rate } from './formulas.ts';
import { placeAt, removeFigure } from './hex.ts';
import { indexOf } from './lookup.ts';
import { bonusOf, type Modifier, type ModifierProvider } from './modifiers.ts';
import { STAND_ID, STAND_KIND, asPerformer, actingPerformer } from './performer.ts';
import { takeMastery, takeXp } from './progression.ts';
import { skillLevel } from './requirements.ts';
import type { Rules } from './rules.ts';
import { LIFE_FULL, type CloneBody, type GameState } from './state.ts';
import type { System } from './system.ts';
import { levelAt } from './xp.ts';

/*
 * The life of a shadow clone and the mind fatigue it leaves. A clone is a burst you pay for:
 * - it is made into a slot, takes a share of the chakra pool (pool ÷ (n + 1)) and a pouch of things
 *   from the Bank, and works at full speed there;
 * - it spends its own chakra over time, by the kind of action it does (`K.clone.life`), and is
 *   dispelled when the chakra is out; the Mastery of the clone technique and the level of Meditation
 *   (`K.clone.lifeMastery`, `lifeSkillLevel`, and the modifier `clone.pool`) make it last longer;
 * - its XP, Mastery, items and money stay in it until it is dispelled (by the player, by its chakra,
 *   by death), and then pass to the character, who is left with a mind fatigue proportional to the XP:
 *   while it lasts no clone can be made and the character is slower (`K.clone.fatigue`).
 * All the time maths is whole numbers: `life` is parts of `LIFE_FULL`, `fatigue` thousandths of ms.
 */

/** The unit `GameState.fatigue` is kept in: this many to a ms. */
export const FATIGUE_UNIT = 1000;

// ---------- life ----------

/** The seconds a clone lives at full chakra doing an action of this kind, before the extensions. */
export function lifeSeconds(kind: string | undefined, content: ContentDb): number {
  const life = content.balance.K.clone.life;
  return kind !== undefined && Object.hasOwn(life, kind)
    ? (life[kind] as number)
    : (life['default'] as number);
}

/** How much longer than its base the life of the clone in `slot` is: Mastery of the technique, the level of Meditation, the modifier `clone.pool`. */
export function lifeExtension(
  state: GameState,
  slot: number,
  content: ContentDb,
  rules: Rules,
): number {
  const K = content.balance.K.clone;
  const technique = cloneTechniqueOf(state, content, slot);
  const mastery = technique ? Math.max(0, masteryLevel(state, technique, content) - 1) : 0;
  const own =
    1 + K.lifeMastery * mastery + K.lifeSkillLevel * skillLevel(state, K.lifeSkill, content);
  return Math.max(0.01, own * (1 + bonusOf(rules, state, 'clone.pool', content)));
}

/** The life a ms takes from the clone in `slot` now, in parts of `LIFE_FULL` (a whole number, at least 1). */
export function lifeRate(state: GameState, slot: number, content: ContentDb, rules: Rules): number {
  const seconds = lifeSeconds(state.slots[slot]?.action?.kind, content);
  const ext = lifeExtension(state, slot, content, rules);
  return Math.max(1, Math.round(LIFE_FULL / (seconds * MS_PER_SECOND * ext)));
}

/** The ms the clone in `slot` has left at its present rate (what it does now), or 0. */
export function lifeLeftMs(
  state: GameState,
  slot: number,
  content: ContentDb,
  rules: Rules,
): number {
  const body = state.clones[slot];
  if (!body || body.life <= 0) return 0;
  return Math.ceil(body.life / lifeRate(state, slot, content, rules));
}

// ---------- fatigue ----------

/**
 * How fast the fatigue clears, in `FATIGUE_UNIT` per ms: one ms of fatigue per ms, faster by
 * `decayPerLevel` per level of Meditation, and by `meditating` more while the character itself
 * does an action that trains it.
 */
export function fatigueRate(state: GameState, content: ContentDb, rules: Rules): number {
  const K = content.balance.K.clone;
  let factor = 1 + K.fatigue.decayPerLevel * skillLevel(state, K.lifeSkill, content);
  const action = state.slots[0]?.action;
  if (action && actionKindOf(rules, action.kind)?.skill?.(action.id, content) === K.lifeSkill)
    factor += K.fatigue.meditating;
  return Math.max(1, Math.round(FATIGUE_UNIT * factor));
}

/** The ms the mind fatigue lasts at its present rate (0 when none). */
export function fatigueLeftMs(state: GameState, content: ContentDb, rules: Rules): number {
  return state.fatigue > 0 ? Math.ceil(state.fatigue / fatigueRate(state, content, rules)) : 0;
}

/** The fatigue (ms) that handing over this XP would leave: `share` of the hours of work it stands for, skill by skill. */
export function fatigueFor(
  state: GameState,
  xp: Readonly<Record<string, number>>,
  content: ContentDb,
): number {
  const K = content.balance.K;
  let hours = 0;
  for (const [skill, amount] of Object.entries(xp)) {
    if (!(amount > 0)) continue;
    const level = levelAt(state.skills[skill]?.xp ?? 0, K.cap);
    hours += amount / rate(Math.max(1, level), content);
  }
  return Math.min(K.clone.fatigue.maxMs, Math.round(hours * MS_PER_HOUR * K.clone.fatigue.share));
}

/** Adds `ms` of fatigue, up to the longest it can grow. */
function addFatigue(state: GameState, ms: number, content: ContentDb): void {
  const max = content.balance.K.clone.fatigue.maxMs * FATIGUE_UNIT;
  state.fatigue = Math.min(max, Math.max(0, state.fatigue) + Math.round(ms * FATIGUE_UNIT));
}

/**
 * While the mind is tired the character's actions are slower: every skill's speed drops by
 * `K.clone.fatigue.slow`. The clones are not tired; only the performer of slot 0 is.
 */
export const fatigueProvider: ModifierProvider = (state, content) => {
  if (!(state.fatigue > 0) || actingPerformer() !== 0) return NO_MODS;
  const slow = content.balance.K.clone.fatigue.slow;
  if (!(slow > 0)) return NO_MODS;
  return content.skills.map((skill): Modifier => ({
    key: `speed.skill.${skill.id}`,
    op: 'add',
    value: -slow,
    group: 'character',
    source: 'mod.source.fatigue',
  }));
};
const NO_MODS: Modifier[] = [];

// ---------- making a clone ----------

/** The default pouch: the stacks the character's own pouch holds, as much of each as the Bank has. */
export function defaultPouch(state: GameState, content: ContentDb): Record<string, number> {
  const cap = content.balance.K.pouchStack;
  const out: Record<string, number> = {};
  for (const slot of state.pouch.slots) {
    const have = state.bank[slot.id] ?? 0;
    if (slot.id !== '' && have > 0) out[slot.id] = Math.min(cap, have);
  }
  return out;
}

/** A clone body with the default pouch in its bag: what a clone made by starting an action would be, for a forecast that judges the action as that clone. */
export function probeBody(state: GameState, content: ContentDb): CloneBody {
  const purse: Record<string, number> = {};
  for (const currency of content.currencies) purse[currency.id] = 0;
  return {
    life: LIFE_FULL,
    max: 0,
    born: state.now,
    bag: defaultPouch(state, content),
    purse,
    pouch: { slots: state.pouch.slots.map((s) => ({ id: s.id, n: 0 })), medic: state.pouch.medic },
    xp: {},
    mastery: {},
    fight: null,
  };
}

/** The free clone slot a new clone would take, or null. */
export function freeCloneSlot(state: GameState, content: ContentDb): number | null {
  const count = Math.max(state.slots.length, slotCount(state, content));
  for (let at = 1; at < count; at++) if (!state.clones[at]) return at;
  return null;
}

/**
 * Why a clone cannot be made now (a localization key), or null. The same answer `clone.create`
 * gives, so a button and the command cannot disagree. A clone works in any slot after the
 * character's (a known technique opens them).
 */
export function cloneRefusal(state: GameState, content: ContentDb, slot?: number): string | null {
  const count = Math.max(state.slots.length, slotCount(state, content));
  if (count < 2) return 'error.noCloneTechnique';
  const at = slot ?? freeCloneSlot(state, content);
  if (at === null) return 'error.cloneExists';
  if (!Number.isInteger(at) || at < 1 || at >= count) return 'error.invalidSlot';
  if (state.clones[at]) return 'error.cloneExists';
  if (state.fatigue > 0) return 'error.cloneFatigued';
  return null;
}

/**
 * Makes a clone: it takes `items` (a pick from the Bank; the default pouch when omitted) and its
 * share of the chakra pool, appears where the character stands and stands there until given work.
 */
export function createClone(
  state: GameState,
  slot: number | undefined,
  items: Readonly<Record<string, number>> | undefined,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const refused = cloneRefusal(state, content, slot);
  if (refused) return { ok: false, reason: refused };
  const at = slot ?? (freeCloneSlot(state, content) as number);
  growSlots(state, content);
  const slotState = state.slots[at];
  if (!slotState) return { ok: false, reason: 'error.invalidSlot' };
  const pick = items ?? defaultPouch(state, content);
  const known = indexOf(content).itemIds;
  const entries = Object.entries(pick);
  for (const [id, n] of entries) {
    if (!known.has(id) || !Number.isInteger(n) || n < 0)
      return { ok: false, reason: 'error.noItem' };
    if ((state.bank[id] ?? 0) < n) return { ok: false, reason: 'error.noItem' };
  }
  const purse: Record<string, number> = {};
  for (const currency of content.currencies) purse[currency.id] = 0;
  const body: CloneBody = {
    life: LIFE_FULL,
    max: 0,
    born: state.now,
    bag: {},
    purse,
    pouch: {
      slots: state.pouch.slots.map((s) => ({ id: s.id, n: 0 })),
      medic: state.pouch.medic,
    },
    xp: {},
    mastery: {},
    fight: null,
  };
  // Whatever slot state a clone slot had is gone: it holds the clone's stand now.
  if (slotState.action) stopSlot(state, at, 'replaced', content, rules);
  state.clones[at] = body;
  for (const [id, n] of entries) {
    if (n > 0 && removeItem(state, id, n)) body.bag[id] = n;
  }
  // Its share of the pool: the character's pool divided by the performers (the divisor counts this clone already).
  body.max = playerMaxChakra(state, content);
  asPerformer(state, at, () => refillPouch(state, content));
  placeAt(state, at, state.world.location);
  slotState.action = { kind: STAND_KIND, id: STAND_ID };
  slotState.progress = 0;
  slotState.data = null;
  rebalanceShares(state, content);
  emit(state, { type: 'cloneMade', slot: at });
  followChakraPool(state, content);
  return { ok: true };
}

// ---------- dispelling ----------

/** What dispelling the clone in `slot` would hand to the character: skill XP, Mastery, the bag and the purse, and the fatigue. */
export interface DispelPreview {
  xp: Record<string, number>;
  mastery: Record<string, { skill: string; amount: number }>;
  bag: Record<string, number>;
  purse: Record<string, number>;
  /** The mind fatigue it would leave, ms. */
  fatigueMs: number;
}

/** The knowledge, things and fatigue the clone in `slot` holds (the dispel hands them over); null when no clone is there. */
export function dispelPreview(
  state: GameState,
  slot: number,
  content: ContentDb,
): DispelPreview | null {
  const body = state.clones[slot];
  if (!body) return null;
  const bag = { ...body.bag };
  for (const held of body.pouch.slots)
    if (held.id !== '' && held.n > 0) bag[held.id] = (bag[held.id] ?? 0) + held.n;
  // A fight that is being fought pays what it earned when the clone is dispelled: it is held already or still in the fight.
  const xp = { ...body.xp };
  const pending = body.fight?.pending;
  if (pending)
    for (const [skill, amount] of Object.entries(pending.xp)) xp[skill] = (xp[skill] ?? 0) + amount;
  return {
    xp,
    mastery: Object.fromEntries(
      Object.entries(body.mastery).map(([key, m]) => [key, { skill: m.skill, amount: m.amount }]),
    ),
    bag,
    purse: Object.fromEntries(Object.entries(body.purse).filter(([, n]) => n > 0)),
    fatigueMs: fatigueFor(state, xp, content),
  };
}

/** Hands the character everything the clone holds and leaves the fatigue; the body is gone after. */
function absorb(
  state: GameState,
  body: CloneBody,
  content: ContentDb,
): { xp: Record<string, number>; fatigueMs: number } {
  for (const [id, n] of Object.entries(body.bag)) addItem(state, id, n);
  for (const held of body.pouch.slots)
    if (held.id !== '' && held.n > 0) addItem(state, held.id, held.n);
  for (const [currency, n] of Object.entries(body.purse))
    if (n > 0) addCurrency(state, currency, n);
  const fatigueMs = fatigueFor(state, body.xp, content);
  for (const [skill, gained] of Object.entries(body.xp)) takeXp(state, skill, gained, content);
  for (const [key, m] of Object.entries(body.mastery))
    takeMastery(state, key, m.skill, m.amount, m.pool, content);
  if (fatigueMs > 0) addFatigue(state, fatigueMs, content);
  return { xp: { ...body.xp }, fatigueMs };
}

/**
 * Dispels the clone in `slot`: its action stops (a fight it is in pays what it earned, unless it was lost),
 * everything it holds goes to the character, and it leaves the map. `death`: it fell in a fight; the
 * fight's earnings are already dropped, everything else returns.
 */
export function dispelClone(
  state: GameState,
  slot: number,
  cause: 'manual' | 'life' | 'death',
  content: ContentDb,
  rules: Rules,
  /** A clone that was made a moment ago and could not take its action: it goes with no word said. */
  quiet = false,
): void {
  const body = state.clones[slot];
  if (!body) return;
  const held = state.slots[slot];
  if (quiet && held) {
    held.action = null;
    held.progress = 0;
    held.data = null;
  } else if (held?.action) stopSlot(state, slot, 'dispelled', content, rules);
  // The stop may have paid a fight's earnings into the clone; the body held by the state is the same object.
  const handed = absorb(state, body, content);
  delete state.clones[slot];
  removeFigure(state, slot);
  rebalanceShares(state, content);
  if (!quiet)
    emit(state, {
      type: 'cloneDispelled',
      slot,
      cause,
      xp: handed.xp,
      fatigueMs: handed.fatigueMs,
    });
  followChakraPool(state, content);
}

// ---------- the system ----------

export const cloneSystem: System = {
  nextEventIn(state, content, rules) {
    let best: number | null = null;
    const soonest = (wait: number): void => {
      if (best === null || wait < best) best = wait;
    };
    for (const key of Object.keys(state.clones)) {
      const body = state.clones[key] as CloneBody;
      soonest(
        body.doomed || body.life <= 0
          ? 0
          : Math.ceil(body.life / lifeRate(state, Number(key), content, rules)),
      );
    }
    if (state.fatigue > 0) soonest(Math.ceil(state.fatigue / fatigueRate(state, content, rules)));
    return best;
  },

  elapse(state, dt, content, rules) {
    for (const key of Object.keys(state.clones)) {
      const body = state.clones[key] as CloneBody;
      body.life = Math.max(0, body.life - dt * lifeRate(state, Number(key), content, rules));
    }
    if (state.fatigue > 0)
      state.fatigue = Math.max(0, state.fatigue - dt * fatigueRate(state, content, rules));
  },

  run(state, content, rules) {
    for (const key of Object.keys(state.clones)
      .map(Number)
      .sort((a, b) => a - b)) {
      const body = state.clones[key];
      if (!body) continue;
      if (body.doomed) dispelClone(state, key, 'death', content, rules);
      else if (body.life <= 0) dispelClone(state, key, 'life', content, rules);
    }
  },
};
