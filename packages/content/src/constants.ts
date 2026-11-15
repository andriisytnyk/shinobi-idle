/** Short skill ids. Skills are the only entities that do not use the `core:` prefix. */
export const SKILL_IDS = [
  'tai',
  'nin',
  'katon',
  'futon',
  'raiton',
  'doton',
  'suiton',
  'cc',
  'med',
  'ath',
  'herb',
  'scout',
  'prov',
  'alch',
  'vit',
  'eva',
] as const;

export const NATURE_IDS = ['katon', 'futon', 'raiton', 'doton', 'suiton'] as const;

/** The nature wheel: each nature beats the one it maps to and loses to the one that maps to it. */
export const NATURE_WHEEL: Record<(typeof NATURE_IDS)[number], (typeof NATURE_IDS)[number]> = {
  katon: 'futon',
  futon: 'raiton',
  raiton: 'doton',
  doton: 'suiton',
  suiton: 'katon',
};

/** Skills that own techniques. */
export const TECH_SKILL_IDS = ['tai', 'nin', ...NATURE_IDS] as const;

/** Sidebar groups, in display order. */
export const SKILL_GROUPS = ['train', 'nin', 'field', 'craft', 'combat'] as const;

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;

/** Ranks the player holds, lowest first. */
export const PLAYER_RANK_IDS = ['student', 'genin', 'chunin'] as const;

/** Technique roles (Ukrainian role names are only localization strings). */
export const ROLE_IDS = [
  'projectile',
  'series',
  'area',
  'control',
  'defense',
  'buff',
  'signature',
  'drill',
] as const;

/** Tags a technique, tool or recipe can carry; each answers an enemy trait. */
export const TAG_IDS = [
  'interrupt',
  'area',
  'guard',
  'reveal',
  'bind',
  'dot',
  'pierce',
  'cleanse',
  'dispel',
] as const;

/** Enemy traits (shield is out of the slice). */
export const TRAIT_IDS = [
  'armor',
  'caster',
  'pack',
  'evasive',
  'regen',
  'illusionist',
  'hidden',
  'poisoner',
] as const;

/** The tag that answers each trait. */
export const TRAIT_ANSWER: Record<(typeof TRAIT_IDS)[number], (typeof TAG_IDS)[number]> = {
  armor: 'pierce',
  caster: 'interrupt',
  pack: 'area',
  evasive: 'bind',
  regen: 'dot',
  illusionist: 'dispel',
  hidden: 'reveal',
  poisoner: 'cleanse',
};

export const STATE_IDS = ['burn', 'stun', 'wet'] as const;

export const MISSION_RANKS = ['D', 'C', 'V', 'OP'] as const;

export const ENEMY_REGIONS = ['academy', 'forest', 'plains', 'valley', 'exam', 'mission'] as const;

export const CELL_KEYS = ['rock', 'brush', 'water', 'mist', 'rubble'] as const;

/** Natures that open each kind of key cell on the map. Rock and water cells need no nature. */
export const KEY_NATURES: Record<(typeof CELL_KEYS)[number], readonly string[]> = {
  rock: [],
  water: [],
  brush: ['katon', 'futon'],
  mist: ['futon'],
  rubble: ['doton'],
};

/** Skills that are open from the first day. */
export const OPEN_SKILL_IDS = ['tai', 'nin', 'cc', 'med', 'ath'] as const;

/** Skills that open with the first fight; every other skill opens at the Genin rank. */
export const FIGHT_SKILL_IDS = ['vit', 'eva'] as const;

/** The flag the combat stage raises on the first fight. */
export const FIRST_FIGHT_FLAG = 'firstFight';

export type SkillId = (typeof SKILL_IDS)[number];
export type NatureId = (typeof NATURE_IDS)[number];
export type TechSkillId = (typeof TECH_SKILL_IDS)[number];
export type SkillGroup = (typeof SKILL_GROUPS)[number];
export type Rank = (typeof RANKS)[number];
export type PlayerRank = (typeof PLAYER_RANK_IDS)[number];
export type RoleId = (typeof ROLE_IDS)[number];
export type TagId = (typeof TAG_IDS)[number];
export type TraitId = (typeof TRAIT_IDS)[number];
export type StateId = (typeof STATE_IDS)[number];
export type MissionRank = (typeof MISSION_RANKS)[number];
export type CellKey = (typeof CELL_KEYS)[number];

/** Statuses a fighter can carry. Burn, stun and wet are technique states; bind and poison come from other effects. */
export const STATUS_IDS = ['burn', 'wet', 'stun', 'bind', 'poison'] as const;

/** Combos of states: a nature hitting a fighter that already carries a state. */
export const COMBO_IDS = ['fanBurn', 'shockWet', 'mudEva', 'steam'] as const;

/** How an enemy attacks. */
export const ATTACK_STYLES = ['melee', 'ranged'] as const;

/** Where a fightable zone lies: a region of the map, the Academy yard, the exam forest or a boss. */
export const ZONE_REGIONS = ['academy', 'forest', 'plains', 'valley', 'exam', 'boss'] as const;

export type StatusId = (typeof STATUS_IDS)[number];
export type ComboId = (typeof COMBO_IDS)[number];
export type AttackStyle = (typeof ATTACK_STYLES)[number];
export type ZoneRegion = (typeof ZONE_REGIONS)[number];
