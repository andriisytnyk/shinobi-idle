import { content, SKILL_IDS } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, createState, dispatch } from '../src/index.ts';

describe('createState', () => {
  const state = createState(123, content);

  it('puts all 16 skills at 0 xp and creates one action slot', () => {
    expect(Object.keys(state.skills).sort()).toEqual([...SKILL_IDS].sort());
    expect(SKILL_IDS.length).toBe(16);
    for (const id of SKILL_IDS) expect(state.skills[id]).toEqual({ xp: 0 });
    expect(state.slots).toEqual([{ action: null, progress: 0, share: 1 }]);
  });

  it('survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('is deterministic for a seed', () => {
    expect(createState(123, content)).toEqual(state);
    expect(createState(124, content)).not.toEqual(state);
  });
});

describe('engine stubs', () => {
  it('advance moves only the clock', () => {
    const state = createState(1, content);
    const before = JSON.parse(JSON.stringify(state));
    advance(state, 1500, content);
    expect(state.now).toBe(1500);
    expect({ ...state, now: 0 }).toEqual(before);
  });

  it('advance rejects fractional or negative time', () => {
    const state = createState(1, content);
    expect(() => advance(state, -1, content)).toThrow(RangeError);
    expect(() => advance(state, 0.5, content)).toThrow(RangeError);
  });

  it('dispatch rejects every command as unknown', () => {
    const state = createState(1, content);
    expect(dispatch(state, { type: 'action.start' }, content)).toEqual({
      ok: false,
      reason: 'error.unknownCommand',
    });
  });
});
