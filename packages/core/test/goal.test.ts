import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  deserialize,
  dispatch,
  evalReq,
  isSkillUnlocked,
  serialize,
  type GameState,
} from '../src/index.ts';
import { setLevel, start } from './helpers.ts';

const CLONE = 'core:shadow_clone';
const DUMMY = 'core:dummy';

describe('goal commands', () => {
  it('goal.set pins a goal and goal.clear removes it', () => {
    const state = createState(1, content);
    expect(state.goal).toBeNull();
    const set = dispatch(
      state,
      { type: 'goal.set', ref: { kind: 'technique', id: CLONE } },
      content,
    );
    expect(set).toEqual({ ok: true });
    expect(state.goal).toEqual({ kind: 'technique', id: CLONE });
    expect(state.events.some((e) => e.type === 'goalSet')).toBe(true);
    expect(dispatch(state, { type: 'goal.clear' }, content)).toEqual({ ok: true });
    expect(state.goal).toBeNull();
  });

  it('goal.set refuses an unknown entity or a kind that cannot be a goal, changing nothing', () => {
    const state = createState(1, content);
    for (const ref of [
      { kind: 'technique', id: 'core:nope' },
      { kind: 'region', id: 'core:forest' },
      { kind: 'skill', id: 'zzz' },
    ] as const) {
      expect(dispatch(state, { type: 'goal.set', ref }, content)).toEqual({
        ok: false,
        reason: 'error.invalidGoal',
      });
    }
    expect(state.goal).toBeNull();
  });

  it('keeps the pinned goal through a save and load', () => {
    const state = createState(1, content);
    dispatch(state, { type: 'goal.set', ref: { kind: 'technique', id: CLONE } }, content);
    const loaded = deserialize(serialize(state, 5), content);
    expect(loaded.goal).toEqual({ kind: 'technique', id: CLONE });
  });
});

describe('player.setName', () => {
  it('stores a trimmed name and refuses an empty or overlong one', () => {
    const state = createState(1, content);
    expect(dispatch(state, { type: 'player.setName', name: '  Рен ' }, content).ok).toBe(true);
    expect(state.player.name).toBe('Рен');
    for (const name of ['', '   ', 'x'.repeat(25)]) {
      expect(dispatch(state, { type: 'player.setName', name }, content)).toEqual({
        ok: false,
        reason: 'error.invalidName',
      });
    }
    expect(state.player.name).toBe('Рен');
  });
});

describe('locked skills', () => {
  it('refuses an action of a locked skill with a reason and starts nothing', () => {
    const state: GameState = createState(1, content);
    setLevel(state, 'katon', 5);
    const tech = content.techniques.find((t) => t.skill === 'katon');
    if (!tech) throw new Error('no katon technique');
    state.known[tech.id] = true;
    expect(isSkillUnlocked(state, 'katon', content)).toBe(false);
    const result = dispatch(state, start('practice', tech.id), content);
    expect(result).toEqual({ ok: false, reason: 'error.skillLocked' });
    expect(state.slots[0]?.action).toBeNull();
    state.player.rank = 'genin';
    expect(dispatch(state, start('practice', tech.id), content).ok).toBe(true);
  });
});

describe('the first fight', () => {
  it('sets the flag that opens Vitality and Evasion', () => {
    const state = createState(1, content);
    expect(state.flags.firstFight).toBeUndefined();
    expect(isSkillUnlocked(state, 'vit', content)).toBe(false);
    expect(isSkillUnlocked(state, 'eva', content)).toBe(false);
    expect(dispatch(state, start('fight', DUMMY), content).ok).toBe(true);
    expect(state.flags.firstFight).toBe(true);
    expect(isSkillUnlocked(state, 'vit', content)).toBe(true);
    expect(isSkillUnlocked(state, 'eva', content)).toBe(true);
    expect(evalReq(state, { t: 'flag', id: 'firstFight' }, content).met).toBe(true);
  });
});

describe('battle log events', () => {
  it('describe each side acting without changing the fight', () => {
    const run = (): GameState => {
      const state = createState(7, content);
      dispatch(state, start('fight', DUMMY), content);
      advance(state, 20_000, content);
      return state;
    };
    const state = run();
    const log = state.events.filter((e) => e.type === 'combatLog');
    expect(log.length).toBeGreaterThan(0);
    expect(log.some((e) => e.side === 'player' && e.act === 'cast' && e.tech !== null)).toBe(true);
    expect(log.some((e) => e.side === 'enemy')).toBe(true);
    // The same seed and commands give the same fight with or without anyone reading the log.
    const other = run();
    other.events = [];
    state.events = [];
    expect(serialize(other)).toBe(serialize(state));
  });
});
