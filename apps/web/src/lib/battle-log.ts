/** The line of a battle log the page keeps: an event of a fight, numbered for keyed lists. */
export interface SlotLine {
  id: number;
  event: { slot?: number | undefined };
}

/** The performer a line belongs to: 0, the character, or the slot of a clone. */
export const lineSlot = (line: SlotLine): number => line.event.slot ?? 0;

/**
 * The newest `limit` lines of every performer, in their original order. Each fight keeps its own
 * lines, so a busy fight does not push the lines of another one out of the log.
 */
export function trimLog<T extends SlotLine>(lines: readonly T[], limit: number): T[] {
  const kept = new Map<number, number>();
  const keep = new Array<boolean>(lines.length);
  for (let i = lines.length - 1; i >= 0; i--) {
    const slot = lineSlot(lines[i] as T);
    const n = (kept.get(slot) ?? 0) + 1;
    kept.set(slot, n);
    keep[i] = n <= limit;
  }
  return lines.filter((_, i) => keep[i]);
}
