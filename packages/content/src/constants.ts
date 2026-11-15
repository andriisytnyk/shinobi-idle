/**
 * Vocabulary lists of the built-in pack `core`.
 *
 * @deprecated Every list here is derived from the data of the pack `core` and exists only so that
 * code written before the packs keeps compiling. A vocabulary is open: read it from the composed
 * `ContentDb` (`content.skills`, `content.natures`, `content.tags`, ...). The core and web tasks
 * remove each import of these constants; the importer still reads them as its input.
 */
import type { IdTypes } from '@shinobi/content/typing';
import vocab from './packs/core/data/hand/vocab.json' with { type: 'json' };
import skills from './packs/core/data/generated/skills.json' with { type: 'json' };
import cellKeys from './packs/core/data/hand/cell-keys.json' with { type: 'json' };
import combos from './packs/core/data/hand/combos.json' with { type: 'json' };
import statuses from './packs/core/data/hand/statuses.json' with { type: 'json' };
import traits from './packs/core/data/hand/traits.json' with { type: 'json' };

const ids = (list: readonly { id: string }[]): string[] => list.map((e) => e.id);

// ---------- id types ----------
// Ids are open strings. Code that has not been migrated sees the narrow built-in unions through the
// deprecated tsconfig mapping of '@shinobi/content/typing' (see tsconfig.legacy-ids.json); the
// narrow unions are also exported by name as Legacy<Name>.

export type {
  LegacyAttackStyle,
  LegacyCellKey,
  LegacyComboId,
  LegacyEnemyRegion,
  LegacyMissionRank,
  LegacyNatureId,
  LegacyPlayerRank,
  LegacyRank,
  LegacyRoleId,
  LegacySkillGroup,
  LegacySkillId,
  LegacyStateId,
  LegacyStatusId,
  LegacyTagId,
  LegacyTechSkillId,
  LegacyTraitId,
  LegacyZoneRegion,
} from './typing/legacy.ts';

export type SkillId = IdTypes['skill'];
export type NatureId = IdTypes['nature'];
export type TechSkillId = IdTypes['techSkill'];
export type SkillGroup = IdTypes['skillGroup'];
export type Rank = IdTypes['techRank'];
export type PlayerRank = IdTypes['playerRank'];
export type RoleId = IdTypes['role'];
export type TagId = IdTypes['tag'];
export type TraitId = IdTypes['trait'];
export type StateId = IdTypes['state'];
export type MissionRank = IdTypes['missionRank'];
export type CellKey = IdTypes['cellKey'];
export type StatusId = IdTypes['status'];
export type ComboId = IdTypes['combo'];
export type AttackStyle = IdTypes['attackStyle'];
export type EnemyRegion = IdTypes['enemyRegion'];
export type ZoneRegion = IdTypes['zoneRegion'];

// ---------- lists, derived from the data of the pack core ----------

/** Short skill ids of the built-in pack. */
export const SKILL_IDS = ids(skills) as readonly SkillId[];
export const NATURE_IDS = ids(vocab.natures) as readonly NatureId[];

/** The nature wheel: each nature beats the one it maps to and loses to the one that maps to it. */
export const NATURE_WHEEL = Object.fromEntries(
  vocab.natures.map((n) => [n.id, n.strongAgainst[0]]),
) as Record<NatureId, NatureId>;

/** Skills that own techniques. */
export const TECH_SKILL_IDS = ids(
  skills.filter((s) => s.activity === 'tech'),
) as readonly TechSkillId[];

/** Sidebar groups, in display order. */
export const SKILL_GROUPS = ids(vocab.skillGroups) as readonly SkillGroup[];

/** Technique ranks, weakest first. */
export const RANKS = ids(vocab.techRanks) as readonly Rank[];

/** Ranks the player holds, lowest first. */
export const PLAYER_RANK_IDS = ids(vocab.playerRanks) as readonly PlayerRank[];

/** Technique roles (Ukrainian role names are only localization strings). */
export const ROLE_IDS = ids(vocab.roles) as readonly RoleId[];

/** Tags a technique, tool or recipe can carry; each answers an enemy trait. */
export const TAG_IDS = ids(vocab.tags) as readonly TagId[];

/** Enemy traits (shield is out of the slice). */
export const TRAIT_IDS = ids(traits) as readonly TraitId[];

/** The tag that answers each trait. */
export const TRAIT_ANSWER = Object.fromEntries(traits.map((t) => [t.id, t.answer])) as Record<
  TraitId,
  TagId
>;

export const STATE_IDS = ids(vocab.states) as readonly StateId[];

export const MISSION_RANKS = ids(vocab.missionRanks) as readonly MissionRank[];

export const ENEMY_REGIONS = ids(
  vocab.fightRegions.filter((r) => r.id !== 'boss'),
) as readonly EnemyRegion[];

export const CELL_KEYS = Object.keys(cellKeys) as readonly CellKey[];

/** Natures that open each kind of key cell on the map. Rock and water cells need no nature. */
export const KEY_NATURES = Object.fromEntries(
  CELL_KEYS.map((key) => [
    key,
    vocab.natures.filter((n) => n.opens.includes(key)).map((n) => n.id),
  ]),
) as unknown as Record<CellKey, readonly string[]>;

/** Skills that are open from the first day. */
export const OPEN_SKILL_IDS = ['tai', 'nin', 'cc', 'med', 'ath'] as const;

/** Skills that open with the first fight; every other skill opens at the Genin rank. */
export const FIGHT_SKILL_IDS = ['vit'] as const;

/** The flag the combat stage raises on the first fight. */
export const FIRST_FIGHT_FLAG = 'firstFight';

/** Statuses a fighter can carry. Burn, stun and wet are technique states; bind and poison come from other effects. */
export const STATUS_IDS = ids(statuses) as readonly StatusId[];

/** Combos of states: a nature hitting a fighter that already carries a state. */
export const COMBO_IDS = ids(combos) as readonly ComboId[];

/** How an enemy attacks. */
export const ATTACK_STYLES = ids(vocab.attackStyles) as readonly AttackStyle[];

/** Where a fightable zone lies: a region of the map, the Academy yard, the exam forest or a boss. */
export const ZONE_REGIONS = ids(
  vocab.fightRegions.filter((r) => r.id !== 'mission'),
) as readonly ZoneRegion[];
