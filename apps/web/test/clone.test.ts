// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { dispatch, growSlots, type GameState } from '@shinobi/core';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { t } from '../src/lib/i18n.ts';
import { game } from '../src/lib/store.ts';
import { toasts } from '../src/lib/toasts.svelte.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { player } from './helpers/missions.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const CLONE = 'core:shadow_clone';

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
  toasts.clear();
  settings.setExt('core:missions.onlyAvailable', false);
});

/** A genin who knows the clone technique and has levels enough for the actions the tests start. */
function cloner(): GameState {
  const state = player({
    natures: ['katon'],
    levels: { nin: 50, med: 40, herb: 20, alch: 20, cc: 30 },
    known: [CLONE],
    bank: { 'core:mint': 500, 'core:water': 500 },
    rankC: true,
  });
  growSlots(state, content);
  return state;
}

const drill = () => content.exercises.find((e) => e.level <= 20)?.id ?? '';
const start = (state: GameState, slot: number, kind: string, id: string) =>
  dispatch(state, { type: 'action.start', slot, kind, id }, content);

describe('the clone in the Now bar', () => {
  it('marks the clone slot with the tag «Клон:» and gives it «Розвіяти» in place of «Зупинити»', async () => {
    const state = cloner();
    start(state, 0, 'drill', drill());
    start(state, 1, 'gather', 'core:mint');
    booted = await bootApp([coreUi], state, '#/skill/tai');
    const rows = qa('[data-ui="now-slot"]');
    expect(rows.map((r) => r.dataset.slotIndex)).toEqual(['0', '1']);
    expect(rows[0]?.querySelector('[data-ui="clone-tag"]')).toBeNull();
    const tag = rows[1]?.querySelector('[data-ui="clone-tag"]');
    expect(tag?.textContent).toContain(t('now.clone'));
    expect(rows[0]?.querySelector('.stop')?.getAttribute('aria-label')).toBe(t('now.stop'));
    const dispel = rows[1]?.querySelector<HTMLButtonElement>('.stop');
    expect(dispel?.getAttribute('aria-label')).toBe(t('now.dispel'));
    dispel?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toBeNull();
    expect(game.state.slots[0]?.action).not.toBeNull();
    expect(game.state.slots.map((s) => s.share)).toEqual([1000, 0]);
    expect(qa('[data-ui="clone-tag"]').length).toBe(0);
  });

  it('shows no tag for a player with no clone', async () => {
    const state = player({ natures: ['katon'], base: 5 });
    start(state, 0, 'drill', drill());
    booted = await bootApp([coreUi], state, '#/skill/cc');
    expect(qa('[data-ui="now-slot"]').length).toBe(1);
    expect(qa('[data-ui="clone-tag"]').length).toBe(0);
  });
});

describe('the clone on a skill page', () => {
  it('offers «Клоном» next to «Почати» only once the clone exists, and starts the action in its slot', async () => {
    const before = player({ natures: ['katon'], base: 20 });
    booted = await bootApp([coreUi], before, '#/skill/herb');
    expect(qa('[data-ui="clone-start"]').length).toBe(0);
    booted.destroy();

    booted = await bootApp([coreUi], cloner(), '#/skill/herb');
    const mint = q('[data-herb="core:mint"]');
    const button = mint?.querySelector<HTMLButtonElement>('[data-ui="clone-start"]');
    expect(button?.textContent?.trim()).toBe(t('tile.clone'));
    button?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toEqual({ kind: 'gather', id: 'core:mint' });
    expect(game.state.slots[0]?.action).toBeNull();
    // It runs now, so the tile offers «Зупинити» and no second start.
    expect(q('[data-herb="core:mint"]')?.querySelector('[data-ui="clone-start"]')).toBeNull();
  });

  it('shows the link bonus in the breakdown of the fed craft, with the technique as its source', async () => {
    const state = cloner();
    start(state, 0, 'gather', 'core:mint');
    start(state, 1, 'craft', 'core:antidote');
    booted = await bootApp([coreUi], state, '#/skill/alch');
    const tile = q('[data-action="core:antidote"]');
    const figure = tile?.querySelector<HTMLButtonElement>('[data-ui="action-interval"] .figure');
    figure?.click();
    flushSync();
    const list = tile?.querySelector('[data-ui="action-interval"] .list');
    expect(list?.textContent).toContain('+10%');
    expect(list?.querySelector('a')?.getAttribute('href')).toBe(`#/technique/${CLONE}`);
  });
});

describe('the clone on the mission board', () => {
  it('takes a mission with no combat stage, and says why it does not take one with a fight', async () => {
    const quiet = content.missions.find(
      (m) => m.board && m.rank === 'V' && !m.stages.some((s) => s.t === 'combat'),
    );
    const fight = content.missions.find((m) => m.board && m.stages.some((s) => s.t === 'combat'));
    expect(quiet && fight).toBeTruthy();
    const state = cloner();
    booted = await bootApp([coreUi], state, '#/missions');
    const card = (id: string) => q(`[data-ui="mission-card"][data-mission="${id}"]`);
    const fightButton = card(fight?.id ?? '')?.querySelector<HTMLButtonElement>(
      '[data-ui="clone-start"]',
    );
    expect(fightButton?.disabled).toBe(true);
    expect(card(fight?.id ?? '')?.querySelector('[data-clone-why]')?.textContent).toBe(
      t('error.cloneNoFight'),
    );
    const button =
      card('core:v_clones')?.querySelector<HTMLButtonElement>('[data-ui="clone-start"]');
    expect(button?.disabled).toBe(false);
    button?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toEqual({ kind: 'mission', id: 'core:v_clones' });
    expect(card('core:v_clones')?.querySelector('[data-running]')?.textContent).toContain(
      t('mission.runningClone'),
    );
  });

  it('has no «Клоном» before the player has a clone', async () => {
    booted = await bootApp([coreUi], player({ natures: ['katon'], base: 5 }), '#/missions');
    expect(qa('[data-ui="clone-start"]').length).toBe(0);
  });

  it('puts «Клоном» on the mission page too', async () => {
    booted = await bootApp([coreUi], cloner(), '#/mission/core:v_clones');
    const button = q('[data-mission-actions] [data-ui="clone-start"]') as HTMLButtonElement | null;
    expect(button?.disabled).toBe(false);
    button?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toEqual({ kind: 'mission', id: 'core:v_clones' });
  });
});
