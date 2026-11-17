// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, xpAt, type GameState } from '@shinobi/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const WOLF = 'core:wolf';
const WOLF_NAME = ukLocale['enemy.core:wolf.name'] ?? 'Вовк';

/** A genin who knows his fire techniques, with the forest open, and a Bingo entry of the given level for the wolf. */
function withKnowledge(level: 0 | 1 | 2 | 3, explored = true): GameState {
  const state = createState(11, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(14);
  }
  for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  if (explored) {
    for (const cell of content.cells) state.world.explores[cell.id] = 9999;
    state.flags['region.forest.unlocked'] = true;
  }
  if (level >= 1)
    state.bingo[WOLF] = { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
  if (level >= 2)
    state.bingo[WOLF] = { seen: 1, wins: 1, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
  if (level >= 3)
    state.bingo[WOLF] = { seen: 9, wins: 99, losses: 0, timeouts: 0, bought: 3, bounty: 0 };
  return state;
}

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

const PREPARE = '#/combat/prepare/zone/core:zone_wolf';

/** Opens the preparation for the wolf pack and waits for the forecast to end, when there is one. */
async function open(level: 0 | 1 | 2 | 3, explored = true): Promise<HTMLElement> {
  booted = await bootApp([coreUi], withKnowledge(level, explored), PREPARE);
  const verdict = q('[data-ui="prep-verdict"]');
  expect(verdict).not.toBeNull();
  if (level > 0) {
    await vi.waitFor(
      () => expect(q('[data-ui="prep-verdict"]')?.getAttribute('data-forecast')).toBe('done'),
      {
        timeout: 30_000,
        interval: 50,
      },
    );
  }
  return q('[data-ui="prep-verdict"]')!;
}

describe('F1-fix1: the forecast of the preparation screen with the game clock running', () => {
  it('finishes while ticks keep coming in, and the bank of other things does not restart it', async () => {
    booted = await bootApp([coreUi], withKnowledge(2), PREPARE);
    const app = booted;
    let ticks = 0;
    const clock = setInterval(() => {
      ticks++;
      // The player gathers meanwhile: the bank grows with every tick.
      game.state.bank['core:test_gather'] = ticks;
      app.advance(1000);
    }, 20);
    try {
      await vi.waitFor(
        () => expect(q('[data-ui="prep-verdict"]')?.getAttribute('data-forecast')).toBe('done'),
        { timeout: 30_000, interval: 50 },
      );
    } finally {
      clearInterval(clock);
    }
    expect(ticks).toBeGreaterThan(10);
  }, 60_000);
});

describe('F1: the preparation screen and its verdict follow the Bingo level', () => {
  it('knows nothing of an unknown enemy: no verdict, no forecast, a hint how to learn more', async () => {
    const verdict = await open(0, false);
    expect(verdict.textContent).toContain('Невідомий ворог: прогнозу немає');
    expect(verdict.textContent).toContain('Бінґо-книзі');
    expect(verdict.getAttribute('data-forecast')).toBe('idle');
    expect(verdict.getAttribute('data-verdict')).toBeNull();
    expect(q('progress')).toBeNull();
    // The reveal rule: the name of an enemy the player has not discovered is not on the screen.
    expect(booted?.target.textContent).not.toContain(WOLF_NAME);
    expect(q('[data-prep] h2')?.textContent).toContain('???');
    expect(booted?.target.innerHTML).not.toContain(WOLF);
  });

  it('level 1 gives the verdict and nothing about why', async () => {
    const verdict = await open(1);
    expect(['stable', 'risky', 'hopeless']).toContain(verdict.getAttribute('data-verdict'));
    expect(
      ['надійно', 'ризиковано', 'безнадійно'].some((w) => verdict.textContent?.includes(w)),
    ).toBe(true);
    expect(verdict.querySelectorAll('[data-reason]')).toHaveLength(0);
    expect(verdict.textContent).toContain('Причини відкриються');
    expect(verdict.textContent).not.toContain('%');
  });

  it.each([2, 3] as const)('level %i gives the verdict and the reasons', async (level) => {
    const verdict = await open(level);
    expect(verdict.getAttribute('data-verdict')).not.toBeNull();
    const reasons = [...verdict.querySelectorAll('[data-reason]')];
    expect(reasons.length).toBeGreaterThan(0);
    expect(verdict.textContent).toContain('Чому так');
    expect(verdict.textContent).not.toContain('%');
    // A trait the hand does not answer, the nature of the enemy and the Wounds are the reasons it can name.
    const kinds = new Set(reasons.map((r) => r.getAttribute('data-reason')));
    expect(
      [...kinds].every((k) =>
        ['trait', 'allAnswered', 'hiddenTraits', 'nature', 'supply', 'wounds', 'blocked'].includes(
          k ?? '',
        ),
      ),
    ).toBe(true);
  });

  it('shows no percentage or comparison of hands anywhere on the screen', async () => {
    await open(2);
    const text = q('[data-prep]')?.textContent ?? '';
    expect(text).not.toContain('%');
    expect(qa('[data-sim]')).toHaveLength(0);
  });

  it('puts the hand, the defence with its parts and the suggestion button on the screen', async () => {
    await open(2);
    expect(q('[data-ui="prep-hand"]')).not.toBeNull();
    const defence = q('[data-ui="prep-defence"]');
    expect(defence).not.toBeNull();
    // Every defensive technique the player knows has a row with its own effective level against the enemy's.
    const techniques = qa('[data-ui="prep-defence"] [data-part="technique"]');
    expect(techniques.length).toBeGreaterThan(0);
    expect(techniques[0]?.textContent).toContain('діє на рівні');
    expect(techniques[0]?.textContent).toContain('проти рівня ворога');
    expect(qa('button').some((b) => b.textContent?.includes('Запропонувати набір'))).toBe(true);
  });

  it('the suggestion fills the hand and does not rank it', async () => {
    await open(2);
    const before = [...game.state.loadouts.active];
    const button = qa('button').find((b) => b.textContent?.includes('Запропонувати набір'));
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = game.state.loadouts.active;
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toEqual(before.length === 0 ? ['x'] : []);
    expect(q('[data-prep]')?.textContent).not.toMatch(/\d\s*%/);
  });
});
