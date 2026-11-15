import { z } from 'zod';
import type { IdTypes } from '@shinobi/content/typing';
import { modSchema, obstacleModSchema, type ModifierKeyInfo } from './modifiers.ts';
import { idOf, open, shapeOf } from './shim.ts';

// ---------- identifiers ----------

/**
 * `<pack>:<slug>` identifier of every entity. The built-in pack `core` also owns bare ids (skills,
 * natures, ranks and the other vocabulary members); every other pack's ids start with `<pack>:`.
 */
export const packedId = z.string().regex(/^[a-z0-9_]+:[a-z0-9_]+$/, 'expected <pack>:<slug>');
/** @deprecated Same as `packedId`; the prefix is no longer fixed to `core`. */
export const coreId = packedId;
/** A vocabulary id: a bare core id (`tai`, `katon`) or `<pack>:<slug>`. */
const vocabId = z.string().regex(/^[A-Za-z0-9_]+(:[a-z0-9_]+)?$/, 'expected an id');
export const skillId = idOf('skill');
export const natureId = idOf('nature');
export const techSkillId = idOf('techSkill');
export const rankId = idOf('techRank');
export const playerRankId = idOf('playerRank');
export const roleId = idOf('role');
export const tagId = idOf('tag');
export const traitId = idOf('trait');
export const stateId = idOf('state');
export const statusId = idOf('status');
export const comboId = idOf('combo');

const level = z.number().int().min(1).max(99);
/** A slug for resources such as `plots` or `masonry`; names live in the locale. */
const resSlug = z.string().regex(/^[a-z0-9_]+(:[a-z0-9_]+)?$/);

// ---------- vocabularies ----------

/** A vocabulary member with nothing but an id (names and descriptions live in the locale). */
export const vocabSchema = z.strictObject({ id: vocabId });
export type VocabEntry = z.infer<typeof vocabSchema>;

/**
 * A currency. `role` says what the rules use it for when they pay or charge without naming one:
 * `money` (what enemies drop and bounties pay), `renown` (what a cleared operation adds) and
 * `study` (what studying an enemy costs). A reward or a drop may name another currency.
 */
export const currencySchema = z.strictObject({
  id: vocabId,
  role: z.enum(['money', 'renown', 'study']).optional(),
});

/** A sidebar group of skills; the list order is the display order. */
export const skillGroupSchema = vocabSchema;

/**
 * A chakra nature. `strongAgainst` is the wheel: the natures this one beats. `color` is the name of
 * a CSS token. `opens` lists the key cells (`cellKeys`) the nature can open. `ayaNature` is the
 * nature the teammate Aya gets when this one is the player's native nature.
 */
export const natureSchema = z.strictObject({
  id: vocabId,
  strongAgainst: z.array(vocabId),
  color: z.string().regex(/^--[a-z0-9-]+$/, 'expected a CSS token name'),
  opens: z.array(vocabId),
  ayaNature: vocabId,
});

/**
 * A rank the player holds; the list order is the order of the ranks and `tier` the AI tier it runs.
 * `academy` marks a rank held while still at the Academy: such a player has no village, no pouch,
 * no nature test and is slowed past the Academy cap; the first rank without it is the graduation.
 */
export const playerRankSchema = z.strictObject({
  id: vocabId,
  /** The AI tier the rank runs; `composeContent` sets it to the position of the rank, so a pack may give any number. */
  tier: z.number().int().min(0),
  academy: z.boolean().optional(),
  /** The id of the rank this one comes right after; omitted: after the last rank of the packs loaded before. Ties go by pack load order. */
  after: z.string().optional(),
});

/**
 * A stage of the village, in list order. `rep` is the key of `K.rep` that holds the reputation
 * needed to reach the stage (`null` for the first stage).
 */
export const villageStageSchema = z.strictObject({
  id: vocabId,
  rep: z.string().nullable(),
  /** The highest building level the stage allows; omitted: the entry of `K.towerStageMax` for its position, or the last one. */
  cap: z.number().int().min(0).optional(),
});

/** The id of an entity kind that has a page and the `ContentDb` list its entities live in (`null`: nested in another list). */
export const entityKindSchema = z.strictObject({ id: vocabId, list: z.string().nullable() });

