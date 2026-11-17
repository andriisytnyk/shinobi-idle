import { mount } from 'svelte';
import App from './App.svelte';
import { composeBoot, devPacks, uiPacksFor } from './lib/boot.ts';
import { enabledBuiltin } from './lib/builtin-packs.ts';
import { isDevMode } from './lib/dev.ts';
import { coreUi } from './lib/ext/core-ui.ts';
import { migrateLocalGoal } from './lib/goal-migration.ts';
import { pwa } from './lib/pwa.svelte.ts';
import { browserStorage, settings } from './lib/settings.svelte.ts';
import { bootGame, game } from './lib/store.ts';
import './fonts.css';
import './tokens.css';
import './app.css';
import './tiles.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

// The dev build can add the test packs (`?packs=testmod`); a production build never does, and the
// code that loads them is not in its bundle.
const extra = await devPacks(location.search);
const boot = composeBoot(extra.packs);
if (extra.packs.length > 0) bootGame(boot);

// The game loads its save and starts ticking in the background; the shell renders at once.
// A goal pinned in the local settings by an older version moves into the game once it is loaded.
void game.start().then(() => {
  if (game.ready) migrateLocalGoal(browserStorage(), game);
});

// Offline support and installation; the service worker is registered in the production build only.
pwa.init();

// With ?dev=1 the game is reachable from the console for debugging.
if (isDevMode()) Object.assign(window, { __shinobi: game });

export default mount(App, {
  target,
  props: {
    uiPacks: [
      coreUi,
      // The built-in packs the player switched on in the settings start with the app.
      ...enabledBuiltin(settings.builtinPacks),
      ...uiPacksFor(boot.packs, extra.available),
    ],
  },
});
