/* eslint-disable @typescript-eslint/no-unused-vars -- the shape consts exist only to give the types */
/**
 * @deprecated The narrow view of the ids and balance records: the literal unions of the built-in
 * pack. Only code that has not been migrated to the open vocabularies reads it, through the
 * tsconfig mapping of `@shinobi/content/typing`. The types `Legacy<Name>` are also exported by
 * name for explicit use. Never imported at run time.
 */
import { z } from 'zod';

export type LegacySkillId =
  | 'tai'
  | 'nin'
  | 'katon'
  | 'futon'
  | 'raiton'
  | 'doton'
  | 'suiton'
  | 'cc'
  | 'med'
  | 'ath'
  | 'herb'
  | 'scout'
  | 'prov'
  | 'alch'
  | 'vit';
export type LegacyNatureId = 'katon' | 'futon' | 'raiton' | 'doton' | 'suiton';
export type LegacyTechSkillId = 'tai' | 'nin' | LegacyNatureId;
export type LegacySkillGroup = 'train' | 'nin' | 'field' | 'craft' | 'combat';
export type LegacyRank = 'E' | 'D' | 'C' | 'B' | 'A' | 'S';
export type LegacyPlayerRank = 'student' | 'genin' | 'chunin';
export type LegacyRoleId =
  'projectile' | 'series' | 'area' | 'control' | 'defense' | 'buff' | 'signature' | 'drill';
export type LegacyTagId =
  'interrupt' | 'area' | 'guard' | 'reveal' | 'bind' | 'dot' | 'pierce' | 'cleanse' | 'dispel';
export type LegacyTraitId =
  'armor' | 'caster' | 'pack' | 'evasive' | 'regen' | 'illusionist' | 'hidden' | 'poisoner';
export type LegacyStateId = 'burn' | 'stun' | 'wet';
export type LegacyMissionRank = 'D' | 'C' | 'V' | 'OP';
export type LegacyCellKey = 'rock' | 'brush' | 'water' | 'mist' | 'rubble';
export type LegacyStatusId = 'burn' | 'wet' | 'stun' | 'bind' | 'poison';
export type LegacyComboId = 'fanBurn' | 'shockWet' | 'mudEva' | 'steam';
export type LegacyAttackStyle = 'melee' | 'ranged';
export type LegacyEnemyRegion = 'academy' | 'forest' | 'plains' | 'valley' | 'exam' | 'mission';
export type LegacyZoneRegion = 'academy' | 'forest' | 'plains' | 'valley' | 'exam' | 'boss';
export type LegacyLocaleKind =
  | 'skill'
  | 'technique'
  | 'seal'
  | 'exercise'
  | 'practice'
  | 'obstacle'
  | 'item'
  | 'recipe'
  | 'mission'
  | 'region'
  | 'cell'
  | 'poi'
  | 'enemy'
  | 'boss'
  | 'building'
  | 'gear'
  | 'pool'
  | 'resource'
  | 'trait'
  | 'tag'
  | 'role'
  | 'state'
  | 'status'
  | 'combo'
  | 'operation'
  | 'exam'
  | 'quest'
  | 'group';

export interface IdTypes {
  skill: LegacySkillId;
  nature: LegacyNatureId;
  techSkill: LegacyTechSkillId;
  techRank: LegacyRank;
  playerRank: LegacyPlayerRank;
  role: LegacyRoleId;
  tag: LegacyTagId;
  trait: LegacyTraitId;
  state: LegacyStateId;
  status: LegacyStatusId;
  combo: LegacyComboId;
  missionRank: LegacyMissionRank;
  cellKey: LegacyCellKey;
  enemyRegion: LegacyEnemyRegion;
  attackStyle: LegacyAttackStyle;
  zoneRegion: LegacyZoneRegion;
  skillGroup: LegacySkillGroup;
  fxShield: 'shield';
  fxDecoy: 'decoy';
  fxEvasionBuff: 'evasionBuff';
  fxPassiveNegate: 'passiveNegate';
  fxNextCast: 'nextCast';
  fxReveal: 'reveal';
  fxSleep: 'sleep';
  fxWolfPack: 'wolfPack';
  fxDrunkenEvasion: 'drunkenEvasion';
  fxHeavyCast: 'heavyCast';
  fxTwins: 'twins';
  fxMistRehide: 'mistRehide';
  fxIllusion: 'illusion';
  fxStance: 'gateOpening' | 'gateHealing';
  fxRival: 'rivalDuel' | 'rivalTournament';
  itemKind: 'ingredient' | 'tool' | 'misc' | 'consumable';
  trophy: 'band' | 'pelt' | 'fang' | 'coin' | 'gem';
  recipeSkill: 'alch' | 'prov';
  gearFxKey: 'mannequin' | 'sickle' | 'alembic' | 'stations' | 'maps';
  partChance: 'mission';
  aiTier: 'genin' | 'chunin';
  entityKind:
    | 'skill'
    | 'technique'
    | 'item'
    | 'recipe'
    | 'mission'
    | 'enemy'
    | 'region'
    | 'building'
    | 'quest'
    | 'gear'
    | 'seal';
  iconKind:
    | 'skill'
    | 'technique'
    | 'item'
    | 'status'
    | 'trait'
    | 'nature'
    | 'currency'
    | 'enemy'
    | 'boss'
    | 'building'
    | 'region'
    | 'gear'
    | 'exercise'
    | 'practice'
    | 'obstacle'
    | 'recipe';
  localeKind: LegacyLocaleKind;
}