// ---------- skills and techniques ----------

export const skillSchema = z.strictObject({
  id: skillId,
  group: idOf('skillGroup'),
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
  z.strictObject({ kind: z.literal('shield'), fx: idOf('fxShield') }),
  z.strictObject({ kind: z.literal('decoy'), fx: idOf('fxDecoy') }),
  z.strictObject({ kind: z.literal('evasionBuff'), fx: idOf('fxEvasionBuff') }),
  z.strictObject({ kind: z.literal('cleanse'), statuses: z.array(statusId).min(1) }),
  z.strictObject({
    kind: z.literal('passiveNegate'),
    fx: idOf('fxPassiveNegate'),
  }),
  z.strictObject({
    kind: z.literal('stance'),
    fx: idOf('fxStance'),
  }),
  z.strictObject({ kind: z.literal('nextCast'), fx: idOf('fxNextCast') }),
  z.strictObject({ kind: z.literal('reveal'), fx: idOf('fxReveal') }),
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

export const exerciseSchema = z.object({
  id: coreId,
  level,
  /** The skill the exercise trains; omitted: the first skill with the activity `drill`. */
  skill: skillId.optional(),
});

/** The part of a practice that the importer generates; modifiers are layered on at load. */
export const practiceBaseSchema = z.strictObject({
  id: coreId,
  level,
  /** The two skills the practice trains together. */
  pair: z.array(skillId).length(2),
  /** The skill the practice trains; omitted: the first skill with the activity `insight`. */
  skill: skillId.optional(),
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
export const herbBaseSchema = z.object({
  id: coreId,
  level,
  /** The skill that gathers the herb; omitted: the first skill with the activity `patch`. */
  skill: skillId.optional(),
});

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
export const itemUseSchema = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('masteryHour'), mentor: z.enum(['academy', 'other']) }),
  /** Notes: one hour of practice for a technique the player already knows, chosen by the player. */
  z.strictObject({ t: z.literal('notes') }),
]);

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
  z.strictObject({ kind: z.literal('sleep'), fx: idOf('fxSleep') }),
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
  /** A merchant crate: opening it rolls the table `K.crate`. */
  z.strictObject({ kind: z.literal('crate') }),
  /** Notes about an enemy: they raise the Bingo level of a chosen enemy by `levels` once the Bingo book exists; until then the item carries data only. */
  z.strictObject({ kind: z.literal('bingoNote'), levels: z.number().int().min(1) }),
]);

export const itemSchema = z.strictObject({
  id: coreId,
  kind: idOf('itemKind'),
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
  sell: idOf('trophy').optional(),
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
  /** The currency the price is paid in (a `currencies` id); omitted: the currency with the role `money`. The `renown` currency is what Reputation is counted in: it opens the village stages. */
  currency: vocabId.optional(),
});

/** Coating: one `poison` and a batch of `base` make a batch of `product` (counts come from the product's `madeFrom`). */
export const coatSchema = z.strictObject({ poison: coreId, base: coreId, product: coreId });

export const recipeSchema = z.object({
  id: coreId,
  skill: idOf('recipeSkill'),
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

/** What the generated data says about one payment in kind: the item, Intel or a scroll part. */
export const missionBasePaySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), item: coreId }),
  z.object({ kind: z.literal('intel') }),
  z.object({ kind: z.literal('scrollPart'), technique: coreId }),
]);

/** A payment in kind with its amount; a scroll part is a chance (the `K.partDrop` entry `chance` names) of one part. */
export const missionPaySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), item: coreId, n: z.number().int().min(1) }),
  z.object({ kind: z.literal('intel'), n: z.number().int().min(1) }),
  z.object({ kind: z.literal('scrollPart'), technique: coreId, chance: idOf('partChance') }),
  /** A payment in a currency (a `currencies` id), for the currencies of a pack. */
  z.object({ kind: z.literal('currency'), currency: vocabId, n: z.number().int().min(1) }),
]);

/** The mission as the importer generates it. */
export const missionBaseSchema = z.strictObject({
  id: coreId,
  rank: idOf('missionRank'),
  team: z.boolean(),
  /** Duration in minutes. */
  minutes: z.number().int().min(0),
  stages: z.array(missionStageSchema).min(1),
  pay: z.array(missionBasePaySchema),
  /** Village resource gained, for village missions. */
  resource: resSlug.nullable(),
  ryo: z.number(),
  rep: z.number(),
});

