import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  defaultRules,
  dispatch,
  gainXp,
  refreshUnlocks,
  xpAt,
} from '../src/index.ts';

describe('A12: technique unlocks', () => {
  it('a fresh state knows exactly the Academy techniques available at level 1', () => {
    const state = createState(1, content);
    expect(Object.keys(state.known).sort()).toEqual(
      ['core:body_replacement', 'core:clone', 'core:leaf_whirlwind', 'core:transformation'].sort(),
    );
    expect(state.events).toEqual([]);
  });

  it('a student at Taijutsu 10 does not learn other mentors techniques', () => {
    const state = createState(1, content);
    state.skills.tai.xp = xpAt(10);
    expect(refreshUnlocks(state, content)).toEqual([]);
    expect(state.known['core:dynamic_entry']).toBeUndefined();
  });

  it('a genin learns them on refresh, with an event, and only once', () => {
    const state = createState(1, content);
    state.skills.tai.xp = xpAt(10);
    state.player.rank = 'genin';
    const learned = refreshUnlocks(state, content);
    expect(learned).toContain('core:dynamic_entry');
    expect(learned).toHaveLength(6); // plus the five level-1 nature techniques
    expect(state.known['core:dynamic_entry']).toBe(true);
    expect(state.events).toContainEqual({
      type: 'techniqueLearned',
      id: 'core:dynamic_entry',
      at: 0,
    });
    expect(refreshUnlocks(state, content)).toEqual([]);
  });

  it('a level-up triggers the check, and Academy techniques unlock for students', () => {
    const state = createState(1, content);
    state.skills.nin.xp = xpAt(24);
    // A student at level 24 is slowed to a quarter, so feed four times the gap.
    gainXp(state, 'nin', (xpAt(25) - xpAt(24)) * 4, content, defaultRules);
    expect(state.known['core:rope_escape']).toBe(true);
    expect(state.events.some((e) => e.type === 'techniqueLearned')).toBe(true);
  });

  it('never auto-unlocks scroll, carrier or quest techniques', () => {
    const state = createState(1, content);
    state.player.rank = 'chunin';
    for (const skill of Object.keys(state.skills) as (keyof typeof state.skills)[]) {
      state.skills[skill].xp = xpAt(content.balance.K.cap);
    }
    refreshUnlocks(state, content, true);
    for (const t of content.techniques) {
      expect(Boolean(state.known[t.id])).toBe(t.src === 'N');
    }
  });

  it('a technique learned while practising becomes startable', () => {
    const state = createState(1, content);
    state.player.rank = 'genin';
    state.skills.tai.xp = xpAt(10) - 1;
    expect(
      dispatch(
        state,
        { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' },
        content,
      ).ok,
    ).toBe(true);
    advance(state, 120_000, content);
    expect(state.known['core:dynamic_entry']).toBe(true);
  });
});
