/**
 * Real version 17 saves, recorded by dev code (`origin/dev` at e575b30, the hex map): a script run from a
 * throwaway worktree of that commit (`createState`, `dispatch`, `advance`, `serialize`) wrote
 * `fixtures/save-v17-real.json`, with what the dev state said at the moment of saving next to each save
 * (`dev`). The cases: a walk after a survey, a clone walking while the character drills, and the auto-survey
 * after 40 minutes. The points of interest (X3) added optional branches to the world and no migration; these
 * saves must load as they were, with the one thing the new game knows from the start (the point of the gate
 * the character leaves by), and play on.
 */
import { readFileSync } from 'node:fs';
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { advance, deserialize, serialize, STATE_VERSION, type GameState } from '../src/index.ts';

interface Dev {
  v: number;
  now: number;
  location: string;
  figures: Record<string, string> | null;
  surveyed: number;
  explores: Record<string, number>;
  pois: string[];
  actions: ({ kind: string; id: string } | null)[];
  ryo: number;
  intel: number;
  scout: number;
  ath: number;
}

const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/save-v17-real.json', import.meta.url), 'utf8'),
) as Record<string, { save: string; dev: Dev }>;

const load = (name: string): { state: GameState; dev: Dev; save: string } => {
  const rec = recorded[name];
  if (!rec) throw new Error(`no record ${name}`);
  expect((JSON.parse(rec.save) as { v: number }).v).toBe(17);
  return { state: deserialize(rec.save, content), dev: rec.dev, save: rec.save };
};

describe('saves of version 17 recorded on dev', () => {
  for (const name of ['walker', 'clone', 'surveyor']) {
    it(`${name}: loads as dev saved it, and knows only the gate of the start besides`, () => {
      const { state, dev } = load(name);
      expect(state.v).toBe(STATE_VERSION);
      expect(STATE_VERSION).toBeGreaterThanOrEqual(17);
      expect(state.now).toBe(dev.now);
      expect(state.world.location).toBe(dev.location);
      expect(state.world.figures ?? null).toEqual(dev.figures);
      expect(Object.keys(state.world.surveyed)).toHaveLength(dev.surveyed);
      expect(state.world.explores).toEqual(dev.explores);
      expect(state.slots.map((s) => s.action)).toEqual(dev.actions);
      expect(Object.keys(state.world.pois).sort()).toEqual(
        [...dev.pois, 'core:west_gate_post'].sort(),
      );
      expect(state.world.stock).toBeUndefined();
      expect(state.currencies.ryo).toBe(dev.ryo);
      expect(state.currencies.intel).toBe(dev.intel);
    });

    it(`${name}: plays on the same however the time is cut`, () => {
      const total = 40 * 60_000;
      const whole = load(name).state;
      advance(whole, total, content);
      const parts = load(name).state;
      for (let done = 0; done < total; done += 4321)
        advance(parts, Math.min(4321, total - done), content);
      expect(serialize(parts)).toBe(serialize(whole));
      expect(JSON.parse(serialize(whole)).state.v).toBe(STATE_VERSION);
    });
  }

  it('walker: the walk goes on to its end and pays walking XP from there', () => {
    const { state, dev } = load('walker');
    advance(state, 30 * 60_000, content);
    expect(state.world.location).toBe('core:uzlissia');
    expect(state.slots[0]?.action).toBeNull();
    expect(state.skills.ath?.xp).toBeGreaterThan(dev.ath);
    expect(state.skills.scout?.xp).toBeGreaterThan(dev.scout);
  });

  it('clone: the clone that was walking arrives and stands there', () => {
    const { state } = load('clone');
    advance(state, 30 * 60_000, content);
    expect(state.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
    expect(state.world.figures?.[1]).toBe('core:rysovi_polia');
    expect(state.world.location).toBe('core:okolytsi_sela');
    // And the save keeps it so.
    const again = deserialize(serialize(state), content);
    expect(again.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
    expect(again.world.figures?.[1]).toBe('core:rysovi_polia');
  });
});