/** The hand-written part of a mission: what opens it, how its minutes split between stages, how much of each payment. */
export const missionExtraSchema = z.strictObject({
  unlock: z.lazy(() => reqSchema).nullable(),
  /** Relative weight of each stage in the mission's minutes. */
  shares: z.array(z.number().int().min(1)).min(1),
  /** Amount of each payment of the base mission, in order; a scroll part has 1. */
  pay: z.array(z.number().int().min(1)),
  /** For each stage, the indices of its alternatives that are slower fallbacks (they take twice the time). */
  slow: z.array(z.array(z.number().int().min(0))),
  /** For each stage, the Intel that does it with no skill at all (0: it cannot be bought). */
  skip: z.array(z.number().int().min(0)),
  /** Modifier key that scales the village resource units the mission brings (null: none). */
  resourceMod: z.string().nullable(),
  /** Whether the mission is on the mission board (the operation is not). */
  board: z.boolean(),
});

export const missionSchema = missionBaseSchema.extend({
  pay: z.array(missionPaySchema),
  unlock: z.lazy(() => reqSchema).nullable(),
  shares: z.array(z.number().int().min(1)).min(1),
  slow: z.array(z.array(z.number().int().min(0))),
  skip: z.array(z.number().int().min(0)),
  resourceMod: z.string().nullable(),
  board: z.boolean(),
  /** The highest level a stage of the mission is paid XP at: `K.missionRateCap` of its rank (0 for a rank with none). */
  rateCap: z.number(),
});

/**
 * A teammate: which of the rival's and Aya's natures is his or hers, the skills the role is good at,
 * and the level formula (shares of the player's own levels) lives in `K.team`.
 */
export const teammateSchema = z.strictObject({
  id: coreId,
  /** Whose nature from the team selector this teammate has. */
  natureOf: z.enum(['rival', 'aya']),
  /** Skills the teammate is strong in (a stage that checks one of them can be done by the teammate). */
  skills: z.array(skillId).min(1),
});

// ---------- world ----------

/**
 * A point of interest in a cell, found when the cell is explored to level 1. Kinds:
 * `outpost` (a free travel target), `training` (a bonus to one skill's XP while the player is
 * there), `zone` (a fight zone that opens), `story` (sets a flag quests read), `deposit` (a
 * building of the village gains a level), `cache` (one-time loot), `vault` (one whole scroll) and
 * `mission` (a mission is on offer). Names and descriptions are localized under `poi.<id>`.
 */
export const poiSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: coreId, kind: z.literal('outpost') }),
  z.strictObject({
    id: coreId,
    kind: z.literal('training'),
    skill: skillId,
    /** Share of extra XP of the skill (0.1 is +10%). */
    bonus: z.number().gt(0),
  }),
  z.strictObject({ id: coreId, kind: z.literal('zone'), zone: coreId }),
  z.strictObject({ id: coreId, kind: z.literal('story') }),
  z.strictObject({ id: coreId, kind: z.literal('deposit'), building: coreId }),
  z.strictObject({
    id: coreId,
    kind: z.literal('cache'),
    items: z.array(ingredientRef),
    ryo: z.number().int().min(0),
    /** More currencies by id (a pack's own). */
    currencies: z.record(vocabId, z.number().int().min(0)).optional(),
  }),
  z.strictObject({ id: coreId, kind: z.literal('vault'), item: coreId }),
  z.strictObject({ id: coreId, kind: z.literal('mission'), mission: coreId }),
]);
export type Poi = z.infer<typeof poiSchema>;
export type PoiKind = Poi['kind'];

/** A cell as the importer generates it; points of interest are hand-written and layered on at load. */
export const cellBaseSchema = z.object({
  id: coreId,
  region: coreId,
  index: z.number().int().min(0),
  key: idOf('cellKey').nullable(),
  /** Whether the cell hosts a story event. */
  story: z.boolean(),
});

export const cellSchema = cellBaseSchema.extend({ pois: z.array(poiSchema) });
export type CellBase = z.infer<typeof cellBaseSchema>;

