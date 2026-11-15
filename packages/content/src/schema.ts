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
import { modSchema, obstacleModSchema } from './modifiers.ts';

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

/** The part of a practice that the importer generates; modifiers are layered on at load. */
export const practiceBaseSchema = z.strictObject({
  id: coreId,
  level,
  /** The two skills the practice trains together. */
  pair: z.array(skillId).length(2),
  /** Count of insight and enlightenment modifiers (texts are locale keys by index). */
  insight: z.number().int(),
  enlight: z.number().int(),
});

export const practiceSchema = practiceBaseSchema.extend({
  /** The modifiers of each Insight modifier, by index; the text says what they do. */
  insightMods: z.array(z.array(modSchema).min(1)),
  /** The modifiers of each Enlightenment modifier, by index. */
  enlightMods: z.array(z.array(modSchema).min(1)),
});

export const obstacleBaseSchema = z.object({
  id: coreId,
  level,
  slot: z.number().int().min(1),
});

export const obstacleSchema = obstacleBaseSchema.extend({
  /** What the obstacle needs besides the Athletics level of its slot (a Chakra Control level for walking on trees and water); `null` for none. */
  req: z.lazy(() => reqSchema).nullable(),
  /** The permanent bonus and penalty of the obstacle while it is built. */
  mods: z.array(obstacleModSchema).min(2),
});

/** The part of a herb that the importer generates; the extra requirement is layered on at load. */
export const herbBaseSchema = z.object({ id: coreId, level });

export const herbSchema = herbBaseSchema.extend({
  /** What the herb needs besides its Herbalism level (a Chakra Control level for rare herbs); `null` for none. */
  req: z.lazy(() => reqSchema).nullable(),
});

export const poolCheckpointBaseSchema = z.object({
  id: coreId,
  skill: skillId,
  pct: z.number().int(),
});

export const poolCheckpointSchema = poolCheckpointBaseSchema.extend({
  /** What the checkpoint gives once the pool holds `pct` percent of its capacity; empty for the text-only 95% ones. */
  mods: z.array(modSchema),
});

// ---------- items and recipes ----------

export const ingredientRef = z.object({ item: coreId, n: z.number().int().min(1) });

/** One hour of practice for a chosen technique of the given mentor. */
export const itemUseSchema = z.strictObject({
  t: z.literal('masteryHour'),
  mentor: z.enum(['academy', 'other']),
});

/** Combat stats a bomb can change. */
export const BOMB_STATS = ['evasion', 'accuracy'] as const;

/**
 * What a crafted product does when used. The numbers of an effect live here, once, taken from the
 * recipe text; the rules read them and never carry a literal of their own.
 */
export const itemFxSchema = z.discriminatedUnion('kind', [
  /** Restores health at once; `woundMin` also shortens the healing of one Wound stack after the fight. */
  z.strictObject({
    kind: z.literal('heal'),
    hp: z.number().int().min(1),
    woundMin: z.number().int().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal('restore'),
    chakra: z.number().int().min(1).optional(),
    stamina: z.number().int().min(1).optional(),
  }),
  /** Removes statuses; `resist` also gives resistance to a nature for a while. */
  z.strictObject({
    kind: z.literal('cleanse'),
    statuses: z.array(statusId).min(1),
    resist: z.strictObject({ nature: natureId, durationMs: z.number().int().min(1) }).optional(),
  }),
  /** Dispels an enemy illusion; answers the tag. */
  z.strictObject({ kind: z.literal('dispel'), tag: tagId }),
  /** After the fight, shortens the healing of one Wound stack. */
  z.strictObject({ kind: z.literal('woundHeal'), woundMin: z.number().int().min(1) }),
  /** A combat modifier on the player (`self`) or on the enemy for a while: the stat is multiplied by `mult`. */
  z.strictObject({
    kind: z.literal('bomb'),
    target: z.enum(['self', 'enemy']),
    stat: z.enum(BOMB_STATS),
    mult: z.number().gt(0),
    durationMs: z.number().int().min(1),
  }),
  /** Puts a weaker enemy to sleep; the chance is `K.itemFx.sleep.chance`. */
  z.strictObject({ kind: z.literal('sleep'), fx: z.literal('sleep') }),
  /** Raises the XP of a skill (or of the five natures) for a number of completed actions. */
  z.strictObject({
    kind: z.literal('tonic'),
    skill: z.union([skillId, z.literal('allNatures')]),
    xpBonus: z.number().gt(0),
    charges: z.number().int().min(1),
  }),
  /** Shortens one mission: its duration changes by `duration` (a fraction, negative). */
  z.strictObject({
    kind: z.literal('ration'),
    duration: z.number().lt(0),
    missions: z.number().int().min(1),
  }),
  /** A weapon poison; the tag is what the coated senbon answer. */
  z.strictObject({ kind: z.literal('poison'), tag: tagId }),
]);

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
  /** A medic pouch upgrade: owning it (tier 1 to 3) lets the pouch use a healing slot on its own. */
  medic: z.number().int().min(1).max(3).optional(),
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
  /** What the product does; every recipe output has one. */
  fx: itemFxSchema.optional(),
});

