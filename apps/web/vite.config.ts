import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173 },
  // Svelte's browser build, so a component can be mounted in the DOM tests (server rendering uses svelte/server).
  resolve: process.env.VITEST ? { conditions: ['browser'] } : {},
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
