/**
 * Imports the MVP slice (docs/.../slice.json, balance.json) into normalized, typed content:
 *   src/packs/core/data/generated/*.json   structured data, no display text
 *   src/packs/core/locales/uk.json       every display string, keyed `<kind>.<id>.<field>`
 * The import is idempotent: running it twice leaves the files byte-identical.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIGHT_SKILL_IDS,
  FIRST_FIGHT_FLAG,
  NATURE_IDS,
  OPEN_SKILL_IDS,
  ROLE_IDS,
  SKILL_GROUPS,
  SKILL_IDS,
  STATE_IDS,
  TAG_IDS,
  TRAIT_IDS,
  type NatureId,
  type RoleId,
  type StateId,
  type TagId,
  type TraitId,
} from '../src/constants.ts';
import { BALANCE_EXT, BALANCE_OVERRIDE, withOverrides } from '../src/packs/core/balance-ext.ts';
import { localeKey, type LocaleKind } from '../src/keys.ts';
import {
  balanceParamsSchema,
  generatedDbSchema,
  type BossBase,
  type BuildingBase,
  type CellBase,
  type GeneratedDb,
  type EnemyBase,
  type Exercise,
  type GearBase,
  type HerbBase,
  type Item,
  type MarketEntry,
  type MissionBase,
  type MissionBasePay,
  type MissionStage,
  type ObstacleBase,
  type PoolCheckpointBase,
  type PracticeBase,
  type Recipe,
  type Region,
  type Seal,
  type Skill,
  type TechniqueBase,
} from '../src/schema.ts';
import { rawBalance, rawMap, rawSlice } from './raw.ts';
import { IdRegistry, type IdTable } from './translit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const docs = resolve(root, '..', '..', 'docs');
const sliceDir = join(docs, 'Shinobi Idle — MVP — зріз і баланс');
const mapPath = join(docs, 'Shinobi Idle — дані й скрипти', 'concept', 'map_data_v3.json');
const outData = join(root, 'src', 'packs', 'core', 'data', 'generated');
const outLocale = join(root, 'src', 'packs', 'core', 'locales', 'uk.json');

const registryPath = join(root, 'src', 'packs', 'core', 'id-registry.json');
const assignIds = process.argv.includes('--assign-ids');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const slice = rawSlice.parse(readJson(join(sliceDir, 'slice.json')));
const bal = rawBalance.parse(readJson(join(sliceDir, 'balance.json')));
const map = rawMap.parse(readJson(mapPath));

const ids = new IdRegistry(
  existsSync(registryPath) ? (readJson(registryPath) as IdTable) : {},
  assignIds,
);

// ---------- helpers ----------

const locale: Record<string, string> = {};
const text = (kind: LocaleKind, id: string, field: string, value: string | null | undefined) => {
  if (value === null || value === undefined || value === '') return;
  const key = localeKey(kind, id, field);
  if (key in locale) throw new Error(`Duplicate locale key ${key}`);
  locale[key] = value;
};

const core = (slug: string) => `core:${slug}`;

/** Looks an entry up or fails the import with a readable message. */
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Import: ${what}`);
  return value;
}

const ROLE_BY_UK: Record<string, RoleId> = {
  Снаряд: 'projectile',
  Серія: 'series',
  Площа: 'area',
  Контроль: 'control',
  Захист: 'defense',
  Посилення: 'buff',
  Сигнатурна: 'signature',
  Тренування: 'drill',
};
const TAG_BY_UK: Record<string, TagId> = {
  Переривання: 'interrupt',
  Площа: 'area',
  Захист: 'guard',
  Виявлення: 'reveal',
  Сковування: 'bind',
  'Тривала шкода': 'dot',
  Пробиття: 'pierce',
  Очищення: 'cleanse',
  Розсіювання: 'dispel',
};
const TRAIT_BY_UK: Record<string, TraitId> = {
  Броня: 'armor',
  Кастер: 'caster',
  Зграя: 'pack',
  Ухильний: 'evasive',
  Регенерація: 'regen',
  Ілюзіоніст: 'illusionist',
  Прихований: 'hidden',
  Отруйник: 'poisoner',
};
const STATE_BY_UK: Record<string, StateId> = { Горіння: 'burn', Оглушення: 'stun', Мокрий: 'wet' };
const GROUP_NAMES: Record<(typeof SKILL_GROUPS)[number], string> = {
  train: 'Тренувальні',
  nin: 'Ніндзюцу',
  field: 'Польові',
  craft: 'Ремесла',
  combat: 'Бойові',
};

const invert = <K extends string>(m: Record<string, K>): [K, string][] =>
  Object.entries(m).map(([uk, id]) => [id, uk]);
for (const [id, uk] of invert(ROLE_BY_UK)) text('role', id, 'name', uk);
for (const [id, uk] of invert(TAG_BY_UK)) text('tag', id, 'name', uk);
for (const [id, uk] of invert(TRAIT_BY_UK)) text('trait', id, 'name', uk);
for (const [id, uk] of invert(STATE_BY_UK)) text('state', id, 'name', uk);
for (const [id, uk] of Object.entries(GROUP_NAMES)) text('group', id, 'name', uk);
for (const id of ROLE_IDS) need(locale[localeKey('role', id, 'name')], `role ${id} has no name`);
for (const id of TAG_IDS) need(locale[localeKey('tag', id, 'name')], `tag ${id} has no name`);
for (const id of TRAIT_IDS) need(locale[localeKey('trait', id, 'name')], `trait ${id} has no name`);
for (const id of STATE_IDS) need(locale[localeKey('state', id, 'name')], `state ${id} has no name`);

const tag = (uk: string): TagId => need(TAG_BY_UK[uk], `unknown tag "${uk}"`);
const trait = (uk: string): TraitId => need(TRAIT_BY_UK[uk], `unknown trait "${uk}"`);

// ---------- skills ----------

const skills: Skill[] = SKILL_IDS.map((id) => {
  const n = need(
    map.N.find((x) => x.id === id),
    `skill ${id} missing in map data`,
  );
  const group = n.g as Skill['group'];
  if (!SKILL_GROUPS.includes(group)) throw new Error(`Import: skill ${id} has group ${n.g}`);
  text('skill', id, 'name', n.name);
  text('skill', id, 'desc', n.lore);
  text('skill', id, 'unlock', n.unlock);
  const open = (OPEN_SKILL_IDS as readonly string[]).includes(id);
  const fight = (FIGHT_SKILL_IDS as readonly string[]).includes(id);
  const unlockReq: Skill['unlockReq'] = open
    ? null
    : fight
      ? { t: 'flag', id: FIRST_FIGHT_FLAG }
      : (NATURE_IDS as readonly string[]).includes(id)
        ? { t: 'nature', nature: id as NatureId }
        : { t: 'rank', rank: 'genin' };
  return { id, group, activity: n.mt ?? 'none', unlockReq };
});
for (const nat of NATURE_IDS)
  need(
    skills.find((s) => s.id === nat),
    `nature ${nat}`,
  );

// ---------- seals and techniques ----------

const seals: Seal[] = Object.entries(slice.seals).map(([key, s]) => {
  const id = core(key);
  text('seal', id, 'name', s.uk);
  return { id, glyph: s.glyph, romaji: s.jp, kind: s.kind as Seal['kind'] };
});

const english: Record<string, string> = {};
const techByUk = new Map<string, string>();
/** The base cast of a technique: its hand-set number, else the cast of its rank times that of its role (a drill has no rank: the band of its level, as the balance model has it). */
const castOf = (t: {
  rank: string;
  role: string;
  level: number;
  castOverride?: number | undefined;
}): number => {
  if (t.castOverride !== undefined) return t.castOverride;
  const byRank = need(
    bal.params.castByRank as Record<string, number> | undefined,
    'balance castByRank',
  );
  const byRole = need(
    bal.params.castByRole as Record<string, number> | undefined,
    'balance castByRole',
  );
  const rank = t.rank === '—' ? (t.level < 30 ? 'D' : t.level < 50 ? 'C' : 'B') : t.rank;
  return (
    need(byRank[rank], `cast of rank ${rank}`) * need(byRole[t.role], `cast of role ${t.role}`)
  );
};
const techniques: TechniqueBase[] = slice.techniques.map((t) => {
  techByUk.set(t.uk, t.id);
  text('technique', t.id, 'name', t.uk);
  english[localeKey('technique', t.id, 'name')] = t.en;
  text('technique', t.id, 'home', t.home);
  text('technique', t.id, 'home2', t.home2);
  text('technique', t.id, 'req', t.req);
  text('technique', t.id, 'note', t.note);
  return {
    id: t.id,
    skill: t.skill as TechniqueBase['skill'],
    level: t.level,
    rank: t.rank === '—' ? null : (t.rank as TechniqueBase['rank']),
    rankCanon: t.rankCanon,
    role: need(ROLE_BY_UK[t.role], `unknown role "${t.role}"`),
    tags: t.tags.map(tag),
    state: t.state === '' ? null : need(STATE_BY_UK[t.state], `unknown state "${t.state}"`),
    src: t.src as TechniqueBase['src'],
    mentor: t.src === 'N' ? (t.home === 'Академія' ? 'academy' : 'other') : null,
    sealSeq: t.sealSeq.map(core),
    sealsCanon: t.sealsCanon,
    tier: t.tier as TechniqueBase['tier'],
    noDamage: t.noDamage,
    cast: Math.round(castOf(t) * 1000) / 1000,
  };
});
const techId = (uk: string) => need(techByUk.get(uk), `technique "${uk}" is not in the slice`);

// ---------- masteries ----------

const exerciseSlugs = { take: (k: string) => ids.take('exercise', k) };
const exercises: Exercise[] = slice.exercises.map((e) => {
  const id = core(exerciseSlugs.take(e.uk));
  text('exercise', id, 'name', e.uk);
  text('exercise', id, 'desc', e.note);
  return { id, level: e.level };
});

const obstacleSlugs = { take: (k: string) => ids.take('obstacle', k) };
const obstacles: ObstacleBase[] = slice.obstacles.map((o) => {
  const m = /^Слот (\d+): (.+)$/.exec(o.uk);
  if (!m) throw new Error(`Import: obstacle "${o.uk}" has no slot number`);
  const id = core(obstacleSlugs.take(m[2] ?? o.uk));
  text('obstacle', id, 'name', m[2]);
  text('obstacle', id, 'desc', o.note);
  return { id, level: o.level, slot: Number(m[1]) };
});

const skillByName = new Map(
  skills.map((s) => [need(locale[localeKey('skill', s.id, 'name')], s.id), s.id]),
);
const practiceSlugs = { take: (k: string) => ids.take('practice', k) };
const practices: PracticeBase[] = slice.practices.map((p) => {
  const id = core(practiceSlugs.take(p.uk));
  const pair = p.pair.split(' + ').map((n) => need(skillByName.get(n), `practice skill "${n}"`));
  p.insight.forEach((s, i) => text('practice', id, `insight.${i}`, s));
  p.enlight.forEach((s, i) => text('practice', id, `enlight.${i}`, s));
  text('practice', id, 'name', p.uk);
  return {
    id,
    level: p.level,
    pair: pair as PracticeBase['pair'],
    insight: p.insight.length,
    enlight: p.enlight.length,
  };
});

const pools: PoolCheckpointBase[] = Object.entries(slice.pools).flatMap(([skill, list]) =>
  list.map((p) => {
    const id = core(`pool_${skill}_${p.pct}`);
    text('pool', id, 'desc', p.text);
    return { id, skill: skill as PoolCheckpointBase['skill'], pct: p.pct };
  }),
);

// ---------- items, herbs, recipes ----------

const items: Item[] = [];
const itemIds = new Set<string>();
const addItem = (item: Item, name: string, desc: string | undefined) => {
  if (itemIds.has(item.id)) throw new Error(`Import: duplicate item ${item.id}`);
  itemIds.add(item.id);
  items.push(item);
  text('item', item.id, 'name', name);
  text('item', item.id, 'desc', desc);
};
const itemName = (id: string) => need(map.ITEMS[id], `item ${id} missing in map data`)[0];
const itemDesc = (id: string) => need(map.ITEMS[id], `item ${id} missing in map data`)[2];

const herbs: HerbBase[] = slice.herbs.map((h) => ({ id: core(h.id), level: h.level }));

// Recipe ids come from the Ukrainian name; the antidote keeps a readable id because missions use it.
const recipeSlugs = { take: (k: string, forced?: string) => ids.take('recipe', k, forced) };
const recipes: Recipe[] = slice.recipes.map((r) => {
  const slug = recipeSlugs.take(r.uk, r.uk === 'Протиотрута' ? 'antidote' : undefined);
  const id = core(slug);
  text('recipe', id, 'name', r.uk);
  text('recipe', id, 'desc', r.act);
  return {
    id,
    skill: r.skill as Recipe['skill'],
    level: r.level,
    ingredients: r.ing.map(([item, n]) => ({ item: core(item), n })),
    output: { item: id, n: r.out },
    tags: r.tags.map(tag),
  };
});
const recipeByUk = new Map(slice.recipes.map((r, i) => [r.uk, need(recipes[i], r.uk)]));

// Ingredient items: herbs and market goods.
const ingredientIds: string[] = [
  ...slice.herbs.map((h) => h.id),
  ...slice.market.map(([id]) => id),
];
const CRATE_GOODS = new Set(['oil', 'salt', 'spice']);
for (const raw of ingredientIds) {
  addItem(
    {
      id: core(raw),
      kind: 'ingredient',
      tags: [],
      extraSources: CRATE_GOODS.has(raw) ? ['crate'] : [],
      madeFrom: [],
    },
    itemName(raw),
    itemDesc(raw),
  );
}

// Tools.
const FORGE_TOOLS = new Set(['kunai', 'shuriken', 'senbon', 'wire', 'wiretrap']);
const poisonItem = (uk: string) => need(recipeByUk.get(uk), `poison "${uk}"`).output.item;
const madeFrom: Record<string, { item: string; n: number }[]> = {
  wiretrap: [{ item: core('wire'), n: 2 }],
};
for (const c of slice.coat) {
  const toolId = Object.entries(slice.tools).find(([, t]) => t[0] === c.out)?.[0];
  madeFrom[need(toolId, `coat output "${c.out}"`)] = [
    { item: core(c.base), n: c.n },
    { item: poisonItem(c.poison), n: 1 },
  ];
}
for (const [raw, [name, , use, tags]] of Object.entries(slice.tools)) {
  addItem(
    {
      id: core(raw),
      kind: 'tool',
      tags: tags.map(tag),
      extraSources: FORGE_TOOLS.has(raw) ? ['forge'] : [],
      madeFrom: madeFrom[raw] ?? [],
    },
    name,
    use,
  );
}
for (const [raw, [name, , use]] of Object.entries(slice.misc)) {
  addItem({ id: core(raw), kind: 'misc', tags: [], extraSources: [], madeFrom: [] }, name, use);
}
for (const r of recipes) {
  addItem(
    {
      id: r.output.item,
      kind: 'consumable',
      tags: r.tags,
      extraSources: [],
      madeFrom: [],
    },
    need(locale[localeKey('recipe', r.id, 'name')], r.id),
    locale[localeKey('recipe', r.id, 'desc')],
  );
}

// ---------- buildings, market, gear ----------

const buildingByName = new Map<string, string>();
const resSlugs = { take: (k: string) => ids.take('resource', k) };
const resByName = new Map<string, string>();
const resource = (uk: string): string => {
  let slug = resByName.get(uk);
  if (slug === undefined) {
    slug = resSlugs.take(uk);
    resByName.set(uk, slug);
    text('resource', slug, 'name', uk);
  }
  return slug;
};
const buildings: BuildingBase[] = slice.buildings.map(([raw, name, desc, hasT6, res]) => {
  const id = core(raw);
  buildingByName.set(name, id);
  text('building', id, 'name', name);
  text('building', id, 'desc', desc);
  const tier6 =
    hasT6 && res ? Object.fromEntries(Object.entries(res).map(([k, v]) => [resource(k), v])) : null;
  return { id, tier6 };
});

const market: MarketEntry[] = slice.market.map(([raw, supplier, lvl]) => ({
  item: core(raw),
  supplier: supplier === '—' ? null : need(buildingByName.get(supplier), `supplier "${supplier}"`),
  marketLevel: lvl,
}));

const gearSlugs = { take: (k: string) => ids.take('gear', k) };
const gear: GearBase[] = slice.gear.map(([name, skill, tiers, effect]) => {
  const id = core(gearSlugs.take(name));
  text('gear', id, 'name', name);
  text('gear', id, 'desc', effect);
  return {
    id,
    skill: skill as GearBase['skill'],
    tiers: tiers.map(([tier, level, req]) => {
      let building: { id: string; level: number } | null = null;
      if (req) {
        const m = /^(.+) (\d+)$/.exec(req);
        if (!m) throw new Error(`Import: gear requirement "${req}"`);
        building = {
          id: need(buildingByName.get(m[1] ?? ''), `building "${m[1]}"`),
          level: Number(m[2]),
        };
      }
      return { tier, level, building };
    }),
  };
});

// ---------- enemies, bosses ----------

const balEnemy = new Map(bal.enemies.map((e) => [e.id, e]));
const nature = (v: string | null): EnemyBase['nature'] => {
  if (v === null) return null;
  if (v === 'wheel' || (NATURE_IDS as readonly string[]).includes(v))
    return v as EnemyBase['nature'];
  throw new Error(`Import: enemy nature "${v}"`);
};
type EnemyRow = [string, string, string, number, string[], string | null, string | null];
const enemyBase = (kind: 'enemy' | 'boss', [raw, name, , cl, traits, nat, carries]: EnemyRow) => {
  const id = core(raw);
  const b = need(balEnemy.get(raw), `balance entry for ${kind} ${raw}`);
  if (b.cl !== cl) throw new Error(`Import: ${raw} level differs between slice and balance`);
  text(kind, id, 'name', name);
  return {
    id,
    cl,
    traits: traits.map(trait),
    nature: nature(nat),
    carries: carries === null ? null : techId(carries),
    hp: b.hp,
    dmg: b.dmg,
  };
};
const enemies: EnemyBase[] = slice.enemies.map((row) => ({
  ...enemyBase('enemy', row),
  region: row[2] as EnemyBase['region'],
}));
const bosses: BossBase[] = slice.bosses.map((row) => {
  const base = enemyBase('boss', [row[0], row[1], row[2], row[3], row[4], row[5], row[6]]);
  text('boss', base.id, 'place', row[2]);
  text('boss', base.id, 'desc', row[7]);
  return base;
});

// ---------- missions ----------

const enemyIds = new Set([...enemies, ...bosses].map((e) => e.id));
const balMission = new Map(bal.missions.map((m) => [m.id, m]));
const missions: MissionBase[] = slice.missions.map((m) => {
  const id = core(m.id);
  const b = need(balMission.get(m.id), `balance entry for mission ${m.id}`);
  text('mission', id, 'name', m.name);
  text('mission', id, 'client', m.client);
  const stages: MissionStage[] = m.stages.map((s, i) => {
    switch (s.t) {
      case 'skill':
        text('mission', id, `stage.${i}.label`, s.label);
        return { t: 'skill', skill: s.s as Skill['id'], min: s.min, label: s.label !== '' };
      case 'tech':
        text('mission', id, `stage.${i}.label`, s.label);
        return {
          t: 'tech',
          any: s.any.map(([skill, min]) => ({ skill: skill as Skill['id'], min })),
          label: s.label !== '',
        };
      case 'named':
        return { t: 'named', technique: techId(s.tech), alts: s.alts.map(techId) };
      case 'combat': {
        const enemy = core(s.enemy);
        if (!enemyIds.has(enemy))
          throw new Error(`Import: mission ${m.id} fights unknown ${s.enemy}`);
        return { t: 'combat', enemy };
      }
      case 'items':
        return { t: 'items', item: core(s.item), n: s.n };
    }
  });
  const pay: MissionBasePay[] = (m.pay ?? []).map((p) => {
    if (p === 'intel') return { kind: 'intel' };
    if (p.startsWith('scrollpart:'))
      return { kind: 'scrollPart', technique: techId(p.slice('scrollpart:'.length)) };
    return { kind: 'item', item: core(p) };
  });
  return {
    id,
    rank: m.rk as MissionBase['rank'],
    team: m.team,
    minutes: m.min,
    stages,
    pay,
    resource: m.res ? resource(m.res) : null,
    ryo: b.ryo,
    rep: b.rep,
  };
});

// ---------- regions and cells ----------

const cellSlugs = { take: (k: string) => ids.take('cell', k) };
const cells: CellBase[] = [];
const regions: Region[] = slice.regions.map((r) => {
  const id = core(r.id);
  text('region', id, 'name', r.name);
  const cellIds = r.cells.map(([name, key, note], index) => {
    const cid = core(cellSlugs.take(name));
    text('cell', cid, 'name', name);
    text('cell', cid, 'note', note);
    cells.push({
      id: cid,
      region: id,
      index,
      key: key as CellBase['key'],
      story: /^Сюжет/.test(note ?? ''),
    });
    return cid;
  });
  return { id, scout: r.scout, cells: cellIds };
});

// ---------- balance ----------

const roleKeys = new Map(Object.entries(ROLE_BY_UK));
const rawParams = bal.params;
const rawRole = rawParams.role as Record<string, unknown>;
const params = balanceParamsSchema.parse({
  ...withOverrides({ ...BALANCE_EXT, ...rawParams }, BALANCE_OVERRIDE),
  role: Object.fromEntries(
    Object.entries(rawRole).map(([uk, v]) => [need(roleKeys.get(uk), `balance role "${uk}"`), v]),
  ),
  castByRole: Object.fromEntries(
    Object.entries(rawParams.castByRole as Record<string, number>).map(([uk, v]) => [
      need(roleKeys.get(uk), `balance castByRole "${uk}"`),
      v,
    ]),
  ),
});
const balance = { K: params, pace: bal.pace, capHours: bal.capHours, milestones: bal.milestones };

// ---------- assemble, validate, write ----------

const db: GeneratedDb = generatedDbSchema.parse({
  skills,
  seals,
  techniques,
  exercises,
  practices,
  obstacles,
  herbs,
  pools,
  items,
  market,
  recipes,
  missions,
  regions,
  cells,
  enemies,
  bosses,
  buildings,
  gear,
  balance,
});

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
if (ids.dirty) writeFileSync(registryPath, json(ids.table));
mkdirSync(outData, { recursive: true });
mkdirSync(dirname(outLocale), { recursive: true });
for (const [name, value] of Object.entries(db))
  writeFileSync(join(outData, `${name}.json`), json(value));
const sorted = Object.fromEntries(
  Object.entries(locale).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
writeFileSync(outLocale, json(sorted));
writeFileSync(
  join(dirname(outLocale), 'en.json'),
  json(
    Object.fromEntries(Object.entries(english).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  ),
);

console.log(
  `Imported ${Object.keys(db).length} data files and ${Object.keys(sorted).length} locale strings.`,
);
