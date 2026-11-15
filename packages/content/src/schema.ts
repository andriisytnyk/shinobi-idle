import { z } from 'zod';
import {
  ATTACK_STYLES,
  CELL_KEYS,
  COMBO_IDS,
  ENEMY_REGIONS,
  STATUS_IDS,
  ZONE_REGIONS,
  MISSION_RANKS,
  NATURE_IDS,
  PLAYER_RANK_IDS,
  RANKS,
  ROLE_IDS,
  SKILL_GROUPS,
  SKILL_IDS,
  STATE_IDS,
  TAG_IDS,
  TECH_SKILL_IDS,
  TRAIT_IDS,
  type NatureId,
  type PlayerRank,
  type SkillId,
} from './constants.ts';

// ---------- identifiers ----------

/** `core:<slug>` identifier used by every entity except skills. */
export const coreId = z.string().regex(/^core:[a-z0-9_]+$/, 'expected core:<slug>');
export const skillId = z.enum(SKILL_IDS);
export const natureId = z.enum(NATURE_IDS);
export const techSkillId = z.enum(TECH_SKILL_IDS);
export const rankId = z.enum(RANKS);
export const playerRankId = z.enum(PLAYER_RANK_IDS);
export const roleId = z.enum(ROLE_IDS);
export const tagId = z.enum(TAG_IDS);
export const traitId = z.enum(TRAIT_IDS);
export const stateId = z.enum(STATE_IDS);
export const statusId = z.enum(STATUS_IDS);
export const comboId = z.enum(COMBO_IDS);

const level = z.number().int().min(1).max(99);
/** A slug for MVP resources such as `plots` or `masonry`; names live in the locale. */
const resSlug = z.string().regex(/^[a-z0-9_]+$/);

// ---------- skills and techniques ----------

export const skillSchema = z.strictObject({
  id: skillId,
  group: z.enum(SKILL_GROUPS),
  /** How the skill is trained: tech, course, drill, insight, patch, map, recipe, station, none. */
  activity: z.string(),
  /** What opens the skill for training; `null` when it is open from the first day. */
  unlockReq: z.lazy(() => reqSchema).nullable(),
});

export const sealSchema = z.object({
  id: coreId,
  glyph: z.string().min(1),
  romaji: z.string(),
  kind: z.enum(['zodiac', 'special']),
});

/** Keys of the technique effect numbers in `K.techFx`. */
export const TECH_FX_KEYS = [
  'shield',
  'decoy',
  'evasionBuff',
  'passiveNegate',
  'gateOpening',
  'gateHealing',
  'nextCast',
  'reveal',
] as const;
/** Keys of the boss special numbers in `K.bossFx`. */
export const BOSS_FX_KEYS = [
  'wolfPack',
  'rivalDuel',
  'rivalTournament',
  'drunkenEvasion',
  'heavyCast',
  'twins',
  'mistRehide',
  'illusion',
] as const;
/** Keys of the trophy tables `K.dropChance` and `K.sell`. */
export const TROPHY_KEYS = ['band', 'pelt', 'fang', 'coin', 'gem'] as const;

/**
 * What a technique does besides damage. Numbers are never stored here: an effect names its entry
 * of `K.techFx` by `fx`, and damage comes from the formulas.
 */
export const techniqueEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('damage') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('shield'), fx: z.literal('shield') }),
  z.strictObject({ kind: z.literal('decoy'), fx: z.literal('decoy') }),
  z.strictObject({ kind: z.literal('evasionBuff'), fx: z.literal('evasionBuff') }),
  z.strictObject({ kind: z.literal('cleanse'), statuses: z.array(statusId).min(1) }),
  z.strictObject({ kind: z.literal('passiveNegate'), fx: z.literal('passiveNegate') }),
  z.strictObject({ kind: z.literal('stance'), fx: z.enum(['gateOpening', 'gateHealing']) }),
  z.strictObject({ kind: z.literal('nextCast'), fx: z.literal('nextCast') }),
  z.strictObject({ kind: z.literal('reveal'), fx: z.literal('reveal') }),
]);

