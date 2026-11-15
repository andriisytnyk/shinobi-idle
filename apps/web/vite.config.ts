import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/** Short git hash of the commit being built; "dev" outside a git checkout. */
function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

// The ink token of tokens.css (--ink-900): the page background and the colour of the app frame.
const INK = '#14161b';

export default defineConfig({
  // Relative, so the build works from any sub-path: the hosting location is not decided yet.
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      // The service worker exists in the production build only: not in `pnpm dev`, not in Vitest.
      disable: Boolean(process.env.VITEST),
      devOptions: { enabled: false },
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Shinobi Idle',
        short_name: 'Shinobi Idle',
        description: 'Ідл-RPG про шлях шинобі: від учня Академії до жилета Чуніна.',
        lang: 'uk',
        dir: 'ltr',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        theme_color: INK,
        background_color: INK,
        categories: ['games'],
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole app shell: scripts, styles, the page, the fonts and the icons.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // The player must decide when a new version takes over (the save is flushed first).
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(gitShortHash()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: { port: 5173 },
  // Svelte's browser build, so a component can be mounted in the DOM tests (server rendering uses svelte/server).
  resolve: process.env.VITEST ? { conditions: ['browser'] } : {},
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
