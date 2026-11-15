import { z } from 'zod';
import {
  CELL_KEYS,
  ENEMY_REGIONS,
  MISSION_RANKS,
  NATURE_IDS,
  RANKS,
  ROLE_IDS,
  SKILL_GROUPS,
  SKILL_IDS,
  STATE_IDS,
  TAG_IDS,
  TECH_SKILL_IDS,
  TRAIT_IDS,
} from './constants.ts';

// ---------- identifiers ----------

/** `core:<slug>` identifier used by every entity except skills. */
export const coreId = z.string().regex(/^core:[a-z0-9_]+$/, 'expected core:<slug>');
export const skillId = z.enum(SKILL_IDS);
export const natureId = z.enum(NATURE_IDS);
export const techSkillId = z.enum(TECH_SKILL_IDS);
export const rankId = z.enum(RANKS);
export const roleId = z.enum(ROLE_IDS);
export const tagId = z.enum(TAG_IDS);
export const traitId = z.enum(TRAIT_IDS);
export const stateId = z.enum(STATE_IDS);

const level = z.number().int().min(1).max(99);
/** A slug for MVP resources such as `plots` or `masonry`; names live in the locale. */
const resSlug = z.string().regex(/^[a-z0-9_]+$/);

// ---------- skills and techniques ----------

/** A requirement tree as plain data. The engine evaluates the same shape (`Req` in core). */
export type ReqData =
  | { t: 'skill'; skill: z.infer<typeof skillId>; level: number }
  | { t: 'technique'; id: string }
  | { t: 'rank'; rank: 'student' | 'genin' | 'chunin' }
  | { t: 'nature'; nature: z.infer<typeof natureId> }
  | { t: 'item'; id: string; n: number }
  | { t: 'quest'; id: string; step?: number }
  | { t: 'building'; id: string; level: number }
  | { t: 'flag'; id: string; n?: number }
  | { t: 'all'; of: ReqData[] }
  | { t: 'any'; of: ReqData[] };

export const reqSchema: z.ZodType<ReqData> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.strictObject({ t: z.literal('skill'), skill: skillId, level }),
    z.strictObject({ t: z.literal('technique'), id: coreId }),
    z.strictObject({ t: z.literal('rank'), rank: z.enum(['student', 'genin', 'chunin']) }),
    z.strictObject({ t: z.literal('nature'), nature: natureId }),
    z.strictObject({ t: z.literal('item'), id: coreId, n: z.number().int().min(1) }),
    z.strictObject({ t: z.literal('quest'), id: z.string(), step: z.number().int().optional() }),
    z.strictObject({ t: z.literal('building'), id: coreId, level: z.number().int() }),
    z.strictObject({ t: z.literal('flag'), id: z.string(), n: z.number().int().optional() }),
    z.strictObject({ t: z.literal('all'), of: z.array(reqSchema) }),
    z.strictObject({ t: z.literal('any'), of: z.array(reqSchema) }),
  ]),
);

export const skillSchema = z.strictObject({
  id: skillId,
  group: z.enum(SKILL_GROUPS),
  /** How the skill is trained: tech, course, drill, insight, patch, map, recipe, station, none. */
  activity: z.string(),
  /** What opens the skill for training; `null` when it is open from the first day. */
  unlockReq: reqSchema.nullable(),
});

export const sealSchema = z.object({
  id: coreId,
  glyph: z.string().min(1),
  romaji: z.string(),
  kind: z.enum(['zodiac', 'special']),
});

export const techniqueSchema = z.strictObject({
  id: coreId,
  skill: techSkillId,
  level,
  /** `null` for training drills, which have no rank. */
  rank: rankId.nullable(),
  /** Whether the rank is canonical (verified against the source). */
  rankCanon: z.boolean(),
  role: roleId,
  tags: z.array(tagId),
  /** State the technique applies, if any. */
  state: stateId.nullable(),
  /** N trainer, S scroll or library, O carrier (boss or enemy), Q quest line. */
  src: z.enum(['N', 'S', 'O', 'Q']),
  /** For trainer techniques: the home Academy or any other mentor. `null` for other sources. */
  mentor: z.enum(['academy', 'other']).nullable(),
  /** Ordered ids of seals needed to cast the technique. */
  sealSeq: z.array(coreId),
  sealsCanon: z.boolean(),
  tier: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  noDamage: z.boolean(),
});

