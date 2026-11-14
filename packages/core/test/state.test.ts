import { content, SKILL_IDS } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { createState } from '../src/index.ts';

describe('createState', () => {
  const state = createState(123, content);

  it('puts all 16 skills at 0 xp and creates one action slot', () => {
    expect(Object.keys(state.skills).sort()).toEqual([...SKILL_IDS].sort());
    expect(SKILL_IDS.length).toBe(16);
    for (const id of SKILL_IDS) expect(state.skills[id]).toEqual({ xp: 0 });
    expect(state.slots).toEqual([{ action: null, progress: 0, share: 1 }]);
  });

  it('starts with an empty event queue and no completed cycles', () => {
    expect(state.events).toEqual([]);
    expect(state.stats).toEqual({ completed: 0 });
  });

  it('survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('is deterministic for a seed', () => {
    expect(createState(123, content)).toEqual(state);
    expect(createState(124, content)).not.toEqual(state);
  });
});
