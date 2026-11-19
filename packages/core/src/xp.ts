import type { ContentDb } from '@shinobi/content';

/**
 * Melvor-style table. `points[l]` is the sum of floor(k + 300 * 2^(k / 7)) for k < l;
 * the experience needed for level l is floor(points[l] / 4), kept in `needed[l]`.
 */
const points: number[] = [0, 0];
const needed: number[] = [0, 0];

function extend(level: number): void {
  while (points.length <= level) {
    const k = points.length - 1;
    const sum = (points[k] ?? 0) + Math.floor(k + 300 * 2 ** (k / 7));
    points.push(sum);
    needed.push(Math.floor(sum / 4));
  }
}

/** Experience at which `level` is reached. Level 1 is 0 experience. */
export function xpAt(level: number): number {
  const known = needed[level];
  if (known !== undefined && level >= 1) return known;
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`Invalid level ${level}`);
  extend(level);
  return needed[level] ?? 0;
}

/** Highest level reached with `xp`, never above `cap`. */
export function levelAt(xp: number, cap: number): number {
  let lo = 1;
  let hi = cap;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (xpAt(mid) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The skill level cap, a balance parameter. */
export function levelCap(content: ContentDb): number {
  return content.balance.K.cap;
}
