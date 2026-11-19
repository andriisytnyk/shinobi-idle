import type { ContentDb } from '@shinobi/content';
import { figure } from './need.ts';
import type { SummonSpec } from './fight-types.ts';

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

/**
 * The localisation key that names the bodies a technique makes (the text takes `{n}`, their number), from the
 * summon's own data; null when the technique names none, a mod's summon, say, which a screen then names by the
 * technique and the number. A kind the content no longer has gives null.
 */
export function allyNameKey(content: ContentDb, kind: string): string | null {
  const effect = content.techniques.find((t) => t.id === kind)?.combat?.effect;
  return effect?.kind === 'summon' ? (effect.allyName ?? null) : null;
}

/**
 * What a summon technique makes, with the numbers of its `K.techFx` row resolved for a Mastery level: how many bodies a
 * cast makes (the row's `count` and one more for every `masteryStep` levels, at most `max`), the share of the caster's
 * pools they take, and a body's health, damage and threat. The fight and the technique page both read it from here.
 */
export function summonSpecOf(content: ContentDb, fxKey: string, mastery: number): SummonSpec {
  const gate = (content.balance.K.techFx as Record<string, Record<string, number> | undefined>)[
    fxKey
  ];
  const path = `techFx.${fxKey}`;
  const max = Math.max(1, Math.floor(figure(gate, 'max', path)));
  const step = Math.max(1, figure(gate, 'masteryStep', path));
  const grown = Math.floor(figure(gate, 'count', path) + mastery / step);
  return {
    count: Math.min(max, Math.max(1, grown)),
    max,
    share: figure(gate, 'share', path),
    hp: figure(gate, 'hp', path),
    dmg: figure(gate, 'dmg', path),
    threat: figure(gate, 'threat', path),
    casts: Math.max(1, Math.floor(figure(gate, 'casts', path))),
  };
}
