// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { createState, xpAt, zoneCellOf, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import CombatPage from '../src/pages/CombatPage.svelte';

const WOLF_ZONE = 'core:zone_wolf';
const WOLF = 'core:wolf';
const WOLF_CELL = zoneCellOf(WOLF_ZONE, content) ?? '';
const FIRST_LEVEL = content.balance.K.cellExplores[0] ?? 0;
const cell = content.cells.find((c) => c.id === WOLF_CELL);

function genin(): GameState {
  const state = createState(3, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(14);
  }
  for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  return state;
}

function explore(state: GameState, id: string): void {
  state.world.explores[id] = FIRST_LEVEL;
  state.flags['region.forest.unlocked'] = true;
  const c = content.cells.find((x) => x.id === id);
  for (const poi of c?.pois ?? []) state.world.pois[poi.id] = true;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;
const q = (selector: string) => target.querySelector<HTMLElement>(selector);
const click = (el: Element | null) => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();
};

function show(state: GameState, props: Record<string, unknown> = {}): void {
  game.replaceState(state);
  app = mount(CombatPage, { target, props });
  flushSync();
}

beforeEach(() => {
  settings.hints = false;
  target = document.createElement('div');
  document.body.append(target);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (app) unmount(app);
  app = null;
  target.remove();
});

describe('the combat page shows enemies as cards grouped by area', () => {
  it('has a group for the Academy, one per region with cells, and the cards in them', () => {
    expect(cell).toBeDefined();
    const state = genin();
    explore(state, WOLF_CELL);
    show(state);
    expect(q('[data-group="academy"] [data-enemy="core:dummy"]')).not.toBeNull();
    const group = q(`[data-ui="zone-group"][data-group="${cell?.region}"]`);
    expect(group).not.toBeNull();
    expect(group?.querySelector(`[data-ui="zone-card"][data-zone="${WOLF_ZONE}"]`)).not.toBeNull();
    // The cell is a sub-heading with a link, and no raw id is printed.
    expect(group?.querySelector(`a[href="#/cell/${WOLF_CELL}"]`)).not.toBeNull();
    expect(target.textContent).not.toMatch(/core:/);
  });

  it('shows a locked zone with its reason and a disabled start', () => {
    const state = genin();
    // The wolf was met, but its cell is not explored.
    state.bingo[WOLF] = { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
    show(state);
    const card = q(`[data-zone="${WOLF_ZONE}"]`);
    expect(card).not.toBeNull();
    expect(card?.querySelector('[data-card-locked]')?.textContent).toContain('розвідай клітинку');
    expect(card?.querySelector('[data-start]')?.hasAttribute('disabled')).toBe(true);
  });

  it('hides an enemy the player has not met nor found', () => {
    show(genin());
    expect(q(`[data-zone="${WOLF_ZONE}"]`)).toBeNull();
    expect(q('[data-group="bosses"]')).toBeNull();
    expect(target.innerHTML).not.toContain('core:wolf');
  });

  it('says «невідомо» and «???» where the Bingo book knows nothing', () => {
    const state = genin();
    explore(state, WOLF_CELL);
    show(state);
    const card = q(`[data-zone="${WOLF_ZONE}"]`);
    expect(card?.querySelector('[data-card-verdict]')?.getAttribute('data-card-verdict')).toBe(
      'unknown',
    );
    expect(card?.querySelector('[data-card-verdict]')?.textContent).toContain('невідомо');
    expect(card?.querySelector('[data-card-loot]')?.textContent).toContain('???');
    expect(card?.querySelector('[data-card-rewards]')?.textContent).toContain('???');
  });

  it('renders the verdict and the rewards from the core forecast once the enemy is known', async () => {
    const state = genin();
    explore(state, WOLF_CELL);
    state.bingo[WOLF] = { seen: 1, wins: 1, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
    // Cards ask for their forecast when they come into view: here everything is in view at once.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() {
          this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
      },
    );
    show(state);
    const card = q(`[data-zone="${WOLF_ZONE}"]`);
    await vi.waitFor(
      () => {
        flushSync();
        expect(['stable', 'risky', 'hopeless']).toContain(
          card?.querySelector('[data-card-verdict]')?.getAttribute('data-card-verdict'),
        );
      },
      { timeout: 20_000, interval: 50 },
    );
    expect(card?.querySelector('[data-card-rewards]')?.textContent).toMatch(/рьо\/год|досвід/);
    expect(card?.querySelector('[data-card-know]')?.textContent).toContain('2 із 3');
    expect(card?.querySelector('[data-card-loot]')?.textContent).not.toContain('???');
  }, 30_000);

  it('opens the preparation in a sheet over the list and closes it back to the same list', () => {
    const state = genin();
    explore(state, WOLF_CELL);
    show(state);
    const before = target.querySelectorAll('[data-ui="zone-card"]').length;
    click(q(`[data-zone="${WOLF_ZONE}"] [data-prepare]`));
    expect(q('[data-ui="prep-sheet"] [data-prep="zone"]')).not.toBeNull();
    // The list stays under the sheet.
    expect(target.querySelectorAll('[data-ui="zone-card"]').length).toBe(before);
    click(q('[data-sheet-close]'));
    expect(q('[data-ui="prep-sheet"]')).toBeNull();
    expect(target.querySelectorAll('[data-ui="zone-card"]').length).toBe(before);
    // Escape closes it too.
    click(q(`[data-zone="${WOLF_ZONE}"] [data-prepare]`));
    q('[data-ui="prep-sheet"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    flushSync();
    expect(q('[data-ui="prep-sheet"]')).toBeNull();
  });

  it('starts the fight from the sheet', () => {
    const state = genin();
    explore(state, WOLF_CELL);
    show(state);
    click(q(`[data-zone="${WOLF_ZONE}"] [data-prepare]`));
    click(q('[data-ui="prep-sheet"] button.start'));
    expect(game.state.slots[0]?.action).toMatchObject({ kind: 'fight', id: WOLF_ZONE });
    expect(q('[data-ui="prep-sheet"]')).toBeNull();
  });

  it('starts the fight from the card', () => {
    const state = genin();
    explore(state, WOLF_CELL);
    show(state);
    click(q(`[data-zone="${WOLF_ZONE}"] [data-start]`));
    expect(game.state.slots[0]?.action).toMatchObject({ kind: 'fight', id: WOLF_ZONE });
  });

  it('titles the page «Бій», and «Тренувальний бій» only while the training fight is shown', () => {
    show(genin());
    expect(q('h1')?.textContent).toBe('Бій');
    unmount(app!);
    app = null;
    const state = genin();
    state.slots[0] = { ...state.slots[0]!, action: { kind: 'fight', id: 'core:zone_dummy' } };
    game.replaceState(state);
    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_dummy' }).ok,
    ).toBe(true);
    game.devAdvance(1000);
    app = mount(CombatPage, { target });
    flushSync();
    expect(q('h1')?.textContent).toBe('Тренувальний бій');
  });
});
