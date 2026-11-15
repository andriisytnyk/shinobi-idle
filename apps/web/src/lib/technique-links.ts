import type { ContentDb } from '@shinobi/content';
import type { EntityRef } from './route.ts';

export interface TechniqueRelations {
  /** Missions whose stages name the technique, or accept a technique of its skill and level. */
  missions: string[];
  /** Enemies and bosses that carry the technique and can pass it on. */
  carriers: EntityRef[];
  /** The building whose scrolls teach it, and the level that stocks the scroll; null unless the Library sells it. */
  library: { building: string; level: number } | null;
  /** The building whose mentors teach it (the Academy); null for techniques of other sources. */
  academy: string | null;
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

  // The Library sells the scroll of the technique at the level its source names.
  const library = content.buildings.find((b) => b.duty === 'scrolls');
  const source = content.items.find((i) => i.scroll?.technique === id)?.scroll?.source;
  const teaching = content.buildings.find((b) => b.duty === 'teaching');
  return {
    missions,
    carriers,
    library:
      tech?.src === 'S' && library && source?.t === 'library'
        ? { building: library.id, level: source.level }
        : null,
    academy: tech?.src === 'N' && tech.mentor === 'academy' ? (teaching?.id ?? null) : null,
  };
}