export const exerciseSchema = z.object({ id: coreId, level });

export const practiceSchema = z.strictObject({
  id: coreId,
  level,
  /** The two skills the practice trains together. */
  pair: z.array(skillId).length(2),
  /** Count of insight and enlightenment modifiers (texts are locale keys by index). */
  insight: z.number().int(),
  enlight: z.number().int(),
});

export const obstacleSchema = z.object({ id: coreId, level, slot: z.number().int().min(1) });

export const herbSchema = z.object({ id: coreId, level });

export const poolCheckpointSchema = z.object({
  id: coreId,
  skill: skillId,
  pct: z.number().int(),
});

// ---------- items and recipes ----------

export const ingredientRef = z.object({ item: coreId, n: z.number().int().min(1) });

export const itemSchema = z.strictObject({
  id: coreId,
  kind: z.enum(['ingredient', 'tool', 'misc', 'consumable']),
  /** Tags the item carries (tools answer enemy traits). */
  tags: z.array(tagId),
  /** Extra sources that the data tables do not express: a merchant crate or the forge. */
  extraSources: z.array(z.enum(['crate', 'forge'])),
  /** What a crafted tool is made from. */
  madeFrom: z.array(ingredientRef),
});

export const marketEntrySchema = z.object({
  item: coreId,
  /** Building that supplies the goods, if any. */
  supplier: coreId.nullable(),
  /** Market building level that unlocks the entry. */
  marketLevel: z.number().int(),
});

export const recipeSchema = z.object({
  id: coreId,
  skill: z.enum(['alch', 'prov']),
  level,
  ingredients: z.array(ingredientRef).min(1),
  /** Item produced and how many per craft. */
  output: ingredientRef,
  tags: z.array(tagId),
});

// ---------- missions ----------

const stageLabel = z.boolean();

export const missionStageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('skill'), skill: skillId, min: z.number().int(), label: stageLabel }),
  z.object({
    t: z.literal('tech'),
    any: z.array(z.object({ skill: skillId, min: z.number().int() })).min(1),
    label: stageLabel,
  }),
  z.object({ t: z.literal('named'), technique: coreId, alts: z.array(coreId) }),
  z.object({ t: z.literal('combat'), enemy: coreId }),
  z.object({ t: z.literal('items'), item: coreId, n: z.number().int().min(1) }),
]);

export const missionPaySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), item: coreId }),
  z.object({ kind: z.literal('intel') }),
  z.object({ kind: z.literal('scrollPart'), technique: coreId }),
]);

export const missionSchema = z.strictObject({
  id: coreId,
  rank: z.enum(MISSION_RANKS),
  team: z.boolean(),
  /** Duration in minutes. */
  minutes: z.number().int().min(0),
  stages: z.array(missionStageSchema).min(1),
  pay: z.array(missionPaySchema),
  /** Village resource gained, for village missions. */
  resource: resSlug.nullable(),
  ryo: z.number(),
  rep: z.number(),
});

// ---------- world ----------

export const cellSchema = z.object({
  id: coreId,
  region: coreId,
  index: z.number().int().min(0),
  key: z.enum(CELL_KEYS).nullable(),
  /** Whether the cell hosts a story event. */
  story: z.boolean(),
});

export const regionSchema = z.object({
  id: coreId,
  /** Scouting level that opens the region. */
  scout: z.number().int(),
  cells: z.array(coreId),
});

export const enemySchema = z.strictObject({
  id: coreId,
  region: z.enum(ENEMY_REGIONS),
  cl: z.number().int(),
  traits: z.array(traitId),
  /** A nature, `wheel` (counters the player's first nature) or none. */
  nature: z.union([natureId, z.literal('wheel')]).nullable(),
  /** Technique the enemy carries and can pass on. */
  carries: coreId.nullable(),
  hp: z.number(),
  dmg: z.number(),
});

/** A boss has no region field: its place is a localized string. */
export const bossSchema = enemySchema.omit({ region: true });

export const buildingSchema = z.object({
  id: coreId,
  /** Resources needed for level 6, keyed by resource slug; `null` when the building has none. */
  tier6: z.record(resSlug, z.number()).nullable(),
});

