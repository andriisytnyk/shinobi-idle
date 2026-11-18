import type { PouchState, CombatState } from './combat/types.ts';
import type { CloneBody, GameState } from './state.ts';

/*
 * Whose action is being computed. The character is slot 0; every shadow clone is the performer of its
 * own slot. Code that runs an action (a cycle, a stop, a fight step) runs it `asPerformer(state, slot, fn)`:
 * the clone's bag, purse, pouch and fight stand in for the state's `bank`, `currencies`, `pouch` and
 * `combat` for the time of `fn`, so the whole of the game's code, which reads those names, works on
 * the clone's own things; and `actingPerformer()` says whose action it is, for what depends on it (the
 * XP and Mastery a clone keeps for its dispel, the place of power the performer stands on, the fatigue).
 *
 * The swap is synchronous and put back in `finally`: nothing outside `fn` ever sees it, no state is
 * left swapped, and `dispatch` / `advance` stay the only things that change the state.
 */

/** The action kind of a clone that has nothing to do: it stands where it is, keeping its place on the map and spending almost no chakra. */
export const STAND_KIND = 'stand';
/** The only action id of standing. */
export const STAND_ID = 'here';

interface Context {
  state: GameState | null;
  slot: number;
  body: CloneBody | null;
}

interface Held {
  bank: GameState['bank'];
  currencies: GameState['currencies'];
  pouch: PouchState;
  combat: CombatState | null;
}

let current: Context = { state: null, slot: 0, body: null };
let held: Held | null = null;

/** The slot whose action is being computed now (0, the character, outside any `asPerformer`). */
export const actingPerformer = (): number => current.slot;

/** The body of the clone whose action is being computed, or null when it is the character's. */
export const actingBody = (state: GameState): CloneBody | null =>
  current.state === state ? current.body : null;

function leave(state: GameState): void {
  const body = current.body;
  if (body && held && current.state === state) {
    body.bag = state.bank;
    body.purse = state.currencies;
    body.pouch = state.pouch;
    body.fight = state.combat;
    state.bank = held.bank;
    state.currencies = held.currencies;
    state.pouch = held.pouch;
    state.combat = held.combat;
  }
  held = null;
  current = { state: null, slot: 0, body: null };
}

function enter(state: GameState, slot: number, body: CloneBody | null): void {
  if (body) {
    held = {
      bank: state.bank,
      currencies: state.currencies,
      pouch: state.pouch,
      combat: state.combat,
    };
    state.bank = body.bag;
    state.currencies = body.purse;
    state.pouch = body.pouch;
    state.combat = body.fight;
  }
  current = { state, slot, body };
}

/** Runs `fn` as the performer of `slot` (see the note above). Calls may nest, also for different slots. */
export function asPerformer<T>(state: GameState, slot: number, fn: () => T): T {
  const body = slot > 0 ? (state.clones[slot] ?? null) : null;
  if (current.state === state && current.slot === slot && current.body === body) return fn();
  const outer = current.state === state ? current : null;
  if (outer) leave(state);
  enter(state, slot, body);
  try {
    return fn();
  } finally {
    leave(state);
    if (outer) enter(state, outer.slot, outer.body);
  }
}

/** The fight of the performer of `slot`: the character's `state.combat`, or the clone's own. */
export function fightOf(state: GameState, slot: number): CombatState | null {
  if (current.state === state && current.slot === slot && current.body) return state.combat;
  if (slot === 0) return state.combat;
  return state.clones[slot]?.fight ?? null;
}

/** Every fight that runs, with the slot of its performer: the character's first, then the clones' by slot. */
export function allFights(state: GameState): { slot: number; fight: CombatState }[] {
  const out: { slot: number; fight: CombatState }[] = [];
  if (state.combat) out.push({ slot: 0, fight: state.combat });
  for (const key of Object.keys(state.clones)) {
    const fight = state.clones[key]?.fight;
    if (fight) out.push({ slot: Number(key), fight });
  }
  return out;
}
