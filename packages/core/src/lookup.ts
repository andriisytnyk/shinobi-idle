import type {
  ContentDb,
  Exercise,
  Obstacle,
  PoolCheckpoint,
  Practice,
  Technique,
} from '@shinobi/content';

/** Id lookups over a content database, built once per database. */
export interface ContentIndex {
  techniques: Map<string, Technique>;
  exercises: Map<string, Exercise>;
  practices: Map<string, Practice>;
  obstacles: Map<string, Obstacle>;
  itemIds: Set<string>;
  recipeIds: Set<string>;
  /** Every id that can own a mastery record. */
  masteryKeys: Set<string>;
  /** Number of masteries per skill. */
  masteryCount: Map<string, number>;
  poolCheckpoints: Map<string, PoolCheckpoint[]>;
}

const cache = new WeakMap<ContentDb, ContentIndex>();

function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((e) => [e.id, e]));
}

function build(content: ContentDb): ContentIndex {
  const techniques = byId(content.techniques);
  const exercises = byId(content.exercises);
  const practices = byId(content.practices);
  const obstacles = byId(content.obstacles);
  const masteryKeys = new Set<string>([
    ...techniques.keys(),
    ...exercises.keys(),
    ...practices.keys(),
    ...obstacles.keys(),
  ]);
  const masteryCount = new Map<string, number>();
  const count = (skill: string, n: number) =>
    masteryCount.set(skill, (masteryCount.get(skill) ?? 0) + n);
  for (const t of content.techniques) count(t.skill, 1);
  count('cc', content.exercises.length);
  count('med', content.practices.length);
  count('ath', content.obstacles.length);
  count('herb', content.herbs.length);
  for (const r of content.recipes) count(r.skill, 1);
  const poolCheckpoints = new Map<string, PoolCheckpoint[]>();
  for (const p of content.pools) {
    const list = poolCheckpoints.get(p.skill) ?? [];
    list.push(p);
    poolCheckpoints.set(p.skill, list);
  }
  return {
    techniques,
    exercises,
    practices,
    obstacles,
    itemIds: new Set(content.items.map((i) => i.id)),
    recipeIds: new Set(content.recipes.map((r) => r.id)),
    masteryKeys,
    masteryCount,
    poolCheckpoints,
  };
}

export function indexOf(content: ContentDb): ContentIndex {
  let index = cache.get(content);
  if (!index) {
    index = build(content);
    cache.set(content, index);
  }
  return index;
}
