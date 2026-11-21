import { content } from '@shinobi/content';
import { advance, createState, defaultRules, dispatch } from '@shinobi/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { runDev } from '../src/dev/commands.ts';
import { setActiveContent } from '../src/lib/active.ts';
import { composeBoot } from '../src/lib/boot.ts';
import { senseiTestInfo } from '../src/lib/exam-test.ts';
import { formatDuration } from '../src/lib/format.ts';

beforeAll(() => setActiveContent(composeBoot().content));

describe('the time of the Genin exam', () => {
  it('shown at the start is the time a run of the exam really takes', () => {
    const state = createState(1, content);
    const exam = content.exams[0]!;
    const ready = runDev(state, content, defaultRules, { type: 'exam.ready', rank: exam.rank });
    expect(ready.ok).toBe(true);
    const started = dispatch(state, { type: 'exam.start', rank: exam.rank }, content, defaultRules);
    expect(started.ok).toBe(true);

    const shown = senseiTestInfo(state, defaultRules, content)!.left;
    const start = state.now;
    const rankBefore = state.player.rank;
    while (state.player.rank === rankBefore) {
      advance(state, 1000, content, defaultRules);
      if (state.now - start > 3_600_000) throw new Error('the exam never ended');
    }
    const measured = state.now - start;
    // The run advances in whole seconds, so it can overshoot the shown time by less than one.
    expect(measured - shown).toBeGreaterThanOrEqual(0);
    expect(measured - shown).toBeLessThan(1000);
    expect(formatDuration(shown)).toBe(formatDuration(Math.floor(measured / 1000) * 1000));
  });

  it('keeps the seconds of a span under an hour', () => {
    expect(formatDuration(210_000)).toBe('3 хв 30 с');
    expect(formatDuration(180_000)).toBe('3 хв');
    expect(formatDuration(45_000)).toBe('45 с');
    expect(formatDuration(3_900_000)).toBe('1 год 5 хв');
  });
});
