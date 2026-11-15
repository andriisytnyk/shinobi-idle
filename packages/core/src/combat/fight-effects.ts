import type { Combatant, Effect, ModStat } from './fight-types.ts';
import { RATE_FULL } from './units.ts';

export function findEffect(c: Combatant, id: string): Effect | undefined {
  return c.effects.find((e) => e.id === id);
}

/** Whether another active effect switches the effect `id` off (bind and Evasive, burn and Regeneration). */
export function isSuppressed(c: Combatant, id: string): boolean {
  return c.effects.some((e) => e.suppresses === id);
}

/** Whether the effect is present and not switched off. */
export function isWorking(c: Combatant, id: string): boolean {
  return findEffect(c, id) !== undefined && !isSuppressed(c, id);
}

/** A stat after its modifiers: the product of multipliers times `1 + sum of additions`. */
export function statOf(c: Combatant, stat: ModStat, base: number): number {
  let mul = 1;
  let add = 0;
  for (const e of c.effects) {
    if (e.kind !== 'modifier' || e.stat !== stat || isSuppressed(c, e.id)) continue;
    if (e.op === 'mul') mul *= e.value;
    else add += e.value;
  }
  return base * mul * (1 + add);
}

/** Timer speed in thousandths of full speed; 0 while stunned. */
export function speedOf(c: Combatant): number {
  return Math.max(0, Math.round(statOf(c, 'speed', RATE_FULL)));
}

/**
 * Puts an effect on a combatant. An effect with the same id is refreshed in place, never
 * stacked: its numbers and end time are replaced and a running periodic effect keeps its tick
 * schedule. Returns the effect now on the combatant.
 */
export function addEffect(c: Combatant, effect: Effect): Effect {
  const index = c.effects.findIndex((e) => e.id === effect.id);
  const old = c.effects[index];
  if (!old) {
    c.effects.push(effect);
    return effect;
  }
  if (old.kind === 'periodic' && effect.kind === 'periodic') effect.next = old.next;
  c.effects[index] = effect;
  return effect;
}

export function removeEffect(c: Combatant, id: string): boolean {
  const index = c.effects.findIndex((e) => e.id === id);
  if (index < 0) return false;
  c.effects.splice(index, 1);
  return true;
}
