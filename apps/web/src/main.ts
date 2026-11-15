import { mount } from 'svelte';
import App from './App.svelte';
import { isDevMode } from './lib/dev.ts';
import { migrateLocalGoal } from './lib/goal-migration.ts';
import { browserStorage } from './lib/settings.svelte.ts';
import { game } from './lib/store.ts';
import './fonts.css';
import './tokens.css';
import './app.css';
import './tiles.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

// The game loads its save and starts ticking in the background; the shell renders at once.
// A goal pinned in the local settings by an older version moves into the game once it is loaded.
void game.start().then(() => {
  if (game.ready) migrateLocalGoal(browserStorage(), game);
});

// With ?dev=1 the game is reachable from the console for debugging.
if (isDevMode()) Object.assign(window, { __shinobi: game });

export default mount(App, { target });