export const techniqueCombatSchema = z.strictObject({
  effect: techniqueEffectSchema,
  /** Needs a stance (the First Gate) to be active. */
  requiresStance: z.boolean().optional(),
  /** The combo that always triggers with this technique. */
  guaranteedCombo: comboId.optional(),
  /** A series that hits every enemy. */
  hitsAll: z.boolean().optional(),
  /** Works without a slot in the loadout. */
  outOfLoadout: z.boolean().optional(),
});

export const techniqueBaseSchema = z.strictObject({
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

export const techniqueSchema = techniqueBaseSchema.extend({
  /** Combat behaviour; `null` for training drills, which are never cast. */
  combat: techniqueCombatSchema.nullable(),
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

/** One hour of practice for a chosen technique of the given mentor. */
export const itemUseSchema = z.strictObject({
  t: z.literal('masteryHour'),
  mentor: z.enum(['academy', 'other']),
});

export const itemSchema = z.strictObject({
  id: coreId,
  kind: z.enum(['ingredient', 'tool', 'misc', 'consumable']),
  /** Tags the item carries (tools answer enemy traits). */
  tags: z.array(tagId),
  /** Extra sources that the data tables do not express: a merchant crate or the forge. */
  extraSources: z.array(z.enum(['crate', 'forge'])),
  /** What a crafted tool is made from. */
  madeFrom: z.array(ingredientRef),
  /** What using the item from the bank does, if it can be used. */
  use: itemUseSchema.optional(),
  /** Key of the buy price in `K.goods`; the price itself is never stored on the item. */
  buy: z.string().min(1).optional(),
  /** Key of the sell price in `K.sell`. */
  sell: z.enum(TROPHY_KEYS).optional(),
  /** A tool that rides in the pouch; a pouch slot holds `K.pouchStack` of them. */
  pouch: z.boolean().optional(),
  /** A scroll that teaches the technique; the price of a library scroll is `K.scroll[level]`. */
  scroll: z
    .strictObject({
      technique: coreId,
      source: z.discriminatedUnion('t', [
        z.strictObject({ t: z.literal('library'), level: z.number().int().min(1).max(5) }),
        /** Found at a place on the map; never sold. */
        z.strictObject({ t: z.literal('found') }),
        /** Assembled from the technique's scroll parts. */
        z.strictObject({ t: z.literal('parts') }),
        /** Given by a quest chain. */
        z.strictObject({ t: z.literal('quest') }),
      ]),
    })
    .optional(),
  /** A part of a scroll: `K.partsPerScroll` of them make the scroll of the technique. */
  part: z.strictObject({ technique: coreId }).optional(),
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

/** The part of an enemy that the importer generates from the slice and the balance tables. */
export const enemyBaseSchema = z.strictObject({
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
export const bossBaseSchema = enemyBaseSchema.omit({ region: true });

/** Hand-written combat data of one enemy or boss. Numbers are referenced by key, never stored. */
export const enemyCombatDataSchema = z.strictObject({
  style: z.enum(ATTACK_STYLES),
  /** Trophies the enemy can drop; the chance is the key of `K.dropChance` and equals the item slug. */
  drops: z.array(z.strictObject({ item: coreId, chance: z.enum(TROPHY_KEYS) })),
});

/** What an enemy leaves behind. Everything here is derived from the balance object at load. */
const enemyLootSchema = z.strictObject({
  style: z.enum(ATTACK_STYLES),
  drops: z.array(z.strictObject({ item: coreId, chance: z.number().gt(0).lt(1) })),
  /** Ryo range of one kill: combat level times the `K.ryoDrop` range. */
  ryo: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  /** A scroll part of the carried technique: by chance for an enemy, by count for a boss. */
  scrollPart: z
    .strictObject({
      item: coreId,
      technique: coreId,
      chance: z.number().gt(0).lt(1).optional(),
      count: z.number().int().min(1).optional(),
    })
    .nullable(),
  /** First-kill bounty of a boss and the share paid for repeats; `null` without a bounty. */
  bounty: z.strictObject({ first: z.number().int().min(1), repeatShare: z.number() }).nullable(),
});

export const enemySchema = enemyBaseSchema.extend(enemyLootSchema.shape);

/** A boss special: the structure is data, the numbers come from `K.bossFx` by `fx`. */
export const bossSpecialSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('packRespawn'), fx: z.literal('wolfPack') }),
  z.strictObject({
    kind: z.literal('rival'),
    fx: z.enum(['rivalDuel', 'rivalTournament']),
    /** Casts a signature technique. */
    signature: z.boolean(),
    /** The rival's nature is the one that beats the player's first nature. */
    nature: z.literal('beatsPlayerFirst'),
  }),
  z.strictObject({ kind: z.literal('evasionByMissingHp'), fx: z.literal('drunkenEvasion') }),
  z.strictObject({ kind: z.literal('heavyCast'), fx: z.literal('heavyCast'), stun: z.boolean() }),
  z.strictObject({ kind: z.literal('twins'), fx: z.literal('twins'), poisonMist: z.boolean() }),
  /** Hidden again at intervals; the bind lasts `K.bind.dur`. */
  z.strictObject({
    kind: z.literal('rehide'),
    fx: z.literal('mistRehide'),
    bindPlayer: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('illusion'), fx: z.literal('illusion') }),
]);

export const bossSchema = bossBaseSchema.extend(enemyLootSchema.shape).extend({
  special: bossSpecialSchema,
});

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

// ---------- requirements, quests, exams ----------

/** The condition tree shared by unlocks, checklists, quest objectives and goals. */
export type Req =
  | { t: 'skill'; skill: SkillId; level: number }
  | { t: 'technique'; id: string }
  | { t: 'rank'; rank: PlayerRank }
  | { t: 'nature'; nature: NatureId }
  | { t: 'item'; id: string; n: number }
  | { t: 'quest'; id: string; step?: number | undefined }
  | { t: 'building'; id: string; level: number }
  | { t: 'flag'; id: string; n?: number | undefined }
  | { t: 'all'; of: Req[] }
  | { t: 'any'; of: Req[] };

export const reqSchema: z.ZodType<Req> = z.lazy(() =>
  z.union([
    z.strictObject({ t: z.literal('skill'), skill: skillId, level: z.number().int().min(1) }),
    z.strictObject({ t: z.literal('technique'), id: coreId }),
    z.strictObject({ t: z.literal('rank'), rank: playerRankId }),
    z.strictObject({ t: z.literal('nature'), nature: natureId }),
    z.strictObject({ t: z.literal('item'), id: coreId, n: z.number().int().min(1) }),
    z.strictObject({ t: z.literal('quest'), id: coreId, step: z.number().int().min(1).optional() }),
    z.strictObject({ t: z.literal('building'), id: coreId, level: z.number().int().min(1) }),
    z.strictObject({ t: z.literal('flag'), id: z.string(), n: z.number().int().optional() }),
    z.strictObject({ t: z.literal('all'), of: z.array(reqSchema).min(1) }),
    z.strictObject({ t: z.literal('any'), of: z.array(reqSchema).min(1) }),
  ]),
);

export const entityRefSchema = z.strictObject({
  kind: z.enum([
    'skill',
    'technique',
    'item',
    'recipe',
    'mission',
    'enemy',
    'region',
    'building',
    'quest',
    'gear',
    'seal',
  ]),
  id: z.string(),
});

/** A quest step is done when a requirement holds or a state counter grew by `n` since the step began. */
export const questObjectiveSchema = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('req'), req: reqSchema }),
  z.strictObject({
    t: z.literal('counter'),
    counter: z.string().min(1),
    n: z.number().int().min(1),
  }),
]);

