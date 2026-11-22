// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PointModal from '../src/components/PointModal.svelte';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import WorldPage from '../src/pages/WorldPage.svelte';
import { coreContext } from './helpers/core-registry.ts';

const FIRST = content.balance.K.cellExplores[0] ?? 0;
const TG44 = 'core:training_ground_44';
const name = (key: string): string => ukLocale[key] ?? key;
const tg = content.places.find((p) => p.id === TG44)!;
const coord = `${tg.hex[0]},${tg.hex[1]}`;
const cellId = content.cells.find((c) => `${c.hex[0]},${c.hex[1]}` === coord)?.id;

function surveyed(found = false): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  if (cellId) state.world.explores[cellId] = FIRST;
  state.world.surveyed[coord] = true;
  if (found) state.world.pois[TG44] = true;
  return state;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;
const q = (selector: string) => target.querySelector<HTMLElement>(selector);
const click = (el: Element | null) => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();
};

function open(state: GameState): void {
  game.replaceState(state);
  app = mount(WorldPage, {
    target,
    context: coreContext(),
    props: { focus: { cell: null, region: 'core:forest' } },
  });
  flushSync();
  click(q(`[data-ui="hex"][data-hex="${coord}"]`));
}

beforeEach(() => {
  settings.hints = false;
  target = document.createElement('div');
  document.body.append(target);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
});

describe('the hex card over the map', () => {
  it('holds the essentials and not the full panel', () => {
    open(surveyed());
    const card = q('[data-hex-card]');
    expect(card).not.toBeNull();
    expect(q('[data-hex-panel]')).toBeNull();
    expect(q('[data-hex-title]')?.textContent?.trim()).not.toBe('');
    expect(q('[data-hex-level]')?.textContent).toMatch(/\d+\/\d+/);
    // The long texts of the panel stay behind «Деталі».
    expect(q('[data-auto-help]')).toBeNull();
    expect(q('[data-pois]')).toBeNull();
  });

  it('has single-line actions, and says why one is off in its title', () => {
    open(surveyed());
    const actions = [
      ...target.querySelectorAll<HTMLElement>('[data-hex-card] [data-actions] button'),
    ];
    expect(actions.length).toBeGreaterThan(2);
    for (const button of actions) {
      expect(button.classList.contains('wrap')).toBe(false);
      expect(button.textContent?.trim()).not.toMatch(/\n/);
    }
    expect(q('[data-hex-card] [data-explore]')?.textContent).toContain(name('map.act.survey'));
    expect(q('[data-hex-card] [data-hex-details]')?.textContent).toContain(
      name('map.card.details'),
    );
    const off = [
      ...target.querySelectorAll<HTMLButtonElement>('[data-hex-card] [data-start]'),
    ].find((b) => b.disabled);
    if (off) expect(off.getAttribute('title')).toBeTruthy();
  });

  it('closes with the cross', () => {
    open(surveyed());
    click(q('[data-hex-card] .close'));
    expect(q('[data-hex-card]')).toBeNull();
  });

  it('opens the full information behind «Деталі»', () => {
    open(surveyed());
    click(q('[data-hex-details]'));
    expect(q('[data-hex-details-body] [data-hex-panel]')).not.toBeNull();
    expect(q('[data-hex-details-body] [data-pois]')).not.toBeNull();
  });
});

describe('a found point of interest', () => {
  it('shows its name and a «Знахідка» button that opens its description', () => {
    open(surveyed(true));
    const line = q('[data-card-point]');
    expect(line?.textContent).toContain(name(`place.${TG44}.name`));
    click(q('[data-card-find]'));
    const modal = q('[data-point-modal]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain(name(`place.${TG44}.desc`));
  });

  it('the discovery dialog says «Знайдено точку!» with the name and the reward', () => {
    game.replaceState(surveyed(true));
    app = mount(PointModal, {
      target,
      context: coreContext(),
      props: {
        place: TG44,
        reward: { ryo: 25, currencies: {}, items: [], xp: null },
        title: name('map.point.discovered'),
        discovered: true,
        onClose: () => {},
      },
    });
    flushSync();
    expect(target.textContent).toContain('Знайдено точку!');
    expect(q('[data-point-modal]')?.textContent).toContain(name(`place.${TG44}.name`));
    expect(q('[data-point-reward]')).not.toBeNull();
  });
});
