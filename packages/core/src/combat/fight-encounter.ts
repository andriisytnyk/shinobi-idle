import type { Boss, ContentDb, Enemy, NatureId } from '@shinobi/content';
import type { Encounter, Spawn, TeamSupport } from './fight-types.ts';

/** The hook ids of the boss specials, by the special's kind (and, for the rival, its numbers key). */
export function specialHookIds(special: Boss['special']): string[] {
  switch (special.kind) {
    case 'packRespawn':
      return ['special:packRespawn'];
    case 'rival':
      return [special.fx === 'rivalDuel' ? 'special:rival.duel' : 'special:rival.tournament'];
    case 'evasionByMissingHp':
      return ['special:evasionByMissingHp'];
    case 'heavyCast':
      return ['special:heavyCast'];
    case 'twins':
      return ['special:twins'];
    case 'rehide':
      return ['special:rehide'];
    case 'illusion':
      return ['special:illusion'];
  }
}

/**
 * The one place an enemy or boss entry becomes what a fight is made from. A pack entry becomes
 * several weaker bodies; a boss entry scales health and damage by the boss factors and carries
 * the hooks of its special (the wolf leader brings a pack, the twins are two bodies, the Nameless
 * leaves at a share of health).
 */
export function encounterFor(
  entry: Enemy | Boss,
  content: ContentDb,
  specials: readonly string[] = [],
  rivalNature: NatureId | null = null,
  support: readonly TeamSupport[] = [],
): Encounter {
  const K = content.balance.K;
  const boss = !('region' in entry);
  const pack = entry.traits.includes('pack');
  const base: Spawn = {
    enemy: entry.id,
    cl: entry.cl,
    traits: [...entry.traits],
    nature: entry.nature,
    count: pack ? K.pack.n : 1,
    hpMult: (boss ? K.boss.hp : 1) * (pack ? K.pack.hp : 1),
    dmgMult: (boss ? K.boss.dmg : 1) * (pack ? K.pack.dmg : 1),
    fleeAt: null,
    specials: [],
  };
  const encounter: Encounter = { id: entry.id, specials: [...specials], spawns: [base] };
  if (support.length > 0) encounter.support = support.map((s) => ({ ...s }));
  if (!('special' in entry)) return encounter;

  const own = specialHookIds(entry.special);
  // Each special carries the scale of the boss body it fights with.
  const fx = K.bossFx[entry.special.fx] as {
    hp?: number;
    dmg?: number;
    leaderHp?: number;
    leaderDmg?: number;
  };
  base.count = 1;
  base.hpMult = K.boss.hp * (fx.leaderHp ?? fx.hp ?? 1);
  base.dmgMult = K.boss.dmg * (fx.leaderDmg ?? fx.dmg ?? 1);
  base.specials = own;
  switch (entry.special.kind) {
    case 'packRespawn':
      // The leader fights alone with the full boss numbers; the pack is separate, weaker bodies.
      encounter.spawns.push({
        ...base,
        count: K.bossFx.wolfPack.count,
        hpMult: K.bossFx.wolfPack.hp,
        dmgMult: K.bossFx.wolfPack.dmg,
        specials: ['special:packMember'],
      });
      break;
    case 'rival':
      // The rival fights with the nature the team gives him; a player with no nature gets none.
      base.nature = rivalNature;
      break;
    case 'twins': {
      const fx = K.bossFx.twins;
      base.count = fx.count;
      base.hpMult = K.boss.hp * fx.hpEach;
      base.dmgMult = K.boss.dmg * fx.dmgEach;
      break;
    }
    case 'illusion':
      base.fleeAt = K.bossFx.illusion.fleeAtHp;
      break;
    default:
      break;
  }
  return encounter;
}
