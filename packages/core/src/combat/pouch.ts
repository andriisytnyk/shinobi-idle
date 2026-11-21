import { isAcademyRank, rankIndex } from '../vocab.ts';
import type { ContentDb, Item, PouchKind } from '@shinobi/content';
import { addItem } from '../bank.ts';
import type { CommandResult } from '../engine.ts';
import { emit } from '../events.ts';
import { indexOf } from '../lookup.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import { makeCtx } from './fight.ts';
import { pouchUse, useSlotByHand } from './fight-items.ts';
import type { FightState } from './fight-types.ts';
import type { PouchState } from './types.ts';

/*
 * The pouch: typed slots. Every slot has a kind (`content.pouchKinds`: which uses of items it takes
 * and how many units of its item it carries into a fight) and holds one item of its kind. Before
 * every fight (a zone fight, a stage of an operation or a mission, a boss) the slot is filled up to
 * the kind's per-fight amount from the Bank, or from the bag of a clone; inside a fight nothing
 * refills. The fight carries its own copy of the counts and the game copies them back after every
 * step, so the state is always current.
 */

/** The kinds of pouch slot by id. */
const kindIndex = new WeakMap<ContentDb, Map<string, PouchKind>>();

/** The kind of pouch slot with this id (the content's own list; a mod can add kinds). */
export function pouchKind(content: ContentDb, id: string): PouchKind | undefined {
  let map = kindIndex.get(content);
  if (!map) {
    map = new Map(content.pouchKinds.map((k) => [k.id, k]));
    kindIndex.set(content, map);
  }
  return map.get(id);
}

/** Units a slot of this kind carries into a fight (0 for a kind the content does not know). */
export function perFight(content: ContentDb, kind: string): number {
  return pouchKind(content, kind)?.perFight ?? 0;
}

/** Whether an item can sit in a slot of the kind: its use in a fight is one the kind takes. */
export function itemFitsKind(item: Item, kind: PouchKind, content: ContentDb): boolean {
  const use = pouchUse(item, content);
  return use !== null && (kind.uses as readonly string[]).includes(use);
}

/** The first kind of slot that takes the item, or undefined when none does (the item cannot ride in the pouch). */
export function kindOfItem(item: Item, content: ContentDb): PouchKind | undefined {
  return content.pouchKinds.find((k) => itemFitsKind(item, k, content));
}

/** The most slots the pouch can ever have: every kind's slots and its vest slots. */
export function maxPouchSlots(content: ContentDb): number {
  return content.pouchKinds.reduce((n, k) => n + k.slots + (k.vest ?? 0), 0);
}

/**
 * The kind of every slot of the pouch, in order: the base slots by kind in the order of the content,
 * then (from the rank of the vest on) the vest's extra slots by kind. A new slot is always added at
 * the end, so a rank never moves the slot a fight in progress is using.
 */
export function pouchLayout(state: GameState, content: ContentDb): string[] {
  // A student carries no pouch; it comes with the rank of Genin, the vest adds slots.
  if (isAcademyRank(content, state.player.rank)) return [];
  const out: string[] = [];
  for (const k of content.pouchKinds) for (let i = 0; i < k.slots; i++) out.push(k.id);
  // The vest comes with its rank and stays with every rank above it.
  const vest =
    rankIndex(content, state.player.rank) >= rankIndex(content, content.balance.K.pouch.vestRank);
  if (vest)
    for (const k of content.pouchKinds) for (let i = 0; i < (k.vest ?? 0); i++) out.push(k.id);
  return out;
}

/** Slots of the pouch. */
export function pouchSlotCount(state: GameState, content: ContentDb): number {
  return pouchLayout(state, content).length;
}

/** The highest medic pouch upgrade in the bank, 0 when none. */
export function medicTier(state: GameState, content: ContentDb): number {
  let tier = 0;
  for (const item of indexOf(content).medicItems) {
    if ((state.bank[item.id] ?? 0) > 0) tier = Math.max(tier, item.tier);
  }
  return tier;
}

/**
 * Makes the slot list match the rank and the kinds: a slot the layout no longer has returns its
 * units to the bank, a missing one is added empty.
 */
