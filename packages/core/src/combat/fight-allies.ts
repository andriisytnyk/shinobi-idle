import type { ContentDb } from '@shinobi/content';

/*
 * The numbers of an ally's own earnings, from the `K.techFx` row of the technique that summoned it (the bots tune them):
 * `xp` is the rate at which a body earns XP and Mastery by its own actions (with several bodies this can multiply
 * combat XP per hour), `pass` the share of it that passes to the character when the body leaves the fight (the
 * knowledge handed over; 0 hands over nothing), `fatigue` the scale of the mind fatigue that handing over leaves.
 * A body's `kind` is the id of its summoning technique; a row that is missing, or a technique the content no longer
 * has, gives the defaults (1). Every share is at least 0.
 */
export interface AllyShares {
  xp: number;
  pass: number;
  fatigue: number;
}

const share = (row: Record<string, number> | undefined, key: string): number => {
  const v = row?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 1;
};

export function sharesOf(content: ContentDb, kind: string): AllyShares {
  const effect = content.techniques.find((t) => t.id === kind)?.combat?.effect;
  const rows = content.balance.K.techFx as Record<string, Record<string, number> | undefined>;
  const row = effect?.kind === 'summon' ? rows[effect.fx] : undefined;
  return {
    xp: share(row, 'xpShare'),
    pass: share(row, 'passShare'),
    fatigue: share(row, 'fatigueShare'),
  };
}
