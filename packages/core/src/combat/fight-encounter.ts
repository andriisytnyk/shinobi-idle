import type { Boss, ContentDb, Enemy } from '@shinobi/content';
import type { Encounter } from './fight-types.ts';

/**
 * The one place an enemy or boss entry becomes what a fight is made from. A pack entry becomes
 * several weaker bodies; a boss entry scales health and damage by the boss factors. Specials
 * (the boss mechanics of later tasks) are hook ids every body carries.
 */
export function encounterFor(
  entry: Enemy | Boss,
  content: ContentDb,
  specials: readonly string[] = [],
): Encounter {
  const K = content.balance.K;
  const boss = !('region' in entry);
  const pack = entry.traits.includes('pack');
  return {
    id: entry.id,
    specials: [...specials],
    spawns: [
      {
        enemy: entry.id,
        cl: entry.cl,
        traits: [...entry.traits],
        nature: entry.nature,
        count: pack ? K.pack.n : 1,
        hpMult: (boss ? K.boss.hp : 1) * (pack ? K.pack.hp : 1),
        dmgMult: (boss ? K.boss.dmg : 1) * (pack ? K.pack.dmg : 1),
        fleeAt: null,
      },
    ],
  };
}
