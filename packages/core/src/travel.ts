import type { ContentDb, Place } from '@shinobi/content';
import { rebalanceShares, stopSlot } from './actions.ts';
import { hasCurrency, removeCurrency } from './bank.ts';
import { growSlots } from './clone.ts';
import type { CommandResult } from './engine.ts';
import { emit } from './events.ts';
import { hexKey, hexOfAddress, placeAt, positionHex, positionOf, routeTo } from './hex.ts';
import { graduateReq } from './lookup.ts';
import { computeMod } from './modifiers.ts';
import { isFound, pointsAtHex } from './points.ts';
import { evalReq } from './requirements.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';
import { moneyOf } from './vocab.ts';
import { enterHex, STAND_ID, STAND_KIND, travelBlocked } from './world.ts';

/*
 * Travel that takes no time: for money to any hex the player has surveyed and can walk to, and for
 * nothing between the found outposts of one travel group (`Point.travel`, data). It moves only the
 * performer of the slot that asks. The slot's action is replaced (it is gone at the new place); a
 * clone that arrives stays and stands there (`STAND_KIND`).
 */

/** How the performer travels at once. */
export type JumpMode = 'paid' | 'outpost';

/** The price of travelling to `address` for the money of the game: the minutes of the route at full speed times `K.map.travel.ryoPerMinute`, scaled by the `travel.price` modifiers, never under `K.map.travel.min`. Null when there is no route. */
export function travelPrice(
  state: GameState,
  address: string,
  content: ContentDb,
  rules: Rules,
  slot = 0,
): number | null {
  const hex = hexOfAddress(content, address);
  const route = hex ? routeTo(state, content, hex, slot) : null;
  if (!route) return null;
  const T = content.balance.K.map.travel;
  const minutes = route.minutes.reduce((sum, m) => sum + m, 0);
  const mod = computeMod(rules, state, 'travel.price', content).total;
  // Rounded to six places first, so that a float's dust never costs a ryo.
  const raw = Math.round(T.ryoPerMinute * minutes * mod * 1e6) / 1e6;
  return Math.max(T.min, Math.ceil(raw));
}

/** The travel group of the found point the performer of `slot` stands on, or null. */
export function outpostGroup(state: GameState, content: ContentDb, slot = 0): string | null {
  const here = positionHex(state, content, slot);
  if (!here) return null;
  for (const place of pointsAtHex(content, hexKey(here.q, here.r)))
    if (place.point?.travel !== undefined && isFound(state, place.id)) return place.point.travel;
  return null;
}

/** The found points of the performer's travel group on other hexes: where a free trip leads from here. */
export function outpostTargets(state: GameState, content: ContentDb, slot = 0): Place[] {
  const group = outpostGroup(state, content, slot);
  const here = positionHex(state, content, slot);
  if (group === null || !here) return [];
  const own = hexKey(here.q, here.r);
  return content.places.filter(
    (p) => p.point?.travel === group && isFound(state, p.id) && hexKey(p.hex[0], p.hex[1]) !== own,
  );
}

/** Why the performer cannot make this trip at once (a localization key), or null. */
export function jumpBlocked(
  state: GameState,
  address: string,
  mode: JumpMode,
  content: ContentDb,
  rules: Rules,
  slot = 0,
): string | null {
  if (mode === 'outpost') {
    const hex = hexOfAddress(content, address);
    if (!hex) return 'error.unknownCell';
    const here = positionHex(state, content, slot);
    if (here && here.q === hex.q && here.r === hex.r) return 'error.alreadyThere';
    if (outpostGroup(state, content, slot) === null) return 'error.notAtOutpost';
    const target = hexKey(hex.q, hex.r);
    return outpostTargets(state, content, slot).some((p) => hexKey(p.hex[0], p.hex[1]) === target)
      ? null
      : 'error.notOutpostTarget';
  }
  const blocked = travelBlocked(state, address, content, slot);
  if (blocked) return blocked;
  const price = travelPrice(state, address, content, rules, slot);
  if (price === null) return 'error.cellNotReachable';
  return hasCurrency(state, moneyOf(content), price) ? null : 'error.notEnoughRyo';
}

/**
 * Travels at once: for ryo (the price is taken now) or free between outposts. The performer of
 * `slot` leaves what it was doing and arrives; a clone's slot then stands there. Refused with the
 * reason `jumpBlocked` gives.
 */
export function jumpTo(
  state: GameState,
  slot: number,
  address: string,
  mode: JumpMode,
  content: ContentDb,
  rules: Rules,
): CommandResult {
  if (slot >= state.slots.length && growSlots(state, content)) rebalanceShares(state, content);
  const entry = state.slots[slot];
  if (!entry) return { ok: false, reason: 'error.invalidSlot' };
  const graduated = evalReq(state, graduateReq(content), content);
  if (!graduated.met) return { ok: false, reason: 'error.requirementsNotMet', req: graduated };
  const blocked = jumpBlocked(state, address, mode, content, rules, slot);
  if (blocked) {
    const params =
      blocked === 'error.notEnoughRyo'
        ? { price: travelPrice(state, address, content, rules, slot) ?? 0 }
        : undefined;
    return { ok: false, reason: blocked, ...(params ? { params } : {}) };
  }
  const hex = hexOfAddress(content, address);
  if (!hex) return { ok: false, reason: 'error.unknownCell' };
  const price = mode === 'paid' ? (travelPrice(state, address, content, rules, slot) ?? 0) : 0;
  // A clone made here appears where the character stands, as a clone made by an action does.
  const idle = entry.action === null;
  if (slot > 0 && idle && positionOf(state, slot) === state.world.location)
    placeAt(state, slot, state.world.location);
  stopSlot(state, slot, 'replaced', content, rules);
  if (price > 0) removeCurrency(state, moneyOf(content), price);
  enterHex(state, hexKey(hex.q, hex.r), content, rules, slot, mode);
  if (slot > 0) {
    entry.action = { kind: STAND_KIND, id: STAND_ID };
    entry.progress = 0;
    entry.data = null;
    rebalanceShares(state, content);
  }
  if (price > 0) emit(state, { type: 'paidTravel', hex: hexKey(hex.q, hex.r), price, slot });
  emit(state, { type: 'travelled', cell: address });
  return { ok: true };
}