export const gearTierSchema = z.object({
  tier: z.string(),
  level,
  building: z.object({ id: coreId, level: z.number().int() }).nullable(),
});

export const gearSchema = z.object({
  id: coreId,
  skill: skillId,
  tiers: z.array(gearTierSchema).min(1),
});

// ---------- balance ----------

const pair = z.tuple([z.number(), z.number()]);
const byRank = z.record(rankId, z.number());

export const balanceParamsSchema = z.object({
  cap: z.number().int(),
  rateBase: z.number(),
  rateGrowth: z.number(),
  nativeXp: z.number(),
  craftXpMult: z.number(),
  masteryPerHour: z.number(),
  poolShare: z.number(),
  poolCapPerItem: z.number(),
  practiceRecovery: z.number(),
  practiceMin: z.number(),
  drill: z.number(),
  meditate: z.number(),
  obstacle: z.number(),
  gather: z.number(),
  craft: z.number(),
  explore: z.number(),
  castBase: z.number(),
  castPerSeal: z.number(),
  masteryCast: z.number(),
  castFloor: z.number(),
  nonNativeCast: z.number(),
  power: byRank,
  tierMult: z.object({ '0': z.number(), '1': z.number(), '-1': z.number() }),
  role: z.record(roleId, z.object({ m: z.number(), cd: z.number(), c: z.number() })),
  rankCd: byRank,
  chakraCost: byRank,
  staminaCost: byRank,
  levelScale: z.number(),
  masteryDmg: z.number(),
  masteryCost: z.number(),
  burn: z.object({ share: z.number(), dur: z.number() }),
  wet: z.object({ slow: z.number(), dur: z.number() }),
  stun: z.object({ C: z.number(), B: z.number(), D: z.number() }),
  bind: z.object({ dur: z.number() }),
  poison: z.object({ pctPerSec: z.number(), dur: z.number() }),
  combo: z.object({
    base: z.number(),
    perLevel: z.number(),
    perMastery: z.number(),
    cap: z.number(),
    fanBurn: z.number(),
    shockWet: z.number(),
    mudEva: z.number(),
    steam: z.number(),
  }),
  wheel: z.number(),
  habituation: z.number(),
  habituationCap: z.number(),
  signatureHabituation: z.number(),
  hpBase: z.number(),
  hpPerVit: z.number(),
  chakraBase: z.number(),
  chakraPerMed: z.number(),
  chakraRegen: pair,
  staminaBase: z.number(),
  staminaPerAth: z.number(),
  staminaRegen: pair,
  accBase: z.number(),
  accPerLevel: z.number(),
  evaBase: z.number(),
  evaPerLevel: z.number(),
  hitMin: z.number(),
  hitMax: z.number(),
  basicInterval: z.number(),
  basicDmg: pair,
  dodgeStamina: z.number(),
  ccCostPerLevel: z.number(),
  pillAction: z.number(),
  pouchStack: z.number(),
  pillAt: z.number(),
  food: z.array(pair),
  toolTag: pair,
  zoneHpRegen: z.number(),
  opRegen: z.number(),
  respawn: z.number(),
  wound: z.object({
    stat: z.number(),
    max: z.number(),
    healMin: z.number(),
    healFloorMin: z.number(),
  }),
  eHp: pair,
  eDmg: pair,
  eInterval: z.number(),
  eAcc: pair,
  eEva: pair,
  boss: z.object({ hp: z.number(), dmg: z.number() }),
  pack: z.object({ n: z.number(), hp: z.number(), dmg: z.number() }),
  trait: z.object({
    armor: z.number(),
    armorOff: z.number(),
    casterEvery: z.number(),
    casterCast: z.number(),
    casterMult: z.number(),
    evasive: z.number(),
    regenPct: z.number(),
    illusionEvery: z.number(),
    illusionDur: z.number(),
    illusionAcc: z.number(),
    hidden: z.number(),
    hiddenAcc: z.number(),
    hiddenFirst: z.number(),
    poisonChance: z.number(),
  }),
  combatXp: z.object({ style: z.number(), vit: z.number(), eva: z.number() }),
  ryoPerMin: z.object({ D: z.number(), C: z.number(), V: z.number(), OP: z.number() }),
  repPerMission: z.object({ D: z.number(), C: z.number(), V: z.number() }),
  missionXpShare: z.number(),
  missionRateCap: z.object({ D: z.number(), C: z.number(), V: z.number() }),
  shinobiResPerMission: z.number(),
  scroll: z.record(z.string(), z.number()),
  gearTier: z.array(z.number()),
  obstacleBase: z.number(),
  goods: z.record(z.string(), z.number()),
  travel: z.array(z.number()),
  bounty: z.record(z.string(), z.number()),
  bountyRepeat: z.number(),
  rep: z.object({
    stage2: z.number(),
    exam: z.number(),
    boss: z.number(),
    questFinal: z.number(),
  }),
  intel: z.object({
    perCellLevel: z.number(),
    mail: z.number(),
    track: pair,
    caravanSkip: z.number(),
    bingoLevel: z.number(),
    writtenTestPerIntel: z.number(),
    writtenTestMaxIntel: z.number(),
  }),
  partsPerScroll: z.number(),
  partDrop: z.object({ boss: z.number(), carrier: z.number(), mission: z.number() }),
  tickMin: z.number(),
  prod: z.number(),
  costBase: z.number(),
  costMult: z.array(z.number()),
  treasuryBase: z.number(),
  buildTicks: z.array(z.number()),
  bureauIncome: z.number(),
  storeCap: pair,
  shinobiCap: pair,
  shinobiT6: z.number(),
  towerStageMax: pair,
  cellExplores: z.array(z.number()),
  cellLevelStep: z.number(),
  clone: z.object({ pool: z.number(), link: z.number() }),
  academyCap: z.number().int(),
  academySlow: z.number(),
  offlineCapHours: z.number(),
  masteryCap: z.number().int(),
});

