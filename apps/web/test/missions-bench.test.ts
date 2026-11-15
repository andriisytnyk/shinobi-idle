// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { able } from './helpers/missions.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

describe('the mission board costs little on every store update', () => {
  /** Best time of 200 store updates (100 ms of game time each) with this page open. */
  async function time(hash: string): Promise<number> {
    booted = await bootApp([coreUi], able(), hash);
    game.dispatch({ type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' });
    flushSync();
    let best = Infinity;
    for (let rep = 0; rep < 2; rep++) {
      const start = performance.now();
      for (let i = 0; i < 200; i++) booted.advance(100);
      best = Math.min(best, performance.now() - start);
    }
    booted.destroy();
    booted = null;
    return best;
  }

  it(
    'adds at most 30% to 200 store updates compared with the skills page',
    { timeout: 240_000, retry: 2 },
    async () => {
      await time('#/skills');
      let skills = Infinity;
      let board = Infinity;
      for (let round = 0; round < 5; round++) {
        // The order alternates so that whatever a run leaves behind favours neither page.
        for (const hash of round % 2 === 0
          ? ['#/skills', '#/missions']
          : ['#/missions', '#/skills']) {
          const ms = await time(hash);
          if (hash === '#/skills') skills = Math.min(skills, ms);
          else board = Math.min(board, ms);
        }
      }
      console.info(
        `mission board: ${skills.toFixed(1)} ms on the skills page, ${board.toFixed(1)} ms on the board`,
      );
      expect(board).toBeLessThanOrEqual(skills * 1.3);
    },
  );
});
