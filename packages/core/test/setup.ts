import { afterEach } from 'vitest';
import { verifyModCache } from '../src/modifiers.ts';

// `VERIFY_MODS=1 pnpm test`: every kept modifier total that is used is worked out again and compared.
if (process.env.VERIFY_MODS) verifyModCache(true);

// The tests here are synchronous and CPU-heavy. Between two of them the runner only awaits
// promises, so a file that takes more than a minute never lets the worker's event loop turn, the
// worker cannot hear the runner's answers, and the run fails with "Timeout calling onTaskUpdate"
// although every test passed. One turn of the event loop after each test prevents that.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
