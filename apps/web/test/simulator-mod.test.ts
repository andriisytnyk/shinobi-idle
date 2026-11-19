// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { createState, xpAt, type GameState } from '@shinobi/core';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PACKS, enabledBuiltin } from '../src/lib/builtin-packs.ts';
import { simulatorUi } from '../src/lib/builtin/simulator-ui.ts';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { parseSettings, settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const WOLF = 'core:wolf';

/** A genin with the forest open and the wolf studied to the given level. */
function player(level: 0 | 1 | 2 | 3): GameState {
  const state = createState(11, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(14);
  }
  for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  for (const cell of content.cells) state.world.explores[cell.id] = 9999;
  state.flags['region.forest.unlocked'] = true;
  if (level >= 1) {
    state.bingo[WOLF] = {
      seen: 1,
      wins: level >= 2 ? 1 : 0,
      losses: 0,
      timeouts: 0,
      bought: level >= 3 ? 3 : 0,
      bounty: 0,
    };
  }
  // A hand of one technique, so the suggestion differs from it.
  state.loadouts.auto = false;
  state.loadouts.active = ['core:leaf_whirlwind'];
  return state;
}

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];
const PREPARE = '#/combat/prepare/zone/core:zone_wolf';

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
beforeEach(() => {
  localStorage.clear();
  for (const p of BUILTIN_PACKS) settings.setBuiltinPack(p.id, false);
});
afterEach(() => {
  booted?.destroy();
  booted = null;
});

