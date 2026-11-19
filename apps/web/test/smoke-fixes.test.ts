// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { createState, xpAt, type GameState } from '@shinobi/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../src/lib/i18n.ts';
import { graduateRank, rankName } from '../src/lib/vocab.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

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
  settings.setExt('core:missions.onlyAvailable', false);
});

/** A student of the Academy with a name, so that no welcome modal covers the page. */
function student(): GameState {
  const state = createState(1, content);
  state.player.name = 'Тест';
  return state;
}

const RUINS = 'core:war_fort_ruins';
const SEARCH = 'core:search_war_fort_ruins';

describe("a fieldwork's own page", () => {
  const genin = (): GameState => {
    const state = createState(1, content);
    state.player.name = 'Тест';
    state.player.rank = 'genin';
    return state;
  };

  it('has the start of its Scouting tile once the point is found and the level is there', async () => {
    const state = genin();
    state.skills.scout = { xp: xpAt(10) };
    state.world.pois[RUINS] = true;
    booted = await bootApp([coreUi], state, `#/fieldwork/${SEARCH}`);
    const start = q('[data-fieldwork-start] [data-ui="start-split"] [data-start]');
    expect(start).not.toBeNull();
    start?.click();
    expect(game.state.slots[0]?.action).toEqual({ kind: 'fieldwork', id: SEARCH });
  });

  it('shows the same lock as the tile while the level is short', async () => {
    const state = genin();
    state.world.pois[RUINS] = true;
    booted = await bootApp([coreUi], state, `#/fieldwork/${SEARCH}`);
    const tile = q('[data-fieldwork-start] [data-ui="action-tile"]');
    expect(tile?.classList.contains('locked')).toBe(true);
    expect(tile?.querySelector('[data-ui="start-split"]')).toBeNull();
    expect(tile?.querySelector('[data-ui="req-row"][data-met="false"]')).not.toBeNull();
  });

  it('keeps the reveal rule: no start while the point is not found', async () => {
    booted = await bootApp([coreUi], genin(), `#/fieldwork/${SEARCH}`);
    expect(q('[data-fieldwork-start]')).toBeNull();
    expect(booted.target.innerHTML).not.toContain('war_fort_ruins');
  });
});

describe('a locked technique tile on the skill page', () => {
  it('lists the rank that is not met, not only the level that is', async () => {
    const state = student();
    state.skills.tai!.xp = xpAt(14);
    booted = await bootApp([coreUi], state, '#/skill/tai');
    const tile = q('[data-action="core:dynamic_entry"]');
    expect(tile, 'the tile of the technique').not.toBeNull();
    expect(tile?.classList.contains('locked')).toBe(true);
    const rows = [...(tile?.querySelectorAll<HTMLElement>('[data-ui="req-row"]') ?? [])];
    const unmet = rows.filter((r) => r.dataset.met === 'false');
    const rankText = t('req.rank', { rank: rankName(graduateRank(content) ?? '') });
    expect(unmet.some((r) => r.textContent?.includes(rankText))).toBe(true);
    // The met level is still there, marked as met.
    expect(rows.some((r) => r.dataset.met === 'true')).toBe(true);
  });
});
