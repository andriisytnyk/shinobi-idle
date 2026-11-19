import { describe, expect, it } from 'vitest';
import { trimLog, type SlotLine } from '../src/lib/battle-log.ts';

const line = (id: number, slot?: number): SlotLine => ({ id, event: { slot } });

describe('the battle log of several fights', () => {
  it('keeps the newest lines of each fight, not of all fights together', () => {
    // Fight 0 is busy (10 lines), fight 1 says little (2 lines): one shared cap of 4 would drop fight 1 entirely.
    const lines = [line(1, 1), line(2, 1)];
    for (let id = 3; id <= 12; id++) lines.push(line(id, 0));
    const kept = trimLog(lines, 4);
    expect(kept.filter((l) => l.event.slot === 1).map((l) => l.id)).toEqual([1, 2]);
    expect(kept.filter((l) => l.event.slot === 0).map((l) => l.id)).toEqual([9, 10, 11, 12]);
  });

  it('treats a line without a slot as the character’s and keeps the order', () => {
    const kept = trimLog([line(1), line(2, 0), line(3, 1), line(4), line(5, 1)], 2);
    expect(kept.map((l) => l.id)).toEqual([2, 3, 4, 5]);
  });

  it('leaves a short log as it is', () => {
    const lines = [line(1), line(2, 1)];
    expect(trimLog(lines, 60)).toEqual(lines);
  });
});
