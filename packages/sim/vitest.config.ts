import { defineConfig } from 'vitest/config';

// The bot and strategy tests play whole game hours step by step. On a loaded runner (the packages
// of the repository are tested one after another, but the files of this one run side by side) they
// can take far more than the default 5 s per test and 10 s per hook. None of them asserts a time;
// the wall-clock budgets live in `speedIt` tests, see `packages/core/test/speed.ts`.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 120_000 },
});
