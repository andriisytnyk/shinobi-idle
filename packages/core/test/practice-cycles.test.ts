/** The practice cycle of a technique grows with the technique: within one skill a later technique takes longer per cycle. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { practiceIntervalSeconds, techniqueCastSeconds } from '../src/index.ts';

const cycle = (t: (typeof content.techniques)[number]): number =>
  practiceIntervalSeconds(techniqueCastSeconds(t, 1, content), content, t.level);

describe('the cycle of practising a technique', () => {
  const skills = [...new Set(content.techniques.map((t) => t.skill))];

  it('never gets shorter from one technique of a skill to the next, by required level', () => {
    for (const skill of skills) {
      const list = content.techniques
        .filter((t) => t.skill === skill)
        .sort((a, b) => a.level - b.level);
      for (const [i, t] of list.entries()) {
        const before = list[i - 1];
        if (before)
          expect(cycle(t), `${skill} ${before.id} -> ${t.id}`).toBeGreaterThanOrEqual(
            cycle(before) - 1e-9,
          );
      }
    }
  });

  it('runs from about two seconds for the first technique of a skill to four to six and a half for the last', () => {
    for (const skill of skills) {
      const list = content.techniques
        .filter((t) => t.skill === skill)
        .sort((a, b) => a.level - b.level);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) continue;
      expect(cycle(first), `${skill} first`).toBeLessThanOrEqual(2.5);
      expect(cycle(first), `${skill} first`).toBeGreaterThanOrEqual(content.balance.K.practiceMin);
      expect(cycle(last), `${skill} last`).toBeGreaterThanOrEqual(4);
      expect(cycle(last), `${skill} last`).toBeLessThanOrEqual(6.5);
    }
  });
});