export const marketEntrySchema = z.object({
  item: coreId,
  /** Building that supplies the goods, if any. */
  supplier: coreId.nullable(),
  /** Market building level that unlocks the entry. */
  marketLevel: z.number().int(),
});

/** What a shop sells: the item and what must hold before it can be bought. The price is `K.goods[item.buy]`. */
export const shopEntrySchema = z.strictObject({
  item: coreId,
  req: z.lazy(() => reqSchema),
});

/** Coating: one `poison` and a batch of `base` make a batch of `product` (counts come from the product's `madeFrom`). */
export const coatSchema = z.strictObject({ poison: coreId, base: coreId, product: coreId });

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

/** What an enemy leaves behind, apart from the scroll part. Everything here is derived from the balance object at load. */
const enemyLootShape = {
  style: z.enum(ATTACK_STYLES),
  drops: z.array(z.strictObject({ item: coreId, chance: z.number().gt(0).lt(1) })),
  /** Ryo range of one kill: combat level times the `K.ryoDrop` range. */
  ryo: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  /** First-kill bounty of a boss and the share paid for repeats; `null` without a bounty. */
  bounty: z.strictObject({ first: z.number().int().min(1), repeatShare: z.number() }).nullable(),
};
const partBase = { item: coreId, technique: coreId };

export const enemySchema = enemyBaseSchema.extend({
  ...enemyLootShape,
  /** A scroll part of the carried technique, dropped by chance. */
  scrollPart: z.strictObject({ ...partBase, chance: z.number().gt(0).lt(1) }).nullable(),
});

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

export const bossSchema = bossBaseSchema.extend({
  ...enemyLootShape,
  /** A scroll part of the carried technique, dropped in a fixed count. */
  scrollPart: z.strictObject({ ...partBase, count: z.number().int().min(1) }).nullable(),
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

export const gearBaseSchema = z.object({
  id: coreId,
  skill: skillId,
  tiers: z.array(gearTierSchema).min(1),
});

/** Keys of the per-tier numbers in `K.gearFx`. */
export const GEAR_FX_KEYS = ['mannequin', 'sickle', 'alembic', 'stations', 'maps'] as const;

/**
 * What each owned tier of a gear line does. The modifier key is data; the size of one tier is
 * `K.gearFx[perTier]`. `bonus` adds it, `reduction` subtracts it, `speed` divides time by 1 + it.
 */
export const gearFxSchema = z.strictObject({
  key: z.string().min(1),
  perTier: z.enum(GEAR_FX_KEYS),
  effect: z.enum(['bonus', 'reduction', 'speed']),
});

export const gearSchema = gearBaseSchema.extend({ fx: gearFxSchema });

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

/**
 * A place where one enemy is fought over and over. A zone has no name or description of its own:
 * it shows the name and description of its enemy.
 */
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
  /** The flag raised the first time the operation is finished. */
  clearFlag: z.string().min(1),
  /** Key of the recovery share between fights in the balance object. */
  regen: z.literal('opRegen'),
  stages: z.array(operationStageSchema).min(1),
});

/** Rules the player AI can run, in the order a tier lists them (see `fight-ai.ts`). */
export const AI_RULE_IDS = [
  'heal',
  'interrupt',
  'defend',
  'answer',
  'maintain',
  'signature',
  'best',
  'filler',
  'basic',
] as const;

