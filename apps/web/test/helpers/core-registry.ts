import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { coreUi } from '../../src/lib/ext/core-ui.ts';
import { createRegistry } from '../../src/lib/ext/registry.ts';
import { createUi, uiContext, type Ui } from '../../src/lib/ext/runtime.svelte.ts';
import { settings } from '../../src/lib/settings.svelte.ts';
import { game } from '../../src/lib/store.ts';

/** The registry of the built-in game alone, for tests of the pure helpers. */
export const coreRegistry = createRegistry([coreUi]);

/** Renders a component to HTML inside the UI of the built-in game, as the app does. */
export function inApp(component: Component<Record<string, never>>): string {
  const ui = createUi([coreUi], { game, settings });
  try {
    return render(component, { props: {}, context: uiContext(ui) }).body;
  } finally {
    ui.dispose();
  }
}

/** One UI of the built-in game for a whole test file: what a page mounted on its own needs to find its panels. */
let shared: Ui | null = null;
export function coreContext(): Map<unknown, unknown> {
  shared ??= createUi([coreUi], { game, settings });
  return uiContext(shared);
}
