// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

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

describe('F1-fix1: the top bar has one row on a phone, the rest behind a menu button', () => {
  it('marks the first currency, the health and the rank as the ones that stay, and has a menu button that unfolds the rest', async () => {
    booted = await bootApp([coreUi]);
    const bar = booted.target.querySelector<HTMLElement>('header.topbar')!;
    const kept = [...bar.querySelectorAll('.stat.primary')];
    expect(kept).toHaveLength(3);
    expect(kept[0]?.getAttribute('data-ui')).toBe('topbar-currency');
    // The health stays in the bar too: it is the number a player glances at between fights.
    expect(kept[1]?.hasAttribute('data-topbar-hp')).toBe(true);
    expect(kept[2]?.classList.contains('rank')).toBe(true);
    const button = bar.querySelector<HTMLButtonElement>('.menu-btn')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Меню');
    expect(bar.classList.contains('open')).toBe(false);
    // The things behind the button: the tools are in the panel it controls. The bank, the village and
    // the shop are not among them: the side menu (a wide screen) and «Ще» (a phone) lead there.
    const panel = bar.querySelector<HTMLElement>(`#${button.getAttribute('aria-controls')}`);
    expect(panel?.querySelector('[data-more-bank], a[href="#/more"]')).not.toBeNull();
    expect(panel?.querySelector('[data-bank-link]')).toBeNull();
    expect(panel?.querySelector('[data-shop-link]')).toBeNull();
    expect(panel?.querySelector('[data-village-link]')).toBeNull();
    expect(panel?.querySelector('[data-topbar-dev-slot]')).not.toBeNull();
    button.click();
    flushSync();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(bar.classList.contains('open')).toBe(true);
    // Going to another page folds the menu again.
    await booted.go('#/bank');
    expect(bar.classList.contains('open')).toBe(false);
  });
});
