import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  canBeGoal,
  GOAL_CAP,
  goalKinds,
  isStoryGoal,
  createState,
  deserialize,
  dispatch,
  emit,
  EVENT_CAP,
  evalReq,
  type Command,
  isSkillUnlocked,
  serialize,
  type GameState,
} from '../src/index.ts';
import { setLevel, start } from './helpers.ts';

const CLONE = 'core:shadow_clone';
const DUMMY = 'core:dummy';

/** The techniques a fresh game lets the player pin, in content order. */
function pinnable(state: GameState, n: number): { kind: 'technique'; id: string }[] {
  const out: { kind: 'technique'; id: string }[] = [];
  for (const t of content.techniques) {
    const ref = { kind: 'technique', id: t.id } as const;
    const probe = createState(1, content);
    probe.quests = state.quests;
    if (dispatch(probe, { type: 'goal.pin', ref }, content).ok) out.push(ref);
    if (out.length === n) break;
  }
  return out;
}

describe('goal commands', () => {
  it('goal.pin pins a goal and goal.unpin removes it', () => {
    const state = createState(1, content);
    expect(state.goals).toEqual([]);
    const ref = { kind: 'technique', id: CLONE } as const;
    expect(dispatch(state, { type: 'goal.pin', ref }, content)).toEqual({ ok: true });
    expect(state.goals).toEqual([ref]);
    expect(state.events.some((e) => e.type === 'goalSet')).toBe(true);
    expect(dispatch(state, { type: 'goal.unpin', ref }, content)).toEqual({ ok: true });
    expect(state.goals).toEqual([]);
  });

  it('keeps several goals in pin order; pinning one twice changes nothing; unpin takes one out', () => {
    const state = createState(1, content);
    const [a, b, c] = pinnable(state, 3);
    if (!a || !b || !c) throw new Error('too few pinnable techniques');
    for (const ref of [a, b, a, c]) dispatch(state, { type: 'goal.pin', ref }, content);
    expect(state.goals).toEqual([a, b, c]);
    dispatch(state, { type: 'goal.unpin', ref: b }, content);
    expect(state.goals).toEqual([a, c]);
  });

  it('refuses a pin over the cap with a reason that names the cap, and drops nobody', () => {
    const state = createState(1, content);
    const refs = pinnable(state, GOAL_CAP + 1);
    expect(refs.length).toBe(GOAL_CAP + 1);
    for (const ref of refs.slice(0, GOAL_CAP)) {
      expect(dispatch(state, { type: 'goal.pin', ref }, content).ok).toBe(true);
    }
    const over = dispatch(state, { type: 'goal.pin', ref: refs[GOAL_CAP] as never }, content);
    expect(over).toEqual({ ok: false, reason: 'error.goalCap', params: { n: GOAL_CAP } });
    expect(state.goals).toEqual(refs.slice(0, GOAL_CAP));
    // One unpinned: the pin works again.
    dispatch(state, { type: 'goal.unpin', ref: refs[0] as never }, content);
    expect(dispatch(state, { type: 'goal.pin', ref: refs[GOAL_CAP] as never }, content).ok).toBe(
      true,
    );
  });

  it('a chain of the main story is always a goal of its own: pinning it changes nothing', () => {
    const main = content.quests.filter((q) => q.main === true);
    expect(main.length).toBeGreaterThan(0);
    expect(main[0]?.id).toBe('core:graduation');
    const state = createState(1, content);
    state.quests[main[0]?.id ?? ''] = { step: 0, base: 0, done: false };
    const ref = { kind: 'quest', id: main[0]?.id ?? '' } as const;
    expect(isStoryGoal(ref, content)).toBe(true);
    expect(dispatch(state, { type: 'goal.pin', ref }, content)).toEqual({ ok: true });
    expect(state.goals).toEqual([]);
    const side = content.quests.find((q) => q.main !== true);
    expect(isStoryGoal({ kind: 'quest', id: side?.id ?? '' }, content)).toBe(false);
  });

  it('goal.pin refuses an unknown entity or a kind that cannot be a goal, changing nothing', () => {
    const state = createState(1, content);
    for (const ref of [
      { kind: 'technique', id: 'core:nope' },
      { kind: 'region', id: 'core:forest' },
      { kind: 'skill', id: 'zzz' },
    ] as const) {
      expect(dispatch(state, { type: 'goal.pin', ref }, content)).toEqual({
        ok: false,
        reason: 'error.invalidGoal',
      });
    }
    expect(state.goals).toEqual([]);
  });

  it('goal.pin accepts the entities a tile stands for: recipe, exercise, practice, obstacle', () => {
    const state = createState(1, content);
    const refs = [
      { kind: 'recipe', id: content.recipes[0]?.id ?? '' },
      { kind: 'exercise', id: content.exercises[0]?.id ?? '' },
      { kind: 'practice', id: content.practices[0]?.id ?? '' },
      { kind: 'obstacle', id: content.obstacles[0]?.id ?? '' },
    ] as const;
    for (const ref of refs) {
      expect(dispatch(state, { type: 'goal.pin', ref }, content)).toEqual({ ok: true });
    }
    expect(state.goals).toEqual(refs);
  });

  it('goalKinds lists the kinds of the content that can be pinned, quest among them', () => {
    const kinds = goalKinds(content);
    expect(kinds).toContain('quest');
    expect(kinds).toContain('technique');
    expect(kinds).not.toContain('region');
    for (const kind of kinds) expect(canBeGoal(kind, content)).toBe(true);
    expect(canBeGoal('region', content)).toBe(false);
  });

  it('pins a quest chain and keeps it through a save and load', () => {
    const state = createState(1, content);
    const quest = content.quests.find((q) => q.main !== true)?.id ?? '';
    state.quests[quest] = { step: 0, base: 0, done: false };
    expect(
      dispatch(state, { type: 'goal.pin', ref: { kind: 'quest', id: quest } }, content),
    ).toEqual({ ok: true });
    const loaded = deserialize(serialize(state, 5), content);
    expect(loaded.goals).toEqual([{ kind: 'quest', id: quest }]);
  });

  it('keeps the pinned goals, in order, through a save and load', () => {
    const state = createState(1, content);
    const [a, b] = pinnable(state, 2);
    if (!a || !b) throw new Error('too few pinnable techniques');
    dispatch(state, { type: 'goal.pin', ref: b }, content);
    dispatch(state, { type: 'goal.pin', ref: a }, content);
    const loaded = deserialize(serialize(state, 5), content);
    expect(loaded.goals).toEqual([b, a]);
  });

  it('a save made with one pinned goal (version 21) loads as a list of one', () => {
    const state = createState(1, content);
    const parsed = JSON.parse(serialize(state, 5)) as { v: number; state: Record<string, unknown> };
    const { goals: _goals, ...rest } = parsed.state;
    const old = {
      v: 21,
      savedAt: 5,
      state: { ...rest, goal: { kind: 'technique', id: CLONE } },
    };
    expect(deserialize(JSON.stringify(old), content).goals).toEqual([
      { kind: 'technique', id: CLONE },
    ]);
    const none = { ...old, state: { ...rest, goal: null } };
    expect(deserialize(JSON.stringify(none), content).goals).toEqual([]);
  });

  it('a tampered list is cut to well-formed, distinct entries within the cap', () => {
    const state = createState(1, content);
    const parsed = JSON.parse(serialize(state, 5)) as { v: number; state: Record<string, unknown> };
    const refs = pinnable(state, GOAL_CAP + 2);
    parsed.state.goals = [refs[0], refs[0], 7, { kind: 1 }, ...refs.slice(1)];
    const loaded = deserialize(JSON.stringify(parsed), content);
    expect(loaded.goals).toEqual(refs.slice(0, GOAL_CAP));
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
    expect(dispatch(state, start('practice', tech.id), content)).toEqual({
      ok: false,
      reason: 'error.skillLocked',
    });
    expect(dispatch(state, { type: 'nature.choose', nature: 'katon' }, content).ok).toBe(true);
    expect(dispatch(state, start('practice', tech.id), content).ok).toBe(true);
  });
});

