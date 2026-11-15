/** T2: a game with the test pack is deterministic and gives the same state however its time is split; offline equals online. */
import { describe, expect, it } from 'vitest';
import {
  advance,
  advanceOffline,
  deserialize,
  dispatch,
  serialize,
  type GameState,
} from '../src/index.ts';
import { TOKEN } from '../src/testmod/index.ts';
import { HOUR, modContent, modGenin, modRules, setSkill } from './packs-helpers.ts';

const start = (kind: string, id: string, slot = 0) =>
  ({ type: 'action.start', slot, kind, id }) as const;

/** A game that uses the pack: the nature chosen, the forge brewing in one slot and the core drill in another. */
function busy(): GameState {
  const state = modGenin(5);
  state.bank['testmod:pellet'] = 100_000;
  setSkill(state, 'tai', 12);
  const exercise = modContent.exercises[0];
  if (!exercise) throw new Error('an exercise');
  dispatch(state, { type: 'nature.choose', nature: 'testmod:aether' }, modContent, modRules);
  state.slots.push({ action: null, progress: 0, share: 0, data: null });
  expect(dispatch(state, start('craft', 'testmod:elixir_brew', 0), modContent, modRules).ok).toBe(
    true,
  );
  expect(dispatch(state, start('drill', exercise.id, 1), modContent, modRules).ok).toBe(true);
  return state;
}

const run = (state: GameState, chunks: number[], total: number): GameState => {
  let left = total;
  for (let i = 0; left > 0; i++) {
    const chunk = Math.min(left, chunks[i % chunks.length] ?? left);
    advance(state, chunk, modContent, modRules);
    left -= chunk;
  }
  return state;
};

describe('a game with the test pack', () => {
  const reference = serialize(run(busy(), [2 * HOUR], 2 * HOUR));

  it('plays the pack for real over the two hours', () => {
    const state = run(busy(), [2 * HOUR], 2 * HOUR);
    // Twelve payments of the system and the three tokens of the quest of the pack that the forge level finished.
    expect(state.currencies[TOKEN]).toBe(15);
    expect(state.skills['testmod:forge']?.xp).toBeGreaterThan(0);
    expect(state.stats.completed).toBeGreaterThan(100);
  });

  // Seven milliseconds over two hours would be a million calls: the chunks of the small sizes cover
  // 700 000 ms (one token payment and some thousands of cycles), the same for every size.
  const SHORT = 700_000;
  const shortReference = serialize(run(busy(), [SHORT], SHORT));
  for (const chunk of [7, 999, 3600, 60_000]) {
    it(`gives the same state in chunks of ${chunk} ms`, () => {
      expect(serialize(run(busy(), [chunk], SHORT))).toBe(shortReference);
    });
  }

  it('gives the same state in chunks of 3600 ms over the two hours', () => {
    expect(serialize(run(busy(), [3600], 2 * HOUR))).toBe(reference);
  });

  it('gives the same state in one jump, and with chunks of random sizes', () => {
    const jumped = busy();
    advance(jumped, 2 * HOUR, modContent, modRules);
    expect(serialize(jumped)).toBe(reference);
    const sizes = [1, 59_999, 600_000, 3, 1_234_567, 17];
    expect(serialize(run(busy(), sizes, 2 * HOUR))).toBe(reference);
  });

  it('is the same game after a save and a load in the middle', () => {
    const state = run(busy(), [HOUR], HOUR);
    const loaded = deserialize(serialize(state), modContent, modRules);
    expect(serialize(loaded)).toBe(serialize(state));
    advance(state, HOUR, modContent, modRules);
    advance(loaded, HOUR, modContent, modRules);
    expect(serialize(loaded)).toBe(serialize(state));
    expect(serialize(loaded)).toBe(reference);
  });

  it('gives the same state when two saves are played from the same seed', () => {
    expect(serialize(run(busy(), [2 * HOUR], 2 * HOUR))).toBe(reference);
  });

  it('plays the same offline as online', () => {
    const online = busy();
    advance(online, 2 * HOUR, modContent, modRules);
    const offline = busy();
    advanceOffline(offline, 2 * HOUR, modContent, modRules);
    expect(serialize(offline)).toBe(serialize(online));
    expect(offline.currencies[TOKEN]).toBe(15);
  });
});
