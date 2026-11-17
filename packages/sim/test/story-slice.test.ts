/**
 * The story of the slice, played end to end by a script through `dispatch` and `advance`: from a
 * fresh save through the Academy, every quest chain, the operations and the Chunin exam, to the vest.
 * Skills are taken to the levels the documents' pace gives (see `PACE` in `src/story.ts`); everything
 * else is played. The fights this character found hard are listed in the last test.
 */
import { content } from '@shinobi/content';
import {
  createState,
  defaultRules,
  deserialize,
  dispatch,
  killsKey,
  serialize,
  type GameState,
} from '@shinobi/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { playSlice, type StoryRun } from '../src/story.ts';

/** The chains the script plays, in the order the story finishes them. The other chains of the content are the business of their own tasks. */
const MAIN = [
  'core:graduation',
  'core:mission_board',
  'core:border_wolves',
  'core:grey_bands',
  'core:name_on_stone',
] as const;
const SIDE = ['core:eternal_rivalry', 'core:outskirts', 'core:rival'] as const;

describe('the whole slice, from a fresh save to the Chunin vest', () => {
  let run: StoryRun;
  beforeAll(() => {
    run = playSlice({ seed: 1 });
  }, 600_000);

  it('finishes the main chains one after another', () => {
    const order = MAIN.map((id) => run.chainOrder.indexOf(id));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('finishes the chains that run beside them', () => {
    for (const id of SIDE) expect(run.state.quests[id]?.done, id).toBe(true);
  });

  it('has every step of every played chain behind it', () => {
    for (const id of [...MAIN, ...SIDE]) {
      const quest = content.quests.find((q) => q.id === id);
      expect(run.state.quests[id], id).toEqual({ step: quest?.steps.length, base: 0, done: true });
    }
  });

  it('opens what the chains promise', () => {
    for (const flag of [
      'missions.c.unlocked',
      'region.exam.unlocked',
      'op.hideout.unlocked',
      'op.forest_of_death.unlocked',
      'op.tournament.unlocked',
      'boss.wolf.unlocked',
      'boss.ren1.unlocked',
      'boss.fighter.unlocked',
      'boss.hunter.unlocked',
      'boss.nameless.unlocked',
    ]) {
      expect(run.state.flags[flag], flag).toBeDefined();
    }
  });

  it('passes both operations of the exam and the hideout', () => {
    for (const op of ['core:op_hideout', 'core:op_forest_of_death', 'core:op_tournament']) {
      const clear = content.operations.find((o) => o.id === op)?.clearFlag ?? '';
      expect(run.state.flags[clear], op).toBeDefined();
    }
  });

  it('beats every boss of the slice at least once', () => {
    for (const boss of content.bosses) {
      expect(run.state.counters[killsKey(boss.id)] ?? 0, boss.id).toBeGreaterThan(0);
    }
  });

  it('reaches the Chunin rank through the exam, with the vest', () => {
    expect(run.state.player.rank).toBe('chunin');
    expect(run.state.bank['core:chunin_vest']).toBe(1);
    expect(run.log.some((line) => line.includes('rank: chunin'))).toBe(true);
    // The written test came before the rank.
    expect(run.state.flags['exam.core:chunin_exam.written']).toBe(true);
  });

  it('takes a believable time: the Chunin in under twenty game hours', () => {
    expect(run.state.now).toBeLessThan(20 * 3_600_000);
  });

  it('leaves a state a save can hold', () => {
    const back = deserialize(serialize(run.state, 1), content);
    expect(back.player.rank).toBe('chunin');
    expect(Object.keys(back.quests).sort()).toEqual(Object.keys(run.state.quests).sort());
  });

  it('names the fights that were hard for the scripted character', () => {
    // Not a balance check: the script raised the levels it needed, and what it still lost is listed here for the balance task.
    const hard = Object.entries(run.lost).filter(([, n]) => n > 0);
    console.log(`fights lost on the way: ${JSON.stringify(Object.fromEntries(hard))}`);
    for (const [enemy] of hard) {
      expect(
        content.bosses.some((b) => b.id === enemy) || content.enemies.some((e) => e.id === enemy),
      ).toBe(true);
    }
  });
});

describe('the Chunin exam refuses', () => {
  const genin = (): GameState => {
    const state = createState(3, content);
    state.player.rank = 'genin';
    return state;
  };

  it('to start before the checklist is met', () => {
    const state = genin();
    const result = dispatch(state, { type: 'exam.start', rank: 'chunin' }, content, defaultRules);
    expect(result.ok).toBe(false);
    expect(state.slots[0]?.action).toBeNull();
  });
});
