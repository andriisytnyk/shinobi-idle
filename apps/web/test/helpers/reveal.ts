import { setRevealDisabled } from '../../src/lib/reveal.ts';

/**
 * Runs the callback with the reveal rule switched off (everything is shown in full) and puts the rule back.
 * For checks that are about something else than discovery: that the links of a page land on real
 * entities, that every registered page opens. The reveal rule has its own tests.
 */
export function withoutReveal<T>(fn: () => T): T {
  setRevealDisabled(true);
  try {
    return fn();
  } finally {
    setRevealDisabled(false);
  }
}

/** Switches the rule off for a whole describe: call inside it, with the vitest hooks. */
export function revealOffHooks(hooks: {
  beforeEach: (fn: () => void) => void;
  afterEach: (fn: () => void) => void;
}): void {
  hooks.beforeEach(() => setRevealDisabled(true));
  hooks.afterEach(() => setRevealDisabled(false));
}