describe('the first fight', () => {
  it('sets the flag that opens Vitality', () => {
    const state = createState(1, content);
    expect(state.flags.firstFight).toBeUndefined();
    expect(isSkillUnlocked(state, 'vit', content)).toBe(false);
    expect(dispatch(state, start('fight', DUMMY), content).ok).toBe(true);
    expect(state.flags.firstFight).toBe(true);
    expect(isSkillUnlocked(state, 'vit', content)).toBe(true);
    expect(evalReq(state, { t: 'flag', id: 'firstFight' }, content).met).toBe(true);
  });
});

describe('event queue eviction and input checks', () => {
  it('drops battle log lines before any other event when the queue is full', () => {
    const state = createState(1, content);
    emit(state, { type: 'rankUp', rank: 'genin' });
    for (let i = 0; i < EVENT_CAP + 50; i++) {
      emit(state, {
        type: 'combatLog',
        side: 'enemy',
        act: 'miss',
        tech: null,
        enemy: DUMMY,
        dmg: 0,
      });
    }
    expect(state.events).toHaveLength(EVENT_CAP);
    expect(state.events.some((e) => e.type === 'rankUp')).toBe(true);
  });

  it('refuses a malformed goal and a name with control characters', () => {
    const state = createState(1, content);
    const bad = { type: 'goal.pin', ref: null } as unknown as Command;
    expect(dispatch(state, bad, content)).toEqual({ ok: false, reason: 'error.invalidGoal' });
    expect(dispatch(state, { type: 'player.setName', name: 'a\nb' }, content).ok).toBe(false);
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