describe('F1: the official mod «Симулятор бою»', () => {
  it('is a built-in UI pack, off by default, listed for the settings', () => {
    expect(parseSettings(null).builtinPacks).toEqual([]);
    expect(enabledBuiltin([])).toEqual([]);
    expect(enabledBuiltin(['simulator'])).toEqual([simulatorUi]);
    expect(enabledBuiltin(['nothing'])).toEqual([]);
    expect(BUILTIN_PACKS.map((p) => p.id)).toEqual(['simulator']);
    expect(simulatorUi.id).toBe('simulator');
  });

  it('adds nothing when it is not enabled', async () => {
    booted = await bootApp([coreUi], player(2), PREPARE);
    expect(q('[data-ui="prep-verdict"]')).not.toBeNull();
    expect(qa('[data-sim]')).toHaveLength(0);
    await booted.go('#/combat/bingo');
    expect(qa('[data-sim]')).toHaveLength(0);
  });

  it('adds the numbers of the first fight and the session, per hour, and the hand next to the suggestion', async () => {
    booted = await bootApp([coreUi, simulatorUi], player(2), PREPARE);
    const sim = () => q('[data-sim="prep"]');
    expect(sim()).not.toBeNull();
    // Two columns: the hand now and the suggestion; each is filled when its forecast ends.
    await vi.waitFor(
      () => {
        const cells = qa('[data-sim="prep"] .cell');
        expect(cells.length).toBeGreaterThan(5);
        expect(cells.every((c) => c.getAttribute('data-state') === 'done')).toBe(true);
      },
      { timeout: 60_000, interval: 100 },
    );
    const text = sim()?.textContent ?? '';
    for (const word of [
      'Твоя рука',
      'Порада',
      'Перший бій',
      'Сесія боїв',
      'Перемог за годину',
      'Рьо за годину',
      'Досвіду за годину',
    ]) {
      expect(text, word).toContain(word);
    }
    // The win rate comes with its interval.
    expect(text).toMatch(/\d+% \(від \d+% до \d+%/);
    expect(
      qa('[data-sim="prep"] [role="columnheader"]').filter((h) => h.textContent !== ''),
    ).toHaveLength(2);
  }, 90_000);

  it('restarts the forecast when the role of the clones changes', async () => {
    booted = await bootApp([coreUi, simulatorUi], player(2), PREPARE);
    const done = () => {
      const cells = qa('[data-sim="prep"] .cell');
      return cells.length > 5 && cells.every((c) => c.getAttribute('data-state') === 'done');
    };
    await vi.waitFor(() => expect(done()).toBe(true), { timeout: 60_000, interval: 100 });
    const role = content.cloneRoles.find((r) => r.id !== game.state.loadouts.cloneRole);
    expect(role).toBeDefined();
    const r = game.dispatch({ type: 'loadout.cloneRole', role: role?.id ?? '' });
    expect(r.ok).toBe(true);
    flushSync();
    // The old numbers are gone while a new forecast works.
    await vi.waitFor(() => expect(done()).toBe(false), { timeout: 5_000, interval: 10 });
    await vi.waitFor(() => expect(done()).toBe(true), { timeout: 60_000, interval: 100 });
  }, 90_000);

  it('gives its numbers while the game clock runs: a tick does not restart the forecast', async () => {
    booted = await bootApp([coreUi, simulatorUi], player(2), PREPARE);
    const app = booted;
    // The clock is running: the game state changes every 20 ms of real time while the forecast works.
    let ticks = 0;
    const clock = setInterval(() => {
      ticks++;
      app.advance(1000);
    }, 20);
    try {
      await vi.waitFor(
        () => {
          const cells = qa('[data-sim="prep"] .cell');
          expect(cells.length).toBeGreaterThan(5);
          expect(cells.every((c) => c.getAttribute('data-state') === 'done')).toBe(true);
        },
        { timeout: 60_000, interval: 100 },
      );
    } finally {
      clearInterval(clock);
    }
    // It was not a quiet game: many ticks came in while the numbers were worked out.
    expect(ticks).toBeGreaterThan(20);
    expect(q('[data-sim="prep"]')?.textContent).toMatch(/\d+% \(від \d+% до \d+%/);
  }, 90_000);

  it('does not give numbers for an enemy that is not known', async () => {
    booted = await bootApp([coreUi, simulatorUi], player(0), PREPARE);
    expect(q('[data-sim="prep"]')?.textContent).toContain('Невідомий ворог: чисел немає');
    expect(q('[data-sim="prep"] .table')).toBeNull();
  });

  it('adds its numbers to the Bingo book on request, and only for an entry that is known', async () => {
    booted = await bootApp([coreUi, simulatorUi], player(2), '#/combat/bingo');
    const entry = q(`[data-ui="bingo-entry"][data-entity="enemy:${WOLF}"]`);
    expect(entry).not.toBeNull();
    const button = entry?.querySelector<HTMLButtonElement>('[data-sim="bingo"] button');
    expect(button).not.toBeNull();
    expect(entry?.querySelector('[data-sim-first]')).toBeNull();
    button?.click();
    await vi.waitFor(() => expect(entry?.querySelector('[data-sim-first]')).not.toBeNull(), {
      timeout: 30_000,
      interval: 50,
    });
    expect(entry?.querySelector('[data-sim-first]')?.textContent).toMatch(/\d+%/);
    // An entry the player has not met has no numbers.
    const unmet = qa('[data-ui="bingo-entry"]').filter((e) => e.getAttribute('data-level') === '0');
    for (const e of unmet) expect(e.querySelector('[data-sim]')).toBeNull();
  }, 60_000);

  it('goes away with the pack: the same screen without it has none of its numbers', async () => {
    booted = await bootApp([coreUi, simulatorUi], player(1), PREPARE);
    expect(q('[data-sim="prep"]')).not.toBeNull();
    booted.destroy();
    booted = await bootApp([coreUi], player(1), PREPARE);
    expect(qa('[data-sim]')).toHaveLength(0);
    expect(booted.target.textContent).not.toContain('Симулятор бою');
  });
});

describe('F1: the settings list the built-in packs', () => {
  it('has a section with a toggle and a one-line description, off by default', async () => {
    booted = await bootApp([coreUi], player(0), '#/settings');
    const section = q('[data-builtin-packs]');
    expect(section?.querySelector('h2')?.textContent).toBe('Вбудовані розширення');
    const row = q('[data-builtin="simulator"]');
    expect(row?.textContent).toContain('Симулятор бою');
    const box = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
    expect(settings.builtinPacks).toEqual([]);
  });

  it('switching it on is a setting of the interface that the next boot reads', async () => {
    booted = await bootApp([coreUi], player(0), '#/settings');
    const box = q('[data-builtin="simulator"] input')! as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.builtinPacks).toEqual(['simulator']);
    expect(enabledBuiltin(settings.builtinPacks)).toEqual([simulatorUi]);
    expect(JSON.parse(localStorage.getItem('shinobi.settings') ?? '{}').builtinPacks).toEqual([
      'simulator',
    ]);
    // It is not running in this boot yet: the page says it starts with the next one.
    await vi.waitFor(() =>
      expect(q('[data-builtin-packs]')?.textContent).toContain('після перезапуску'),
    );
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.builtinPacks).toEqual([]);
  });
});