export const questStepSchema = z.strictObject({
  /** Localization key of the step's one-line text. */
  textKey: z.string().min(1),
  objective: questObjectiveSchema,
});

export const questRewardsSchema = z.strictObject({
  items: z.array(ingredientRef),
  ryo: z.number().int().min(0),
  rep: z.number().int().min(0),
  flags: z.array(z.string().min(1)),
  rank: playerRankId.nullable(),
});

export const questSchema = z.strictObject({
  id: coreId,
  /** Chain this quest belongs to; the chain id is the quest id in this slice. */
  chain: coreId,
  /** When the chain starts; `null` means from the first moment. */
  unlock: reqSchema.nullable(),
  steps: z.array(questStepSchema).min(1),
  rewards: questRewardsSchema,
});

/** A rank exam: a checklist plus a timed test that grants the rank. */
export const examSchema = z.strictObject({
  id: coreId,
  /** Rank the player holds after passing. */
  rank: playerRankId,
  checklist: reqSchema,
  /** Skills whose levels shorten the test. */
  reduceBy: z.array(skillId).min(1),
  rewards: z.strictObject({
    items: z.array(ingredientRef),
    /** The pinned goal set on passing. */
    goal: entityRefSchema.nullable(),
  }),
});

// ---------- combat world: zones, operations, statuses, traits, combos ----------