/** The balance parameter object, referred to as `K` in the formulas. */
export type K = z.infer<typeof balanceParamsSchema>;

export const balanceSchema = z.object({
  K: balanceParamsSchema,
  /** Target hours per level band for each skill. */
  pace: z.record(z.string(), z.array(z.number())),
  capHours: z.number(),
  milestones: z.record(z.string(), z.number()),
});

// ---------- the whole database ----------

export const contentDbSchema = z.object({
  skills: z.array(skillSchema),
  seals: z.array(sealSchema),
  techniques: z.array(techniqueSchema),
  exercises: z.array(exerciseSchema),
  practices: z.array(practiceSchema),
  obstacles: z.array(obstacleSchema),
  herbs: z.array(herbSchema),
  pools: z.array(poolCheckpointSchema),
  items: z.array(itemSchema),
  market: z.array(marketEntrySchema),
  recipes: z.array(recipeSchema),
  missions: z.array(missionSchema),
  regions: z.array(regionSchema),
  cells: z.array(cellSchema),
  enemies: z.array(enemySchema),
  bosses: z.array(bossSchema),
  buildings: z.array(buildingSchema),
  gear: z.array(gearSchema),
  balance: balanceSchema,
});

export type Skill = z.infer<typeof skillSchema>;
export type Seal = z.infer<typeof sealSchema>;
export type Technique = z.infer<typeof techniqueSchema>;
export type Exercise = z.infer<typeof exerciseSchema>;
export type Practice = z.infer<typeof practiceSchema>;
export type Obstacle = z.infer<typeof obstacleSchema>;
export type Herb = z.infer<typeof herbSchema>;
export type PoolCheckpoint = z.infer<typeof poolCheckpointSchema>;
export type Item = z.infer<typeof itemSchema>;
export type MarketEntry = z.infer<typeof marketEntrySchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type MissionStage = z.infer<typeof missionStageSchema>;
export type MissionPay = z.infer<typeof missionPaySchema>;
export type Mission = z.infer<typeof missionSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type Region = z.infer<typeof regionSchema>;
export type Enemy = z.infer<typeof enemySchema>;
export type Boss = z.infer<typeof bossSchema>;
export type Building = z.infer<typeof buildingSchema>;
export type GearTier = z.infer<typeof gearTierSchema>;
export type Gear = z.infer<typeof gearSchema>;
export type Balance = z.infer<typeof balanceSchema>;
export type ContentDb = z.infer<typeof contentDbSchema>;