export const regionSchema = z.object({
  id: coreId,
  /** Scouting level that opens the region. */
  scout: z.number().int(),
  cells: z.array(coreId),
});

/** The part of an enemy that the importer generates from the slice and the balance tables. */
export const enemyBaseSchema = z.strictObject({
  id: coreId,
  region: idOf('enemyRegion'),
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
  style: idOf('attackStyle'),
  /** Trophies the enemy can drop; the chance is the key of `K.dropChance` and equals the item slug. */
  drops: z.array(z.strictObject({ item: coreId, chance: idOf('trophy') })),
});

/** What an enemy leaves behind, apart from the scroll part. Everything here is derived from the balance object at load. */
const enemyLootShape = {
  style: idOf('attackStyle'),
  drops: z.array(z.strictObject({ item: coreId, chance: z.number().gt(0).lt(1) })),
  /** Ryo range of one kill: combat level times the `K.ryoDrop` range. */
  ryo: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  /** First-kill bounty of a boss and the share paid for repeats; `null` without a bounty. */
  bounty: z
    .strictObject({ first: z.number().int().min(1), repeatShare: z.number().min(0).max(1) })
    .nullable(),
};
const partBase = { item: coreId, technique: coreId };

export const enemySchema = enemyBaseSchema.extend({
  ...enemyLootShape,
  /** A scroll part of the carried technique, dropped by chance. */
  scrollPart: z.strictObject({ ...partBase, chance: z.number().gt(0).lt(1) }).nullable(),
});

/** A boss special: the structure is data, the numbers come from `K.bossFx` by `fx`. */
export const bossSpecialSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('packRespawn'), fx: idOf('fxWolfPack') }),
  z.strictObject({
    kind: z.literal('rival'),
    fx: idOf('fxRival'),
    /** Casts a signature technique. */
    signature: z.boolean(),
    /** The rival's nature is the one that beats the player's first nature. */
    nature: z.literal('beatsPlayerFirst'),
  }),
  z.strictObject({
    kind: z.literal('evasionByMissingHp'),
    fx: idOf('fxDrunkenEvasion'),
  }),
  z.strictObject({
    kind: z.literal('heavyCast'),
    fx: idOf('fxHeavyCast'),
    stun: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('twins'),
    fx: idOf('fxTwins'),
    poisonMist: z.boolean(),
  }),
  /** Hidden again at intervals; the bind lasts `K.bind.dur`. */
  z.strictObject({
    kind: z.literal('rehide'),
    fx: idOf('fxMistRehide'),
    bindPlayer: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('illusion'), fx: idOf('fxIllusion') }),
]);

export const bossSchema = bossBaseSchema.extend({
  ...enemyLootShape,
  /** A scroll part of the carried technique, dropped in a fixed count. */
  scrollPart: z.strictObject({ ...partBase, count: z.number().int().min(1) }).nullable(),
  special: bossSpecialSchema,
});

export const buildingBaseSchema = z.object({
  id: coreId,
  /** Resources needed for level 6, keyed by resource slug; `null` when the building has none. */
  tier6: z.record(resSlug, z.number()).nullable(),
});

/** What a building is for. */
export const BUILDING_ROLES = ['producer', 'bonus', 'shop', 'storage', 'defence', 'admin'] as const;
/** The one job of a building that the village rules themselves perform: the treasury, the stage cap, the store, the library scrolls. `teaching` marks the building whose mentors teach trainer techniques (the Academy); the interface links the technique pages to it. */
export const BUILDING_DUTIES = ['treasury', 'stages', 'storage', 'scrolls', 'teaching'] as const;

/** The hand-written part of a building: its role, what one level does, what it produces. */
export const buildingFxSchema = z.strictObject({
  role: z.enum(BUILDING_ROLES),
  /** Modifiers of ONE level; the building's level multiplies each value. */
  effects: z.array(modSchema),
  /** Modifiers given once, at the highest level only (not multiplied by the level). */
  capstone: z.array(modSchema).default([]),
  /** Civil resources the building produces: `K.prod` x level of each, per tick. */
  produces: z.array(resSlug),
  duty: z.enum(BUILDING_DUTIES).optional(),
  /** The village stage (a `villageStages` id) from which the building can be built; omitted: from the first stage. */
  stage: z.string().min(1).optional(),
});

