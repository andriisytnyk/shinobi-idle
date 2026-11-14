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

/** Skills that own techniques. */
export const TECH_SKILL_IDS = ['tai', 'nin', ...NATURE_IDS] as const;

/** Sidebar groups, in display order. */
export const SKILL_GROUPS = ['train', 'nin', 'field', 'craft', 'combat'] as const;

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;

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

export type SkillId = (typeof SKILL_IDS)[number];
export type NatureId = (typeof NATURE_IDS)[number];
export type TechSkillId = (typeof TECH_SKILL_IDS)[number];
export type SkillGroup = (typeof SKILL_GROUPS)[number];
export type Rank = (typeof RANKS)[number];
export type RoleId = (typeof ROLE_IDS)[number];
export type TagId = (typeof TAG_IDS)[number];
export type TraitId = (typeof TRAIT_IDS)[number];
export type StateId = (typeof STATE_IDS)[number];
export type MissionRank = (typeof MISSION_RANKS)[number];
export type CellKey = (typeof CELL_KEYS)[number];
