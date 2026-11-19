import type { RevealLevel } from '@shinobi/core';
import type { EntityRef } from './route.ts';

/*
 * The reveal rule as the interface uses it. The core decides (`revealOf`); this module is the one
 * door the components and the name helpers go through, so nothing prints the name of an entity the
 * player has not discovered. `createGame` installs the reader that is tied to the running game and
 * a coarse stamp (it moves on a command, a drained event, a new state or a new game second), so a
 * value read inside `$derived` follows the game without being recomputed on every tick; before a
 * game exists (and in tests that mount a component alone) everything counts as shown.
 */

/** What the interface prints in place of a name it may not show. */
export const MASK = '???';

export interface RevealReader {
  /** How much of the entity may be shown; reactive through the stamp of the game. */
  level(ref: EntityRef): RevealLevel;
  /** The text key that says how to learn more, or null. */
  hint(ref: EntityRef): string | null;
  /** Tells the core that these entities were shown legitimately; the core refuses what it does not allow. */
  mark(refs: readonly EntityRef[]): void;
}

let reader: RevealReader | null = null;
let disabled = false;

/** Called by `createGame`. */
export function setRevealReader(next: RevealReader | null): void {
  reader = next;
}

/** How much of an entity may be shown now. */
export const revealLevel = (ref: EntityRef): RevealLevel =>
  disabled || ref.kind === 'hex' ? 'full' : (reader?.level(ref) ?? 'full');

/** The hint text key for an entity that is not fully shown, or null. */
export const revealHintKey = (ref: EntityRef): string | null =>
  disabled ? null : (reader?.hint(ref) ?? null);

/** Whether the name of the entity may be printed. */
export const nameShown = (ref: EntityRef): boolean => revealLevel(ref) !== 'hidden';

/** Records that the entities were shown legitimately (a shop row, a recipe list, a reward on a mission the player may take). */
export function markShown(refs: readonly EntityRef[]): void {
  if (refs.length > 0 && !disabled) reader?.mark(refs);
}

/** Tests switch the rule off around a check that is about something else (every entity then counts as shown in full), and back on. */
export function setRevealDisabled(value: boolean): void {
  disabled = value;
}

/** The `kind:id` text of an entity for a `data-entity` attribute, or undefined for an entity the player has not discovered: nothing derived from it reaches the DOM. */
export const entityAttr = (ref: EntityRef): string | undefined =>
  nameShown(ref) ? `${ref.kind}:${ref.id}` : undefined;

/** An id for a data attribute (`data-input`, `data-buy`, ...) of an entity of this kind, or undefined while it is hidden. */
export const idAttr = (kind: string, id: string): string | undefined =>
  nameShown({ kind, id }) ? id : undefined;
