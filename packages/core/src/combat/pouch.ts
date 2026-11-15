import type { ContentDb } from '@shinobi/content';
import { addItem } from '../bank.ts';
import type { CommandResult } from '../engine.ts';
import { emit } from '../events.ts';
import { indexOf } from '../lookup.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';
import { makeCtx } from './fight.ts';
import { pouchUse, useSlotByHand } from './fight-items.ts';
import type { FightState } from './fight-types.ts';

/*
 * The pouch: slots of one item each, up to the stack cap. It is packed from the bank, refilled
 * between the fights of a zone and never inside an operation. The fight carries its own copy of
 * the counts and the game copies them back after every step, so the state is always current.
 */

const RANK_VEST = 'chunin';

/** Slots of the pouch: the base count, and the extra the chunin vest gives. */
export function pouchSlotCount(state: GameState, content: ContentDb): number {
  const p = content.balance.K.pouch;
  return p.slots + (state.player.rank === RANK_VEST ? p.vest : 0);
}

/** The highest medic pouch upgrade in the bank, 0 when none. */
export function medicTier(state: GameState, content: ContentDb): number {
  let tier = 0;
  for (const item of content.items) {
    if (item.medic !== undefined && (state.bank[item.id] ?? 0) > 0)
      tier = Math.max(tier, item.medic);
  }
  return tier;
}

/** Makes the slot list match the rank: a lost slot returns its units to the bank. */
export function ensurePouch(state: GameState, content: ContentDb): void {
  const want = pouchSlotCount(state, content);
  const p = state.pouch;
  while (p.slots.length > want) {
    const slot = p.slots.pop();
    if (slot && slot.id !== '') addItem(state, slot.id, slot.n);
  }
  while (p.slots.length < want) p.slots.push({ id: '', n: 0 });
  if (p.medic !== null && p.medic >= p.slots.length) p.medic = null;
}

/** Tops every slot up from the bank, to the stack cap. */
export function refillPouch(state: GameState, content: ContentDb): void {
  const cap = content.balance.K.pouchStack;
  for (const slot of state.pouch.slots) {
    if (slot.id === '') continue;
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

/** Puts `item` (or nothing) in a slot: what was there goes back to the bank, the stack is taken from the bank. */
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
    if (!def || pouchUse(def) === null) return { ok: false, reason: 'error.notPouchItem' };
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
  if (medicTier(state, content) < 1) return { ok: false, reason: 'error.noMedicPouch' };
  const held = state.pouch.slots[slot];
  if (!held || held.id === '') return { ok: false, reason: 'error.emptySlot' };
  const def = indexOf(content).items.get(held.id);
  const use = def ? pouchUse(def) : null;
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