export const buildingSchema = buildingBaseSchema.extend({
  role: z.enum(BUILDING_ROLES),
  effects: z.array(modSchema),
  capstone: z.array(modSchema),
  produces: z.array(resSlug),
  duty: z.enum(BUILDING_DUTIES).optional(),
  stage: z.string().min(1).optional(),
});

/** Village resources: civil ones fill the store and pay for construction, shinobi ones come from village missions. */
export const resourceSchema = z.strictObject({
  id: resSlug,
  kind: z.enum(['civil', 'shinobi', 'workforce', 'power']),
  /** Civil resources only: `base` costs `K.costBase` x multiplier, `late` costs a share of it from a level on. */
  cost: z.enum(['base', 'late']).optional(),
  /** The icon the village page draws: `lucide:<name>` or a game-icons name; none: the generic one. */
  icon: z.string().optional(),
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
  perTier: idOf('gearFxKey'),
  effect: z.enum(['bonus', 'reduction', 'speed']),
});

export const gearSchema = gearBaseSchema.extend({ fx: gearFxSchema });

// ---------- requirements, quests, exams ----------

/** The condition tree shared by unlocks, checklists, quest objectives and goals. */
export type Req =
  | { t: 'skill'; skill: IdTypes['skill']; level: number }
  | { t: 'technique'; id: string }
  | { t: 'rank'; rank: IdTypes['playerRank'] }
  | { t: 'nature'; nature: IdTypes['nature'] }
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
  /** An entity kind of `entityKinds`. */
  kind: idOf('entityKind'),
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
  /** More currencies by id (a pack's own); `ryo` and `rep` are the `money` and `renown` ones. */
  currencies: z.record(vocabId, z.number().int().min(0)).optional(),
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
  region: idOf('zoneRegion'),
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

/** One clear's pay: ryo, reputation and scroll parts (each a chance given by a key of `K.partDrop`). */
const operationPaySchema = z.strictObject({
  ryo: z.number().int().min(0),
  rep: z.number().int().min(0),
  parts: z.array(z.strictObject({ technique: coreId, chance: idOf('partChance') })),
});
export const operationRewardsSchema = z.strictObject({
  first: operationPaySchema,
  repeat: operationPaySchema,
});

