import type {
  Boss,
  ContentDb,
  Cell,
  Enemy,
  Exam,
  Exercise,
  Gear,
  Herb,
  Hex,
  Item,
  Mission,
  Nature,
  PlayerRankData,
  Place,
  Terrain,
  Skill,
  Obstacle,
  Operation,
  Poi,
  PoolCheckpoint,
  Practice,
  Quest,
  Raid,
  Region,
  Recipe,
  ShopEntry,
  Technique,
  Zone,
} from '@shinobi/content';
import type { Req } from './requirements.ts';

/** Id lookups over a content database, built once per database. */
export interface ContentIndex {
  techniques: Map<string, Technique>;
  exercises: Map<string, Exercise>;
  practices: Map<string, Practice>;
  obstacles: Map<string, Obstacle>;
  enemies: Map<string, Enemy>;
  bosses: Map<string, Boss>;
  zones: Map<string, Zone>;
  /** The raids on the village, by id; a raid is fought as a `fight` action named by its id. */
  raids: Map<string, Raid>;
  /** The zone that holds each enemy; an enemy of no zone (a mission enemy) has none. */
  zoneByEnemy: Map<string, Zone>;
  /** The items that are a medic pouch upgrade, with their tier. */
  medicItems: { id: string; tier: number }[];
  operations: Map<string, Operation>;
  items: Map<string, Item>;
  missions: Map<string, Mission>;
  herbs: Map<string, Herb>;
  recipes: Map<string, Recipe>;
  /** Recipe by the item it makes. */
  recipeByOutput: Map<string, Recipe>;
  gear: Map<string, Gear>;
  shop: Map<string, ShopEntry>;
  quests: Map<string, Quest>;
  exams: Map<string, Exam>;
  itemIds: Set<string>;
  recipeIds: Set<string>;
  /** Every id that can own a mastery record. */
  masteryKeys: Set<string>;
  /** Number of masteries per skill. */
  masteryCount: Map<string, number>;
  poolCheckpoints: Map<string, PoolCheckpoint[]>;
  cells: Map<string, Cell>;
  /** The hexes of the world grid by key (`q,r`). */
  hexes: Map<string, Hex>;
  terrains: Map<string, Terrain>;
  /** The cell that stands on each hex, by hex key. */
  cellByHex: Map<string, Cell>;
  /** The named places by id. */
  places: Map<string, Place>;
  /** The named places on each hex, by hex key. */
  placesByHex: Map<string, Place[]>;
  /** The hexes of the grid that have a terrain, in the order of the grid. */
  playableHexes: Hex[];
  /** The ways to hexes that are not neighbours, from each end of a link, by hex key; a link is listed at both its ends. */
  linksByHex: Map<string, { id: string; to: string; minutes: number }[]>;
  regions: Map<string, Region>;
  /** Every point of interest with the cell it lies in. */
  pois: Map<string, { poi: Poi; cell: Cell }>;
  /** The cell whose point of interest opens a fight zone. */
  zoneCell: Map<string, Cell>;
  skills: Map<string, Skill>;
  natures: Map<string, Nature>;
  /** Nature ids in list order. */
  natureIds: string[];
  /** The natures that open each kind of key cell, by cell key. */
  keyNatures: Map<string, string[]>;
  /** The player ranks in order, lowest first. */
  ranks: PlayerRankData[];
  rankIndex: Map<string, number>;
  /** The first rank that is not an Academy rank (the graduation), if any. */
  graduateRank: string | null;
  /** The currency that has each role (`money`, `renown`, `study`). */
  currencyByRole: Map<string, string>;
  currencyIds: Set<string>;
  /** The first skill of each activity (`drill`, `insight`, `course`, `patch`, `map`): the skill that the action kind of that activity trains. */
  activitySkill: Map<string, string>;
  /** The skills that train techniques (`tech`). */
  techSkills: Set<string>;
}

const cache = new WeakMap<ContentDb, ContentIndex>();

function byId<T extends { id: string }>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((e) => [e.id, e]));
}

/**
 * Everything the shops sell: the market goods and tools of the content, and the scrolls of the
 * Library, each opened by the Library level its source names.
 */
export function shopEntries(content: ContentDb): ShopEntry[] {
  const library = content.buildings.find((b) => b.duty === 'scrolls');
  const scrolls: ShopEntry[] = [];
  for (const item of content.items) {
    const source = item.scroll?.source;
    if (!library || source?.t !== 'library') continue;
    const req = {
      t: 'all',
      of: [graduateReq(content), { t: 'building', id: library.id, level: source.level }],
    } as ShopEntry['req'];
    scrolls.push({ item: item.id, req });
  }
  return [...content.shop, ...scrolls];
}

/** The requirement of having graduated: the first rank that is not an Academy rank. */
export function graduateReq(content: ContentDb): Req {
  const rank = content.playerRanks.find((r) => r.academy !== true) ?? content.playerRanks[0];
  // A game with no rank can never meet it: `any` of nothing does not hold.
  return rank ? { t: 'rank', rank: rank.id } : { t: 'any', of: [] };
}

