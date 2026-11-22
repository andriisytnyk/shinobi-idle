// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { hexKey, locationHint } from '@shinobi/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { lookHref } from '../src/lib/world.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { able } from './helpers/missions.ts';

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
});

const CELL = content.cells.find((c) => c.id === 'core:karavannyi_shliakh')!;
const ENEMY = { kind: 'enemy', id: 'core:merc_pack' } as const;
const caravanState = () => {
  const state = able();
  delete state.world.surveyed[hexKey(CELL.hex[0], CELL.hex[1])];
  state.world.explores = {};
  return state;
};

describe('where to look', () => {
  it('names the region of the mercenaries on the caravan mission, with a link to the map', async () => {
    booted = await bootApp([coreUi], caravanState(), '#/mission/core:caravan');
    const line = q('[data-where-look="enemy"]');
    expect(line).not.toBeNull();
    expect(line?.dataset.exact).toBe('false');
    expect(line?.textContent).toContain(ukLocale['look.search']);
    expect(line?.textContent).toContain(ukLocale[`region.${CELL.region}.name`]);
    const link = line?.querySelector<HTMLAnchorElement>('[data-look-link]');
    expect(link?.textContent?.trim()).toBe(ukLocale['look.show']);
    expect(link?.getAttribute('href')).toBe(lookHref(ENEMY));
  });

  it('opens the map with the search area highlighted, and drops it on a normal visit', async () => {
    const state = caravanState();
    booted = await bootApp([coreUi], state, lookHref(ENEMY));
    const hint = locationHint(state, content, ENEMY)!;
    const shown = qa('[data-hex]')
      .filter((h) => h.querySelector('[data-look-hex]'))
      .map((h) => h.dataset.hex);
    expect(shown.sort()).toEqual([...hint.hexes].sort());
    expect(q('[data-looking]')?.dataset.looking).toBe('area');
    expect(q('[data-legend]')?.textContent).toContain(ukLocale['map.legend.look']);
    await booted.go('#/world');
    expect(qa('[data-look-hex]')).toHaveLength(0);
    expect(q('[data-looking]')).toBeNull();
  });

  it('points at the exact cell once it is surveyed', async () => {
    const state = caravanState();
    state.world.surveyed[hexKey(CELL.hex[0], CELL.hex[1])] = true;
    booted = await bootApp([coreUi], state, '#/mission/core:caravan');
    expect(q('[data-where-look="enemy"]')?.dataset.exact).toBe('true');
    await booted.go(lookHref(ENEMY));
    expect(qa('[data-look-hex]')).toHaveLength(1);
    expect(q('[data-looking]')?.dataset.looking).toBe('exact');
  });
});