/** A series of fights with partial recovery between them (`K.opRegen`). */
export const operationSchema = z.strictObject({
  id: coreId,
  unlock: reqSchema.nullable(),
  /** The flag raised the first time the operation is finished. */
  clearFlag: z.string().min(1),
  /** Key of the recovery share between fights in the balance object. */
  regen: z.literal('opRegen'),
  /** What a clear pays: the first time, and on every repeat; `null` for an operation whose rewards come from elsewhere. */
  rewards: operationRewardsSchema.nullable(),
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
  id: idOf('aiTier'),
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
/** A battle status. `nature` is the nature whose colour its icon takes in the interface (none: the plain text colour). */
export const statusSchema = z.strictObject({ id: statusId, nature: natureId.optional() });

/** An enemy trait: the tag that answers it and where its numbers live in the balance object. */
export const traitSchema = z.strictObject({
  id: traitId,
  answer: tagId,
  numbers: z.strictObject({
    /** The balance object that holds them: `K.trait`, or `K.pack` for the pack trait. */
    from: z.string().min(1),
    keys: z.array(z.string().min(1)).min(1),
  }),
});

/** A combo: `nature` hitting a fighter in `onState`; its number is `K.combo[id]`. */
export const comboSchema = z.strictObject({ id: comboId, nature: natureId, onState: stateId });

// ---------- balance ----------

const pair = z.tuple([z.number(), z.number()]);
const byRank = shapeOf('byRank', z.record(z.string(), z.number()));

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
  role: shapeOf(
    'kRole',
    z.record(z.string(), z.object({ m: z.number(), cd: z.number(), c: z.number() })),
  ),
  rankCd: byRank,
  chakraCost: byRank,
  staminaCost: byRank,
  levelScale: z.number(),
  masteryDmg: z.number(),
  masteryCost: z.number(),
  burn: z.object({ share: z.number(), dur: z.number() }),
  wet: z.object({ slow: z.number(), dur: z.number() }),
  stun: shapeOf('stun', z.record(z.string(), z.number())),
  bind: z.object({ dur: z.number() }),
  poison: z.object({ pctPerSec: z.number(), dur: z.number() }),
  combo: shapeOf('combo', z.record(z.string(), z.number())),
  techFx: shapeOf('techFx', z.record(z.string(), z.record(z.string(), z.number()))),
  bossFx: shapeOf('bossFx', z.record(z.string(), z.record(z.string(), z.number()))),
  ryoDrop: pair,
  dropChance: shapeOf('dropChance', z.record(z.string(), z.number())),
  sell: shapeOf('kSell', z.record(z.string(), z.number())),
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
  trait: shapeOf('trait', z.record(z.string(), z.number())),
  combatXp: z.object({ style: z.number(), vit: z.number(), eva: z.number() }),
  ryoPerMin: shapeOf('ryoPerMin', z.record(z.string(), z.number())),
  repPerMission: shapeOf('repPerMission', z.record(z.string(), z.number())),
  missionXpShare: z.number(),
  missionRateCap: shapeOf('missionRateCap', z.record(z.string(), z.number())),
  shinobiResPerMission: z.number(),
  scroll: z.record(z.string(), z.number()),
  gearTier: z.array(z.number()),
  obstacleBase: z.number(),
  goods: z.record(z.string(), z.number()),
  travel: z.array(z.number()),
  bounty: z.record(z.string(), z.number()),
  bountyRepeat: z.number(),
  /** Reputation: what each stage of the village needs (`stage2`, ...) and what the exam, a boss and the last quest pay; a pack adds `<pack>:<name>` keys. */
  rep: shapeOf('rep', z.record(z.string(), z.number())),
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
  partDrop: shapeOf('partDrop', z.record(z.string(), z.number())),
  tickMin: z.number(),
  /**
   * Limits that keep the engine running whatever a pack adds: the most events one system of a pack
   * may ask for in an hour of game time, the shortest an action cycle can get (ms) and the bounds of a
   * modifier total.
   */
  engine: z.object({
    packEventsPerHour: z.number().int().min(1),
    minActionMs: z.number().int().min(1),
    modMin: z.number().gt(0),
    modMax: z.number().gt(0),
  }),
  /** Numbers of packs other than `core`, by pack id: nothing but that pack reads or sets them. */
  ext: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  /** The village: starting building levels by building id, the level from which the `late` resource is needed and its share of the base cost. */
  village: z.object({
    start: z.record(coreId, z.number().int().min(0)),
    lateFromLevel: z.number().int(),
    lateShare: z.number(),
  }),
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
  gearFx: shapeOf('gearFx', z.record(z.string(), z.number())),
  /** Numbers of item effects that name them by key. */
  itemFx: shapeOf('itemFx', z.record(z.string(), z.record(z.string(), z.number()))),
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
    slots: shapeOf('loadoutSlots', z.record(z.string(), z.number().int())),
    natures: shapeOf('loadoutNatures', z.record(z.string(), z.number().int())),
    saved: z.number().int(),
    nameMax: z.number().int(),
    areaBodies: z.number(),
  }),
  signature: z.object({ minMastery: z.number().int(), xpBonus: z.number() }),
  pouch: z.object({ slots: z.number().int(), vest: z.number().int(), vestRank: playerRankId }),
  ai: z.object({ geninReactionMs: z.number().int(), guardBelow: z.number() }),
  woundHp: z.number(),
  /**
   * The Bingo book: wins that study an enemy completely, for an ordinary enemy and for a boss.
   */
  bingo: z.object({
    studiedWins: z.object({ enemy: z.number().int(), boss: z.number().int() }),
    /** A drop with a chance under this is rare loot: the book shows it only when the entry is studied. */
    rareBelow: z.number(),
  }),
  /**
   * Battle analysis: fights per run of a zone or boss and runs of an operation, the seed of the
   * run (it never touches the game's streams), the time budget in ms a default run must keep to,
   * and the most options one hint lists.
   */
  analysis: z.object({
    samples: z.number().int().min(1),
    opSamples: z.number().int().min(1),
    seed: z.number().int(),
    budgetMs: z.number().int(),
    hintOptions: z.number().int().min(1),
    /**
     * The session forecast: minutes of one session and the game hours the sessions may take in
     * all, by kind of target; the thresholds of the verdict. A forecast stops early only when the
     * interval of the collapse share is decided: under `stableCollapse` (stable) or over its
     * complement (collapse).
     */
    sessionMinutes: shapeOf('sessionMinutes', z.record(z.string(), z.number())),
    sessionHours: shapeOf('sessionHours', z.record(z.string(), z.number())),
    /** The fewest sessions, and the share of the session budget the "after supplies" forecast may use. */
    minSessions: z.number().int().min(1),
    afterShare: z.number().min(0).max(1),
    /** The planning horizon, in minutes: consumables that run out within it are taken away in the "after supplies" forecast. */
    horizonMinutes: z.number().int().min(1),
    /** The z of the Wilson interval of every share (1.64: a one-sided 95% bound). */
    confidenceZ: z.number().gt(0),
    /** The size of one batch of the first-fight run. */
    batch: shapeOf('batch', z.record(z.string(), z.number())),
    verdict: z.object({
      /** A session whose win rate is under this has collapsed. */
      collapseBelow: z.number(),
      /** A median session win rate under this is hopeless. */
      hopelessBelow: z.number(),
      /** Stable: the median is at least this and no more than `stableCollapse` of the sessions collapse. */
      stableMedian: z.number(),
      stableCollapse: z.number(),
    }),
  }),
  /** Battle report: how many of the latest defeats a report keeps. */
  report: z.object({ defeats: z.number().int().min(1) }),
  operation: z.object({ approachMs: z.number().int(), approachShort: z.number() }),
  /**
   * Missions: the time a level above a stage's requirement saves (per level, never below the floor
   * share), what a mastery level of the technique used saves, the factor of a slower fallback, and
   * the chance of a stage attempt (base at the requirement, plus per level and per mastery level, up to the cap).
   */
  mission: z.object({
    perLevel: z.number(),
    floor: z.number(),
    masteryTime: z.number(),
    slowAlt: z.number(),
    /** The shortest a stage can get: the share of its base time that the modifiers cannot go under. */
    minFactor: z.number(),
    /** Consecutive lost fights at one combat stage after which the mission stops. */
    maxDefeats: z.number().int().min(1),
    /** The skill a fight's style XP goes to when no technique was used. */
    defaultStyle: skillId,
    /** The skills besides the style skill that a fight pays XP to, in the proportions of `K.combatXp`. */
    fightSkills: z.array(skillId),
    success: z.object({
      base: z.number(),
      perLevel: z.number(),
      perMastery: z.number(),
      cap: z.number(),
    }),
  }),
  /**
   * The team: a teammate's level is this share of the player's own level (of the role skill, or of
   * the player's best nature skill for the teammate's nature), at least 1; the mastery a teammate
   * has with the technique he or she performs; and the support in a fight: a hit every `everyMs`
   * (the second teammate starts half a period later) of `damage` x the player's basic damage, which
   * applies the state its nature makes (`states`, null: none).
   */
  team: z.object({
    levelShare: z.number(),
    mastery: z.number().int(),
    support: z.object({ everyMs: z.number().int(), damage: z.number() }),
    states: z.record(z.string(), z.string().nullable()),
  }),
  /** A merchant crate's contents: units of each good (min, max), and the chance of a gem. */
  crate: z.object({
    goods: z.record(z.string(), z.tuple([z.number().int(), z.number().int()])),
    gem: z.object({ item: z.string(), chance: z.number() }),
  }),
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
  /**
   * Exploration: the highest level of a cell with no point of interest, the minutes of a walk
   * within a region and between regions, and the Athletics cut of explore and walk time per level (up to a cap).
   */
  scouting: z.object({
    plainMaxLevel: z.number().int(),
    walkWithinMin: z.number(),
    walkBetweenMin: z.number(),
    athPerLevel: z.number(),
    athCap: z.number(),
  }),
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
  /** Vocabularies: each member is an entity of its pack (see `ContentPack`). */
  skillGroups: z.array(skillGroupSchema),
  natures: z.array(natureSchema),
  playerRanks: z.array(playerRankSchema),
  techRanks: z.array(vocabSchema),
  missionRanks: z.array(vocabSchema),
  villageStages: z.array(villageStageSchema),
  states: z.array(vocabSchema),
  tags: z.array(vocabSchema),
  roles: z.array(vocabSchema),
  attackStyles: z.array(vocabSchema),
  fightRegions: z.array(vocabSchema),
  itemKinds: z.array(vocabSchema),
  currencies: z.array(currencySchema),
  entityKinds: z.array(entityKindSchema),
  trophies: z.array(vocabSchema),
  gearFx: z.array(vocabSchema),
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
  team: z.array(teammateSchema),
  regions: z.array(regionSchema),
  cells: z.array(cellSchema),
  /** What each kind of key cell needs. */
  cellKeys: open<Record<IdTypes['cellKey'], Req>>(z.record(z.string(), reqSchema)),
  enemies: z.array(enemySchema),
  bosses: z.array(bossSchema),
  buildings: z.array(buildingSchema),
  resources: z.array(resourceSchema),
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
    cellKeys: true,
    resources: true,
    operations: true,
    statuses: true,
    traits: true,
    combos: true,
    ai: true,
    team: true,
    skillGroups: true,
    natures: true,
    playerRanks: true,
    techRanks: true,
    missionRanks: true,
    villageStages: true,
    states: true,
    tags: true,
    roles: true,
    attackStyles: true,
    fightRegions: true,
    itemKinds: true,
    currencies: true,
    entityKinds: true,
    trophies: true,
    gearFx: true,
  })
  .extend({
    missions: z.array(missionBaseSchema),
    buildings: z.array(buildingBaseSchema),
    cells: z.array(cellBaseSchema),
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
export type Nature = z.infer<typeof natureSchema>;
export type PlayerRankData = z.infer<typeof playerRankSchema>;
export type CurrencyData = z.infer<typeof currencySchema>;
export type VillageStageData = z.infer<typeof villageStageSchema>;
export type EntityKindData = z.infer<typeof entityKindSchema>;
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
export type MissionBasePay = z.infer<typeof missionBasePaySchema>;
export type MissionBase = z.infer<typeof missionBaseSchema>;
export type MissionExtra = z.infer<typeof missionExtraSchema>;
export type Teammate = z.infer<typeof teammateSchema>;
export type Mission = z.infer<typeof missionSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type Region = z.infer<typeof regionSchema>;
export type Enemy = z.infer<typeof enemySchema>;
export type Boss = z.infer<typeof bossSchema>;
export type Building = z.infer<typeof buildingSchema>;
export type BuildingBase = z.infer<typeof buildingBaseSchema>;
export type BuildingFx = z.infer<typeof buildingFxSchema>;
export type Resource = z.infer<typeof resourceSchema>;
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
/** One pack of the composed database: its manifest. */
const RESERVED_PACK_IDS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);
export const packManifestSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'expected a pack id like core or my_mod')
    .refine((id) => !RESERVED_PACK_IDS.has(id), 'a pack id may not be a member name of Object'),
  version: z.string().min(1),
  dependsOn: z.array(z.string()),
  loadAfter: z.array(z.string()),
});
export type PackManifest = z.infer<typeof packManifestSchema>;

/** Per kind of entity (`skill`, `item`, ...), the icon name of each id; kinds and ids come from the packs. */
export type IconTable = Record<string, Record<string, string>>;

/** What `composeContent` adds to the validated lists. */
export interface ContentDbMeta {
  /** The manifests of the composed packs, in load order. */
  packs: readonly PackManifest[];
  /** Every valid modifier key: the per-skill families of the composed skills plus the keys the packs declare. */
  modifierKeys: Readonly<Record<string, ModifierKeyInfo>>;
  /** Merged icon tables of the packs. */
  icons: IconTable;
  /** Merged display strings of the packs; `en` is canonical names only and not used by the UI. */
  locales: { uk: Readonly<Record<string, string>>; en: Readonly<Record<string, string>> };
}

export type ContentDb = z.infer<typeof contentDbSchema> & ContentDbMeta;
