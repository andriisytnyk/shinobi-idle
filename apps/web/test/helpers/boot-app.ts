import { content } from '@shinobi/content';
import { createState, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import App from '../../src/App.svelte';
import type { Ui } from '../../src/lib/ext/runtime.svelte.ts';
import type { UiPack } from '../../src/lib/ext/types.ts';
import { settings } from '../../src/lib/settings.svelte.ts';
import { game } from '../../src/lib/store.ts';

/** A genin with a name, so that no welcome modal covers the page. */
export function genin(): GameState {
  const state = createState(1, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  return state;
}

export interface BootedApp {
  target: HTMLElement;
  ui: Ui;
  /** Opens a route and lets the app draw it. */
  go(hash: string): Promise<void>;
  /** Moves game time forward like waiting would, and lets the app draw it. */
  advance(ms: number): void;
  destroy(): void;
}

/** Boots the app with these UI packs, the built-in one first unless the caller leaves it out. */
export async function bootApp(
  packs: UiPack[],
  state: GameState = genin(),
  hash = '',
): Promise<BootedApp> {
  if (game.phase === 'loading') await game.start();
  game.replaceState(state);
  settings.hints = false;
  settings.theme = 'core:base';
  location.hash = hash;
  // The router learns of the new hash from the hashchange event, which is delivered on a later task.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const target = document.createElement('div');
  document.body.append(target);
  let ui: Ui | undefined;
  const app = mount(App, { target, props: { uiPacks: packs, onUi: (u: Ui) => (ui = u) } });
  flushSync();
  const go = async (next: string) => {
    location.hash = next;
    // The hashchange event is delivered on a later task.
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  };
  if (!ui) throw new Error('The app did not report its UI');
  return {
    target,
    ui,
    go,
    advance(ms) {
      game.devAdvance(ms);
      flushSync();
    },
    destroy() {
      unmount(app);
      target.remove();
    },
  };
}