/** A place where one enemy is fought over and over. */
export const zoneSchema = z.strictObject({
  id: coreId,
  enemy: coreId,
  region: z.enum(ZONE_REGIONS),
  /** What opens the zone; `null` when it is open from the first day. */
  unlock: reqSchema.nullable(),
});

export const operationStageSchema = z.discriminatedUnion('t', [
  /** Traps and detours, no enemy; shortened when the requirement holds. */
  z.strictObject({ t: z.literal('approach'), shortenedBy: reqSchema }),
  z.strictObject({ t: z.literal('fight'), enemy: coreId }),
  /** Several "days" of fights drawn from a pool, ending with a fixed enemy. */
  z.strictObject({
    t: z.literal('days'),
    days: z.number().int().min(1),
    fightsPerDay: z.number().int().min(1),
    pool: z.array(coreId).min(1),
    finale: coreId,
  }),
]);

/** A series of fights with partial recovery between them (`K.opRegen`). */
export const operationSchema = z.strictObject({
  id: coreId,
  unlock: reqSchema.nullable(),
  /** Key of the recovery share between fights in the balance object. */
  regen: z.literal('opRegen'),
  stages: z.array(operationStageSchema).min(1),
});

/** A status; its numbers live in the balance object under the status id. */
export const statusSchema = z.strictObject({ id: statusId });

/** An enemy trait: the tag that answers it and where its numbers live in the balance object. */
export const traitSchema = z.strictObject({
  id: traitId,
  answer: tagId,
  numbers: z.strictObject({
    /** The balance object that holds them: `K.trait`, or `K.pack` for the pack trait. */
    from: z.enum(['trait', 'pack']),
    keys: z.array(z.string().min(1)).min(1),
  }),
});

