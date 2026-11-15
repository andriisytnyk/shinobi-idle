import type { Boss, ContentDb, Enemy } from '@shinobi/content';
import { fightData } from './fight-data.ts';
import type { Encounter, Spawn, TeamSupport } from './fight-types.ts';

/** A row of the balance object that holds plain numbers. */
function bossFxOf(K: object, key: string): Record<string, number> {
  const row = Object.hasOwn(K, key) ? (K as Record<string, unknown>)[key] : undefined;
  return typeof row === "object" && row !== null ? (row as Record<string, number>) : {};
}

/** The numbers of a `K.bossFx` entry, or none when the content has no such entry. */
function bossFx(content: ContentDb, key: string): Record<string, number> {
  const table = content.balance.K.bossFx as Record<string, Record<string, number> | undefined>;
  return Object.hasOwn(table, key) ? (table[key] ?? {}) : {};
}

/**
 * The one place an enemy or boss entry becomes what a fight is made from. A pack entry becomes
 * several weaker bodies; a boss entry scales health and damage by the boss factors and carries
 * the hook of its special. What the special makes of the encounter is read from its data: a pack of
 * weaker bodies beside the leader (`companions`), several equal bodies (`bodies`), a share of health
 * at which the body leaves (`fleeAt`), the nature the rival takes (`nature`).
 */
export function encounterFor(
  entry: Enemy | Boss,
  content: ContentDb,
  specials: readonly string[] = [],
  rivalNature: string | null = null,
  support: readonly TeamSupport[] = [],
): Encounter {
  const K = content.balance.K;
  const boss = !('region' in entry);
  const traits = fightData(content).traits;
  const swarmRow = entry.traits.map((t) => traits.get(t)?.swarm).find((row) => row !== undefined && row !== null);
  const swarm = swarmRow ? bossFxOf(K, swarmRow) : null;
  const base: Spawn = {
    enemy: entry.id,
    cl: entry.cl,
    traits: [...entry.traits],
    nature: entry.nature,
    count: swarm ? (swarm.n ?? 1) : 1,
    hpMult: (boss ? K.boss.hp : 1) * (swarm ? (swarm.hp ?? 1) : 1),
    dmgMult: (boss ? K.boss.dmg : 1) * (swarm ? (swarm.dmg ?? 1) : 1),
    fleeAt: null,
    specials: [],
  };
  const encounter: Encounter = { id: entry.id, specials: [...specials], spawns: [base] };
  if (support.length > 0) encounter.support = support.map((s) => ({ ...s }));
  if (!('special' in entry)) return encounter;

  const special = entry.special;
  // Each special carries the scale of the boss body it fights with.
  const fx = bossFx(content, special.fx);
  base.count = 1;
  base.hpMult = K.boss.hp * (fx.leaderHp ?? fx.hp ?? 1);
  base.dmgMult = K.boss.dmg * (fx.leaderDmg ?? fx.dmg ?? 1);
  base.specials = [special.hook];
  if (special.companions) {
    // The leader fights alone with the full boss numbers; the others are separate, weaker bodies.
    const mates = bossFx(content, special.companions.fx);
    encounter.spawns.push({
      ...base,
      count: mates.count ?? 1,
      hpMult: mates.hp ?? 1,
      dmgMult: mates.dmg ?? 1,
      specials: [special.companions.hook],
    });
  }
  // The rival fights with the nature the team gives him; a player with no nature gets none.
  if (special.nature) base.nature = rivalNature;
  if (special.bodies) {
    base.count = fx.count ?? 1;
    base.hpMult = K.boss.hp * (fx.hpEach ?? 1);
    base.dmgMult = K.boss.dmg * (fx.dmgEach ?? 1);
  }
  if (special.fleeAt !== undefined) base.fleeAt = fx[special.fleeAt] ?? null;
  return encounter;
}
