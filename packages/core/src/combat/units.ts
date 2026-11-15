/**
 * Fight time. A fight runs on its own clock in work units: one ms of game time at full speed is
 * WORK_PER_MS units, and a slot with a smaller share feeds the fight proportionally fewer units.
 * This equals the slot share scale (`SHARE_FULL`), so `dt * share` is already in work units.
 */
export const WORK_PER_MS = 1000;

/** Speed scale of a combatant's timers: full speed, in thousandths. */
export const RATE_FULL = 1000;

/** Fight clock units in `ms` milliseconds. */
/** Whole work units in `ms` milliseconds (rounded to the nearest unit: every time of a fight is an integer). */
export const workOf = (ms: number): number => Math.round(ms * WORK_PER_MS);

/**
 * Size of a timer that needs `ms` milliseconds at full speed. Timers fill by `work x speed`, so a
 * slowed combatant takes longer, in whole numbers.
 */
export const needOf = (ms: number): number => Math.round(ms * WORK_PER_MS * RATE_FULL);

/** Length of one tick of a damage or heal over time, in ms. */
export const TICK_MS = 1000;
