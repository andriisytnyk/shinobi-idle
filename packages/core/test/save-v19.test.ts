/**
 * Save version 19: raids on the village. A village gets an empty list of raids and no damaged building.
 * `fixtures/save-v18-real.json` holds real version 18 saves recorded by dev code (`origin/dev` at ed32aaa, before
 * the change): the story script of the sim played a Genin with a seed of 1 and `serialize` was called at five
 * moments of the «Околиці» chain (a fresh village, the second step, the step that was the stand-in for the raid, with
 * four of its ten mercenaries down, and the chain finished), with what dev said at the moment of saving next to
 * each save (`dev`).
 */
import { readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  deserialize,
  dispatch,
  raidFlag,
  serialize,
  STATE_VERSION,
  villageRaids,
  type GameState,
} from '../src/index.ts';

interface Dev {
  v: number;
  now: number;
  rank: string;
  levels: Record<string, number>;
  outskirts: { step: number; done: boolean } | null;
  mercKills: number;
  ryo: number;
}

const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/save-v18-real.json', import.meta.url), 'utf8'),
) as Record<string, { save: string; dev: Dev }>;
const raid = content.raids[0]!;
const TICK = content.balance.K.tickMin * 60_000;
const village = (s: GameState) => {
  if (!s.village) throw new Error('no village');
  return s.village;
};

describe('migration v18 -> v19 of real saves recorded on dev', () => {
  for (const [name, rec] of Object.entries(recorded)) {
    it(`${name}: loads as the current version with the village as it was and no raid damage`, () => {
      expect((JSON.parse(rec.save) as { v: number }).v).toBe(18);
      expect(STATE_VERSION).toBeGreaterThanOrEqual(19);
      const state = deserialize(rec.save, content);
      expect(state.v).toBe(STATE_VERSION);
      expect(state.now).toBe(rec.dev.now);
      expect(state.player.rank).toBe(rec.dev.rank);
      expect(village(state).levels).toEqual(rec.dev.levels);
      expect(village(state).damage).toEqual({});
      expect(village(state).treasury).toBe(rec.dev.ryo);
      expect(state.quests['core:outskirts']).toMatchObject({
        step: rec.dev.outskirts?.step,
        done: rec.dev.outskirts?.done,
      });
    });
  }

  it('a village that the story has not brought to the raid has none called', () => {
    for (const name of ['genin', 'step2']) {
      const state = deserialize(recorded[name]!.save, content);
      expect(village(state).raids, name).toEqual({});
    }
  });

  it('the chain finished before raids has its raid over, with nothing paid or damaged, and never gets one called', () => {
    const state = deserialize(recorded['outskirts-done']!.save, content);
    const before = { ...state.currencies };
    expect(village(state).raids).toEqual({
      [raid.id]: {
        phase: 'over',
        ticks: 0,
        repelled: 0,
        byVillage: 0,
        breached: 0,
        damaged: [],
        ryo: 0,
        rep: 0,
      },
    });
    expect(state.flags[raidFlag(raid.id, 'over')]).toBe(true);
    advance(state, 6 * 3_600_000, content);
    expect(village(state).raids[raid.id]?.phase).toBe('over');
    expect(state.events.filter((e) => e.type === 'raidCalled')).toEqual([]);
    expect(village(state).damage).toEqual({});
    expect(state.currencies.rep).toBe(before.rep);
    expect(state.quests['core:outskirts']?.done).toBe(true);
  });

  for (const name of ['step4', 'step4-fighting']) {
    it(`${name}: the step that was the stand-in is now the raid, called as the step is active`, () => {
      const state = deserialize(recorded[name]!.save, content);
      expect(state.quests['core:outskirts']?.step).toBe(3);
      expect(village(state).raids[raid.id]).toMatchObject({ phase: 'warned', ticks: raid.lead });
      // The mercenaries the old objective counted do not count for the raid.
      expect(state.flags[raidFlag(raid.id, 'over')]).toBeUndefined();
    });

    it(`${name}: plays through the raid to the end of the chain, the same however the time is cut`, () => {
      const total = (raid.lead + raid.hold + 2) * TICK;
      const play = (chunk: number): GameState => {
        const state = deserialize(recorded[name]!.save, content);
        for (let done = 0; done < total; done += chunk)
          advance(state, Math.min(chunk, total - done), content);
        return state;
      };
      const whole = play(total);
      // Nobody fights and the village has no defence: the raid waits at the gates for the player.
      expect(villageRaids(whole, content)[0]).toMatchObject({ phase: 'active', waiting: true });
      expect(serialize(play(TICK))).toBe(serialize(whole));
      expect(serialize(play(9_973))).toBe(serialize(whole));
      // The player comes: the packs fall, the raid ends, the step is done.
      const state = deserialize(recorded[name]!.save, content);
      advance(state, raid.lead * TICK, content);
      expect(
        dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: raid.id }, content),
      ).toEqual({
        ok: true,
      });
      for (let i = 0; i < 400 && villageRaids(state, content)[0]?.phase !== 'over'; i++)
        advance(state, 30_000, content);
      expect(villageRaids(state, content)[0]).toMatchObject({
        phase: 'over',
        repelled: raid.packs,
      });
      expect(state.quests['core:outskirts']?.step).toBeGreaterThanOrEqual(4);
    });
  }
});