/**
 * One tier of the player AI. `rules` is the ordered priority list; the other fields say how the
 * rules behave at this tier. The numbers a tier needs live in `K.ai[id]`.
 */
export const aiTierSchema = z.strictObject({
  id: z.enum(['genin', 'chunin']),
  /** The lowest player tier (0 student, 1 genin, 2 chunin) that runs this tier. */
  minTier: z.number().int().min(0),
  rules: z.array(z.enum(AI_RULE_IDS)).min(1),
  /** `known`: defends against the casts it knows to be heavy; `all`: every cast. */
  defends: z.enum(['known', 'all']),
  /** Whether it needs the reaction delay before it answers a cast. */
  reaction: z.boolean(),
  /** Whether the best attack counts the nature wheel and habituation, or only raw strength. */
  tactical: z.boolean(),
});

export const aiSchema = z.strictObject({
  /** Traits that show from the first sight of an enemy; the others need a victory over it. */
  visibleTraits: z.array(traitId),
  tiers: z.array(aiTierSchema).min(1),
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
/** The numbers every rival special shares: technique count, cadence and strength of the techniques and of the signature. */
const rivalNumbers = z.object({
  techniques: z.number().int(),
  everyMs: z.number().int(),
  mult: z.number(),
  sigEveryMs: z.number().int(),
  sigMult: z.number(),
  sigOpenMs: z.number().int(),
  hp: z.number(),
  dmg: z.number(),
});
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
    wolfPack: z.object({
      count: z.number().int(),
      everyMs: z.number().int(),
      hp: z.number(),
      dmg: z.number(),
      leaderHp: z.number(),
      leaderDmg: z.number(),
    }),
    rivalDuel: rivalNumbers,
    rivalTournament: rivalNumbers.extend({ habituationMult: z.number() }),
    drunkenEvasion: z.object({ maxMult: z.number(), hp: z.number(), dmg: z.number() }),
    heavyCast: z.object({
      everyMs: z.number().int(),
      castMs: z.number().int(),
      damageMult: z.number(),
      stunMs: z.number().int(),
      hp: z.number(),
      dmg: z.number(),
    }),
    twins: z.object({
      count: z.number().int(),
      hpEach: z.number(),
      dmgEach: z.number(),
      mistMult: z.number(),
    }),
    mistRehide: z.object({ everyMs: z.number().int(), hp: z.number(), dmg: z.number() }),
    illusion: z.object({
      everyMs: z.number().int(),
      fleeAtHp: z.number(),
      hp: z.number(),
      dmg: z.number(),
    }),
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
  /** Herb bushes: stock is `stockBase` plus the herb's mastery level; an empty bush regrows for `regrowMs`. */
  field: z.object({ stockBase: z.number().int(), regrowMs: z.number().int() }),
  /** Crafting: mastery levels that open each tier, and the chance of a bonus unit per tier above the first. */
  craftRules: z.object({
    masteryTiers: z.array(z.number().int()).min(2),
    bonusPerTier: z.number(),
  }),
  /** A tonic can hold at most this many times the charges of one tonic. */
  tonic: z.object({ capMult: z.number() }),
  /** Selling: the share of the computed value a shop pays for a craft product; a herb is worth `herbBase + herbPerLevel x level`. */
  shop: z.object({ craftSellFactor: z.number(), herbBase: z.number(), herbPerLevel: z.number() }),
  /** Size of one owned gear tier, by `GEAR_FX_KEYS`. */
  gearFx: z.object({
    mannequin: z.number(),
    sickle: z.number(),
    alembic: z.number(),
    stations: z.number(),
    maps: z.number(),
  }),
  /** Numbers of item effects that name them by key. */
  itemFx: z.object({ sleep: z.object({ chance: z.number() }) }),
  /** The sensei test: base seconds, shortening per level of the exam's skills, floor in seconds. */
  combat: z.object({
    xpTickMs: z.number().int(),
    regenMs: z.number().int(),
    hitEven: z.number(),
    fightCapMs: z.number().int(),
    maxEnemies: z.number().int(),
  }),
  bindEva: z.number(),
  loadout: z.object({
    slots: z.object({ genin: z.number().int(), chunin: z.number().int() }),
    natures: z.object({ genin: z.number().int(), chunin: z.number().int() }),
    saved: z.number().int(),
    nameMax: z.number().int(),
    areaBodies: z.number(),
  }),
  signature: z.object({ minMastery: z.number().int(), xpBonus: z.number() }),
  pouch: z.object({ slots: z.number().int(), vest: z.number().int() }),
  ai: z.object({ geninReactionMs: z.number().int(), guardBelow: z.number() }),
  woundHp: z.number(),
  regionZones: z.object({ openFromRank: z.union([playerRankId, z.literal('off')]) }),
  operation: z.object({ approachMs: z.number().int(), approachShort: z.number() }),
  toolFx: z.object({ dot: z.object({ pct: z.number(), durS: z.number() }), resist: z.number() }),
  illusionResist: z.number(),
  senseiTest: z.object({ base: z.number(), perLevel: z.number(), floor: z.number() }),
  natures: z.object({
    second: z.number().int(),
    third: z.number().int(),
    max: z.number().int(),
    penaltyEnd: z.number().int(),
  }),
  offlineCapHours: z.number(),
  masteryCap: z.number().int(),
  /**
   * Meditation: chance per finished cycle of an Insight and of an Enlightenment, the levels a
   * modifier of each kind can be bought up to, and the practice mastery that opens each of the
   * three modifiers of a kind.
   */
  meditation: z.object({
    insightChance: z.number(),
    enlightChance: z.number(),
    insightLevels: z.number().int(),
    enlightLevels: z.number().int(),
    insightGates: z.array(z.number().int()),
    enlightGates: z.array(z.number().int()),
  }),
  /**
   * Athletics course: the slot that costs nothing to build the first time, the number of built
   * obstacles that raises the pillar, and the Athletics XP share the pillar adds.
   */
  athletics: z.object({
    freeSlot: z.number().int(),
    pillarCount: z.number().int(),
    pillarXp: z.number(),
  }),
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
  shop: z.array(shopEntrySchema),
  coat: z.array(coatSchema),
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
  ai: aiSchema,
});