/** A combo: `nature` hitting a fighter in `onState`; its number is `K.combo[id]`. */
export const comboSchema = z.strictObject({ id: comboId, nature: natureId, onState: stateId });

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
  techFx: z.object({
    shield: z.object({ mult: z.number(), durationMs: z.number().int() }),
    decoy: z.object({ charges: z.number().int(), durationMs: z.number().int() }),
    evasionBuff: z.object({ mult: z.number(), durationMs: z.number().int() }),
    passiveNegate: z.object({ everyMs: z.number().int() }),
    gateOpening: z.object({
      taiDamage: z.number(),
      staminaPerSec: z.number(),
      woundsAfter: z.number().int(),
    }),
    gateHealing: z.object({
      taiDamage: z.number(),
      staminaPerSec: z.number(),
      woundsAfter: z.number().int(),
    }),
    nextCast: z.object({ castMult: z.number() }),
    reveal: z.object({ durationMs: z.number().int() }),
  }),
  bossFx: z.object({
    wolfPack: z.object({ count: z.number().int(), everyMs: z.number().int() }),
    rivalDuel: z.object({ techniques: z.number().int() }),
    rivalTournament: z.object({ techniques: z.number().int(), habituationMult: z.number() }),
    drunkenEvasion: z.object({ maxMult: z.number() }),
    heavyCast: z.object({
      everyMs: z.number().int(),
      castMs: z.number().int(),
      damageMult: z.number(),
    }),
    twins: z.object({ count: z.number().int() }),
    mistRehide: z.object({ everyMs: z.number().int() }),
    illusion: z.object({ everyMs: z.number().int(), fleeAtHp: z.number() }),
  }),
  ryoDrop: pair,
  dropChance: z.object({
    band: z.number(),
    pelt: z.number(),
    fang: z.number(),
    coin: z.number(),
    gem: z.number(),
  }),
  sell: z.object({
    band: z.number().int(),
    pelt: z.number().int(),
    fang: z.number().int(),
    coin: z.number().int(),
    gem: z.number().int(),
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
  /** The sensei test: base seconds, shortening per level of the exam's skills, floor in seconds. */
  combat: z.object({ xpTickMs: z.number().int(), regenMs: z.number().int(), hitEven: z.number() }),
  senseiTest: z.object({ base: z.number(), perLevel: z.number(), floor: z.number() }),
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
  quests: z.array(questSchema),
  exams: z.array(examSchema),
  zones: z.array(zoneSchema),
  operations: z.array(operationSchema),
  statuses: z.array(statusSchema),
  traits: z.array(traitSchema),
  combos: z.array(comboSchema),
});

/**
 * The part of the database the importer generates. Quests, exams and the combat world are
 * hand-written; technique combat data and enemy loot are layered on at load (overlay.ts).
 */
export const generatedDbSchema = contentDbSchema
  .omit({
    quests: true,
    exams: true,
    zones: true,
    operations: true,
    statuses: true,
    traits: true,
    combos: true,
  })
  .extend({
    techniques: z.array(techniqueBaseSchema),
    enemies: z.array(enemyBaseSchema),
    bosses: z.array(bossBaseSchema),
  });
export type GeneratedDb = z.infer<typeof generatedDbSchema>;

export type Skill = z.infer<typeof skillSchema>;
export type Seal = z.infer<typeof sealSchema>;
export type Technique = z.infer<typeof techniqueSchema>;
export type TechniqueBase = z.infer<typeof techniqueBaseSchema>;
export type EnemyBase = z.infer<typeof enemyBaseSchema>;
export type BossBase = z.infer<typeof bossBaseSchema>;
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
export type Quest = z.infer<typeof questSchema>;
export type QuestStep = z.infer<typeof questStepSchema>;
export type QuestObjective = z.infer<typeof questObjectiveSchema>;
export type QuestRewards = z.infer<typeof questRewardsSchema>;
export type Exam = z.infer<typeof examSchema>;
export type Zone = z.infer<typeof zoneSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type OperationStage = z.infer<typeof operationStageSchema>;
export type Status = z.infer<typeof statusSchema>;
export type TraitEntity = z.infer<typeof traitSchema>;
export type Combo = z.infer<typeof comboSchema>;
export type TechniqueCombat = z.infer<typeof techniqueCombatSchema>;
export type TechniqueEffect = z.infer<typeof techniqueEffectSchema>;
export type BossSpecial = z.infer<typeof bossSpecialSchema>;
export type EnemyCombatData = z.infer<typeof enemyCombatDataSchema>;
export type ItemUse = z.infer<typeof itemUseSchema>;
export type EntityRefData = z.infer<typeof entityRefSchema>;
export type Balance = z.infer<typeof balanceSchema>;
export type ContentDb = z.infer<typeof contentDbSchema>;