const pair = z.tuple([z.number(), z.number()]);
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
void pair;
const comboShape = z.object({
  base: z.number(),
  perLevel: z.number(),
  perMastery: z.number(),
  cap: z.number(),
  fanBurn: z.number(),
  shockWet: z.number(),
  mudEva: z.number(),
  steam: z.number(),
});
const techFxShape = z.object({
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
});
const bossFxShape = z.object({
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
});
const dropChanceShape = z.object({
  band: z.number(),
  pelt: z.number(),
  fang: z.number(),
  coin: z.number(),
  gem: z.number(),
});
const kSellShape = z.object({
  band: z.number().int(),
  pelt: z.number().int(),
  fang: z.number().int(),
  coin: z.number().int(),
  gem: z.number().int(),
});
const traitShape = z.object({
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
});
const ryoPerMinShape = z.object({ D: z.number(), C: z.number(), V: z.number(), OP: z.number() });
const repPerMissionShape = z.object({ D: z.number(), C: z.number(), V: z.number() });
const missionRateCapShape = z.object({ D: z.number(), C: z.number(), V: z.number() });
const repShape = z.object({
  stage2: z.number(),
  exam: z.number(),
  boss: z.number(),
  questFinal: z.number(),
});
const partDropShape = z.object({ boss: z.number(), carrier: z.number(), mission: z.number() });
const gearFxShape = z.object({
  mannequin: z.number(),
  sickle: z.number(),
  alembic: z.number(),
  stations: z.number(),
  maps: z.number(),
});
const itemFxShape = z.object({ sleep: z.object({ chance: z.number() }) });
const loadoutSlotsShape = z.object({ genin: z.number().int(), chunin: z.number().int() });
const loadoutNaturesShape = z.object({ genin: z.number().int(), chunin: z.number().int() });
const sessionMinutesShape = z.object({
  zone: z.number().int().min(1),
  boss: z.number().int().min(1),
  operation: z.number().int().min(1),
});
const sessionHoursShape = z.object({
  zone: z.number().min(1),
  boss: z.number().min(1),
  operation: z.number().min(1),
});
const batchShape = z.object({ zone: z.number().int().min(1), operation: z.number().int().min(1) });

export interface ShapeTypes {
  byRank: Record<LegacyRank, number>;
  kRole: Record<LegacyRoleId, { m: number; cd: number; c: number }>;
  stun: { C: number; B: number; D: number };
  combo: z.infer<typeof comboShape>;
  techFx: z.infer<typeof techFxShape>;
  bossFx: z.infer<typeof bossFxShape>;
  dropChance: z.infer<typeof dropChanceShape>;
  kSell: z.infer<typeof kSellShape>;
  trait: z.infer<typeof traitShape>;
  ryoPerMin: z.infer<typeof ryoPerMinShape>;
  repPerMission: z.infer<typeof repPerMissionShape>;
  missionRateCap: z.infer<typeof missionRateCapShape>;
  rep: z.infer<typeof repShape>;
  partDrop: z.infer<typeof partDropShape>;
  gearFx: z.infer<typeof gearFxShape>;
  itemFx: z.infer<typeof itemFxShape>;
  loadoutSlots: z.infer<typeof loadoutSlotsShape>;
  loadoutNatures: z.infer<typeof loadoutNaturesShape>;
  sessionMinutes: z.infer<typeof sessionMinutesShape>;
  sessionHours: z.infer<typeof sessionHoursShape>;
  batch: z.infer<typeof batchShape>;
}
