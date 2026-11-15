import type { ContentDb } from '@shinobi/content';
import { localeKey, ukLocale } from '@shinobi/content';
import type { EntityRef } from './route.ts';

export interface TechniqueRelations {
  /** Missions whose stages name the technique, or accept a technique of its skill and level. */
  missions: string[];
  /** Enemies and bosses that carry the technique and can pass it on. */
  carriers: EntityRef[];
  /** Library level that stocks the technique, when it comes from the village library. */
  library: number | null;
  /** Whether the Academy teaches it. */
  academy: boolean;
}

/** Where a technique is used and where it comes from, computed from the content tables. */
export function techniqueRelations(id: string, content: ContentDb): TechniqueRelations {
  const tech = content.techniques.find((t) => t.id === id);
  const missions: string[] = [];
  for (const mission of content.missions) {
    const hit = mission.stages.some((stage) => {
      if (stage.t === 'named') return stage.technique === id || stage.alts.includes(id);
      if (stage.t === 'tech') {
        return (
          tech !== undefined && stage.any.some((a) => a.skill === tech.skill && tech.level >= a.min)
        );
      }
      return false;
    });
    if (hit) missions.push(mission.id);
  }

  const carriers: EntityRef[] = [
    ...content.enemies
      .filter((e) => e.carries === id)
      .map((e) => ({ kind: 'enemy' as const, id: e.id })),
    ...content.bosses
      .filter((b) => b.carries === id)
      .map((b) => ({ kind: 'boss' as const, id: b.id })),
  ];

  // The library level is the one number in the home text that is data, not a name.
  const home = ukLocale[localeKey('technique', id, 'home')] ?? '';
  const level =
    tech?.src === 'S' && home.startsWith('Бібліотека') ? /рівень (\d+)/.exec(home) : null;
  return {
    missions,
    carriers,
    library: level ? Number(level[1]) : null,
    academy: tech?.src === 'N' && tech.mentor === 'academy',
  };
}
