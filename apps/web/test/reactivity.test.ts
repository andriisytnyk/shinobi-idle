// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { createState, dispatch, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import TopBar from '../src/components/TopBar.svelte';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import NaturePage from '../src/pages/NaturePage.svelte';

/** A genin who has taken the nature test and has Chakra Control 20. */
function ready(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  dispatch(state, { type: 'nature.choose', nature: 'katon' }, content);
  state.skills.cc!.xp = 100_000;
  return state;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

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

describe('views follow the core, which changes its state in place', () => {
  it('the nature page updates after nature.add, without a reload', () => {
    game.replaceState(ready());
    app = mount(NaturePage, { target });
    flushSync();
    expect(target.querySelectorAll('[data-owned-nature]')).toHaveLength(1);
    expect(target.querySelector('[data-pick="futon"]')).not.toBeNull();
    expect(target.querySelector('[data-nature-stage]')?.getAttribute('data-nature-stage')).toBe(
      'second',
    );

    expect(game.dispatch({ type: 'nature.add', nature: 'futon' }).ok).toBe(true);
    flushSync();

    const owned = [...target.querySelectorAll('[data-owned-nature]')].map((e) =>
      e.getAttribute('data-owned-nature'),
    );
    expect(owned).toEqual(['katon', 'futon']);
    // The nature just added is no longer offered; the third is not yet due (Chakra Control 40 asked).
    expect(target.querySelector('[data-pick="futon"]')).toBeNull();
    expect(target.querySelector('[data-nature-stage]')?.getAttribute('data-nature-stage')).toBe(
      'third',
    );
    expect(target.querySelector('[data-summary]')?.textContent).toContain('Місій села');
  });

  it('the top bar lists every nature owned', () => {
    game.replaceState(ready());
    app = mount(TopBar, { target, props: { metaOpen: false, onToggleMeta: () => {} } });
    flushSync();
    const link = () => target.querySelector('[data-nature-link]')?.textContent ?? '';
    expect(link()).toContain('Катон');
    expect(link()).not.toContain('Футон');
    game.dispatch({ type: 'nature.add', nature: 'futon' });
    flushSync();
    expect(link()).toContain('Катон');
    expect(link()).toContain('Футон');
  });
});