function build(content: ContentDb): ContentIndex {
  const activitySkill = new Map<string, string>();
  for (const skill of content.skills) {
    if (!activitySkill.has(skill.activity)) activitySkill.set(skill.activity, skill.id);
  }
  const trainer = (activity: string): string => activitySkill.get(activity) ?? '';
  const techniques = byId(content.techniques);
  const exercises = byId(content.exercises);
  const practices = byId(content.practices);
  const obstacles = byId(content.obstacles);
  const masteryKeys = new Set<string>([
    ...techniques.keys(),
    ...exercises.keys(),
    ...practices.keys(),
    ...obstacles.keys(),
    ...content.herbs.map((h) => h.id),
    ...content.recipes.map((r) => r.id),
  ]);
  const masteryCount = new Map<string, number>();
  const count = (skill: string, n: number) =>
    masteryCount.set(skill, (masteryCount.get(skill) ?? 0) + n);
  for (const t of content.techniques) count(t.skill, 1);
  for (const e of content.exercises) count(e.skill ?? trainer('drill'), 1);
  for (const p of content.practices) count(p.skill ?? trainer('insight'), 1);
  count(trainer('course'), content.obstacles.length);
  for (const h of content.herbs) count(h.skill ?? trainer('patch'), 1);
  for (const r of content.recipes) count(r.skill, 1);
  const poolCheckpoints = new Map<string, PoolCheckpoint[]>();
  for (const p of content.pools) {
    const list = poolCheckpoints.get(p.skill) ?? [];
    list.push(p);
    poolCheckpoints.set(p.skill, list);
  }
  const pois = new Map<string, { poi: Poi; cell: Cell }>();
  const zoneCell = new Map<string, Cell>();
  for (const cell of content.cells) {
    for (const poi of cell.pois) {
      pois.set(poi.id, { poi, cell });
      if (poi.kind === 'zone') zoneCell.set(poi.zone, cell);
    }
  }
  const cellByHex = new Map<string, Cell>();
  for (const cell of content.cells) cellByHex.set(`${cell.hex[0]},${cell.hex[1]}`, cell);
  const placesByHex = new Map<string, Place[]>();
  for (const place of content.places) {
    const key = `${place.hex[0]},${place.hex[1]}`;
    placesByHex.set(key, [...(placesByHex.get(key) ?? []), place]);
  }
  const linksByHex = new Map<string, { id: string; to: string; minutes: number }[]>();
  for (const link of content.links) {
    const a = `${link.a[0]},${link.a[1]}`;
    const b = `${link.b[0]},${link.b[1]}`;
    linksByHex.set(a, [
      ...(linksByHex.get(a) ?? []),
      { id: link.id, to: b, minutes: link.minutes },
    ]);
    linksByHex.set(b, [
      ...(linksByHex.get(b) ?? []),
      { id: link.id, to: a, minutes: link.minutes },
    ]);
  }
  return {
    cells: byId(content.cells),
    playableHexes: content.hexes.filter((h) => h.terrain !== undefined),
    linksByHex,
    hexes: new Map(content.hexes.map((h) => [`${h.q},${h.r}`, h])),
    terrains: byId(content.terrains),
    cellByHex,
    places: byId(content.places),
    placesByHex,
    regions: byId(content.regions),
    pois,
    zoneCell,
    enemies: byId(content.enemies),
    bosses: byId(content.bosses),
    zones: byId(content.zones),
    raids: byId(content.raids),
    medicItems: content.items.flatMap((i) =>
      i.medic === undefined ? [] : [{ id: i.id, tier: i.medic }],
    ),
    zoneByEnemy: new Map(content.zones.map((z) => [z.enemy, z])),
    operations: byId(content.operations),
    items: byId(content.items),
    missions: byId(content.missions),
    herbs: byId(content.herbs),
    recipes: byId(content.recipes),
    recipeByOutput: new Map(content.recipes.map((r) => [r.output.item, r])),
    gear: byId(content.gear),
    shop: new Map(shopEntries(content).map((s) => [s.item, s])),
    quests: byId(content.quests),
    exams: byId(content.exams),
    skills: byId(content.skills),
    natures: byId(content.natures),
    natureIds: content.natures.map((n) => n.id),
    keyNatures: new Map(
      Object.keys(content.cellKeys).map((key) => [
        key,
        content.natures.filter((n) => n.opens.includes(key)).map((n) => n.id),
      ]),
    ),
    ranks: [...content.playerRanks],
    rankIndex: new Map(content.playerRanks.map((r, i) => [r.id, i])),
    graduateRank: content.playerRanks.find((r) => r.academy !== true)?.id ?? null,
    currencyByRole: new Map(
      content.currencies.flatMap((c) => (c.role === undefined ? [] : [[c.role, c.id] as const])),
    ),
    currencyIds: new Set(content.currencies.map((c) => c.id)),
    activitySkill,
    techSkills: new Set(content.skills.filter((s) => s.activity === 'tech').map((s) => s.id)),
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