/**
 * The part of the database the importer generates. Quests, exams and the combat world are
 * hand-written; technique combat data and enemy loot are layered on at load (overlay.ts).
 */
export const generatedDbSchema = contentDbSchema
  .omit({
    quests: true,
    exams: true,
    shop: true,
    coat: true,
    zones: true,
    operations: true,
    statuses: true,
    traits: true,
    combos: true,
    ai: true,
  })
  .extend({
    techniques: z.array(techniqueBaseSchema),
    enemies: z.array(enemyBaseSchema),
    bosses: z.array(bossBaseSchema),
    herbs: z.array(herbBaseSchema),
    gear: z.array(gearBaseSchema),
    practices: z.array(practiceBaseSchema),
    obstacles: z.array(obstacleBaseSchema),
    pools: z.array(poolCheckpointBaseSchema),
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
export type HerbBase = z.infer<typeof herbBaseSchema>;
export type ItemFx = z.infer<typeof itemFxSchema>;
export type ShopEntry = z.infer<typeof shopEntrySchema>;
export type Coat = z.infer<typeof coatSchema>;
export type GearFx = z.infer<typeof gearFxSchema>;
export type GearBase = z.infer<typeof gearBaseSchema>;
export type PoolCheckpointBase = z.infer<typeof poolCheckpointBaseSchema>;
export type PracticeBase = z.infer<typeof practiceBaseSchema>;
export type ObstacleBase = z.infer<typeof obstacleBaseSchema>;
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
export type AiTier = z.infer<typeof aiTierSchema>;
export type AiData = z.infer<typeof aiSchema>;
export type AiRuleId = (typeof AI_RULE_IDS)[number];
export type TechniqueCombat = z.infer<typeof techniqueCombatSchema>;
export type TechniqueEffect = z.infer<typeof techniqueEffectSchema>;
export type BossSpecial = z.infer<typeof bossSpecialSchema>;
export type EnemyCombatData = z.infer<typeof enemyCombatDataSchema>;
export type ItemUse = z.infer<typeof itemUseSchema>;
export type EntityRefData = z.infer<typeof entityRefSchema>;
export type Balance = z.infer<typeof balanceSchema>;
export type ContentDb = z.infer<typeof contentDbSchema>;
