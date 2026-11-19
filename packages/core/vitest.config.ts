import { defineConfig } from 'vitest/config';

// Several test files run hundreds of simulated fights; on a loaded machine the older step-by-step
// determinism tests need more than the default five seconds.
export default defineConfig({
  test: { testTimeout: 30_000, setupFiles: ['./test/setup.ts'] },
});
