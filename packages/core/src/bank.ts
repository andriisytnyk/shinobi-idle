import type { GameState } from './state.ts';

/** A currency id of the content. */
export type Currency = string;

const isCount = (n: number) => Number.isInteger(n) && n >= 0;

export function hasItem(state: GameState, id: string, n = 1): boolean {
  return (state.bank[id] ?? 0) >= n;
}

/** Adds `n` items. Returns false, changing nothing, if `n` is not a whole non-negative number. */
export function addItem(state: GameState, id: string, n: number): boolean {
  if (!isCount(n)) return false;
  if (n > 0) {
    state.bank[id] = (state.bank[id] ?? 0) + n;
    // Having held an item is remembered for the reveal rule: it stays shown after the last one is used up.
    state.shown[id] = true;
  }
  return true;
}

/** Removes `n` items. Returns false, changing nothing, if the bank holds fewer. */
export function removeItem(state: GameState, id: string, n: number): boolean {
  if (!isCount(n) || !hasItem(state, id, n)) return false;
  const left = (state.bank[id] ?? 0) - n;
  if (left > 0) state.bank[id] = left;
  else delete state.bank[id];
  return true;
}

export function hasCurrency(state: GameState, currency: Currency, n: number): boolean {
  return Object.hasOwn(state.currencies, currency) && (state.currencies[currency] ?? 0) >= n;
}

export function addCurrency(state: GameState, currency: Currency, n: number): boolean {
  // A currency the state does not have (its pack is missing) takes nothing.
  if (!isCount(n) || !Object.hasOwn(state.currencies, currency)) return false;
  state.currencies[currency] = (state.currencies[currency] ?? 0) + n;
  return true;
}

/** Spends `n`. Returns false, changing nothing, if the balance is too low. */
export function removeCurrency(state: GameState, currency: Currency, n: number): boolean {
  if (!isCount(n) || !hasCurrency(state, currency, n)) return false;
  if (n > 0) state.currencies[currency] = (state.currencies[currency] ?? 0) - n;
  return true;
}