export function ensurePouch(state: GameState, content: ContentDb): void {
  const want = pouchLayout(state, content);
  const p = state.pouch;
  if (p.slots.length === want.length && p.slots.every((s, i) => s.kind === want[i])) return;
  const old = p.slots;
  const used = new Set<number>();
  const next: PouchState['slots'] = [];
  const at = new Map<number, number>();
  for (const kind of want) {
    const from = old.findIndex((s, i) => !used.has(i) && s.kind === kind);
    const held = from >= 0 ? old[from] : undefined;
    if (held) {
      used.add(from);
      at.set(from, next.length);
      next.push(held);
    } else next.push({ kind, id: '', n: 0 });
  }
  old.forEach((slot, i) => {
    if (!used.has(i) && slot.id !== '') addItem(state, slot.id, slot.n);
  });
  p.slots = next;
  p.medic = p.medic === null ? null : (at.get(p.medic) ?? null);
}

/** Fills every slot up to the per-fight amount of its kind, as far as the bank goes; what a smaller amount leaves over goes back. */
export function refillPouch(state: GameState, content: ContentDb): void {
  for (const slot of state.pouch.slots) {
    if (slot.id === '') continue;
    const cap = perFight(content, slot.kind);
    if (slot.n > cap) {
      addItem(state, slot.id, slot.n - cap);
      slot.n = cap;
    }
    const take = Math.min(cap - slot.n, state.bank[slot.id] ?? 0);
    if (take <= 0) continue;
    slot.n += take;
    const left = (state.bank[slot.id] ?? 0) - take;
    if (left > 0) state.bank[slot.id] = left;
    else delete state.bank[slot.id];
  }
}

/** Copies the unit counts of the running fight's pouch back to the state. */
export function syncPouch(state: GameState, fight: FightState): void {
  fight.pouch.forEach((held, i) => {
    const slot = state.pouch.slots[i];
    if (slot && slot.id === held.id) slot.n = held.n;
  });
}

/** Puts `item` (or nothing) in a slot: what was there goes back to the bank, the per-fight amount is taken from the bank. */
export function setPouchSlot(
  state: GameState,
  slot: number,
  item: string | null,
  content: ContentDb,
): CommandResult {
  ensurePouch(state, content);
  const held = state.pouch.slots[slot];
  if (!held || !Number.isInteger(slot)) return { ok: false, reason: 'error.invalidSlot' };
  // The pouch is packed before a fight, not during one.
  if (state.combat) return { ok: false, reason: 'error.fighting' };
  if (item !== null) {
    const def = indexOf(content).items.get(item);
    if (!def || pouchUse(def, content) === null) return { ok: false, reason: 'error.notPouchItem' };
    const kind = pouchKind(content, held.kind);
    if (!kind || !itemFitsKind(def, kind, content)) {
      return { ok: false, reason: 'error.wrongSlotKind' };
    }
    if (state.pouch.slots.some((s, i) => i !== slot && s.id === item)) {
      return { ok: false, reason: 'error.itemInPouch' };
    }
    if ((state.bank[item] ?? 0) + (held.id === item ? held.n : 0) < 1) {
      return { ok: false, reason: 'error.noItem' };
    }
  }
  if (held.id !== '') addItem(state, held.id, held.n);
  held.id = item ?? '';
  held.n = 0;
  if (item === null && state.pouch.medic === slot) state.pouch.medic = null;
  refillPouch(state, content);
  return { ok: true };
}

/** Chooses the slot the medic pouch empties on its own (null: none). Needs the medic pouch in the bank and a healing or restoring item in the slot. */
export function setMedicSlot(
  state: GameState,
  slot: number | null,
  content: ContentDb,
): CommandResult {
  if (slot === null) {
    state.pouch.medic = null;
    return { ok: true };
  }
  if (typeof slot !== 'number' || !Number.isInteger(slot)) {
    return { ok: false, reason: 'error.invalidSlot' };
  }
  if (medicTier(state, content) < 1) return { ok: false, reason: 'error.noMedicPouch' };
  const held = state.pouch.slots[slot];
  if (!held || held.id === '') return { ok: false, reason: 'error.emptySlot' };
  const def = indexOf(content).items.get(held.id);
  const use = def ? pouchUse(def, content) : null;
  if (use !== 'heal' && use !== 'restore') return { ok: false, reason: 'error.itemNotUsable' };
  state.pouch.medic = slot;
  return { ok: true };
}

/** The player empties a healing or restoring slot by hand during a fight. */
export function usePouchSlot(
  state: GameState,
  slot: number,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  const c = state.combat;
  if (!c || c.phase !== 'fight') return { ok: false, reason: 'error.notFighting' };
  const id = c.fight.pouch[slot]?.id ?? '';
  const reason = useSlotByHand(makeCtx(c.fight, content, rules), slot);
  if (reason) return { ok: false, reason };
  syncPouch(state, c.fight);
  emit(state, { type: 'itemUsed', id, target: 'player' });
  return { ok: true };
}
