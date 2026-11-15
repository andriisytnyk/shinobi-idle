import type { ContentDb, Enemy, NatureId, SkillId, Technique } from '@shinobi/content';
import { MS_PER_SECOND, techniqueCastSeconds } from '../formulas.ts';

/**
 * Everything a fight needs to know about the player, as plain JSON. It is built from the game
 * state by `snapshotPlayer` and can equally be written by hand for battle analysis.
 */
export interface PlayerSnapshot {
  /** Level of every skill. */
  levels: Record<SkillId, number>;
  /** Mastery level per technique id; a technique without an entry is at level 1. */
  mastery: Record<string, number>;
  /** Ids of the techniques the player may use. */
  known: string[];
  natures: NatureId[];
  /** Multipliers on technique cost, from items and village. */
  costMod: { chakra: number; stamina: number };
  /** Pools at the start of the fight; absent means full. */
  hp?: number;
  chakra?: number;
  stamina?: number;
}

export type Levels = PlayerSnapshot['levels'];

/** Whole ms in a number of seconds from the balance object. */
export const secMs = (seconds: number): number => Math.round(seconds * MS_PER_SECOND);

/** Melvor hit chance, clamped to the balance bounds. */
export function hitChance(accuracy: number, evasion: number, content: ContentDb): number {
  const K = content.balance.K;
  const raw =
    accuracy < evasion
      ? (K.combat.hitEven * accuracy) / evasion
      : 1 - (K.combat.hitEven * evasion) / accuracy;
  return Math.min(K.hitMax, Math.max(K.hitMin, raw));
}

export function maxHpOf(levels: Levels, content: ContentDb): number {
  const K = content.balance.K;
  return K.hpBase + K.hpPerVit * levels.vit;
}

export function maxChakraOf(levels: Levels, content: ContentDb): number {
  const K = content.balance.K;
  return K.chakraBase * (1 + K.chakraPerMed * levels.med);
}

export function chakraRegenOf(levels: Levels, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.chakraRegen;
  return base + perLevel * levels.med;
}

export function maxStaminaOf(levels: Levels, content: ContentDb): number {
  const K = content.balance.K;
  return K.staminaBase * (1 + K.staminaPerAth * levels.ath);
}

export function staminaRegenOf(levels: Levels, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.staminaRegen;
  return base + perLevel * levels.ath;
}

export function evasionOf(levels: Levels, content: ContentDb): number {
  const K = content.balance.K;
  return K.evaBase + K.evaPerLevel * levels.eva;
}

/** Accuracy rating when attacking with a technique of `skill`. */
export function accuracyOf(levels: Levels, skill: SkillId, content: ContentDb): number {
  const K = content.balance.K;
  return K.accBase + K.accPerLevel * levels[skill];
}

export interface BasicAttack {
  accuracy: number;
  damage: number;
  intervalMs: number;
}

/** The basic attack uses the higher of the Taijutsu and Ninjutsu levels. */
export function basicAttackOf(levels: Levels, content: ContentDb): BasicAttack {
  const K = content.balance.K;
  const lvl = Math.max(levels.tai, levels.nin);
  return {
    accuracy: K.accBase + K.accPerLevel * lvl,
    damage: K.basicDmg[0] + K.basicDmg[1] * lvl,
    intervalMs: secMs(K.basicInterval),
  };
}

export interface EnemyStats {
  maxHp: number;
  damage: number;
  intervalMs: number;
  accuracy: number;
  evasion: number;
}

/** An enemy's numbers from its combat level. */
export function enemyStats(enemy: Enemy, content: ContentDb): EnemyStats {
  const K = content.balance.K;
  const cl = enemy.cl;
  return {
    maxHp: K.eHp[0] + K.eHp[1] * cl,
    damage: K.eDmg[0] + K.eDmg[1] * cl,
    intervalMs: secMs(K.eInterval),
    accuracy: K.eAcc[0] + K.eAcc[1] * cl,
    evasion: K.eEva[0] + K.eEva[1] * cl,
  };
}

export interface TechniqueNumbers {
  /** Damage of one hit; 0 for techniques that do none (defense, buff, drills). */
  damage: number;
  castMs: number;
  cooldownMs: number;
  /** Pool the technique draws on and how much; Taijutsu spends stamina, everything else chakra. */
  pool: 'chakra' | 'stamina';
  cost: number;
}

/** Everything a technique does in a fight, from the balance formulas. */
export function techniqueFigures(
  snap: Pick<PlayerSnapshot, 'levels' | 'mastery' | 'costMod'>,
  tech: Technique,
  content: ContentDb,
): TechniqueNumbers {
  const K = content.balance.K;
  const role = K.role[tech.role];
  const rank = tech.rank;
  const pool = tech.skill === 'tai' ? 'stamina' : 'chakra';
  if (rank === null) return { damage: 0, castMs: 0, cooldownMs: 0, pool, cost: 0 };
  const skillLvl = snap.levels[tech.skill];
  const mastery = snap.mastery[tech.id] ?? 1;
  const masteryShare = mastery / K.masteryCap;
  const damage = tech.noDamage
    ? 0
    : K.power[rank] *
      role.m *
      K.tierMult[`${tech.tier}`] *
      (1 + K.levelScale * skillLvl) *
      (1 + K.masteryDmg * masteryShare);
  const cast = Math.max(K.castFloor, techniqueCastSeconds(tech.sealSeq.length, mastery, content));
  const base = (pool === 'stamina' ? K.staminaCost[rank] : K.chakraCost[rank]) * role.c;
  const reduction =
    (1 - K.masteryCost * masteryShare) *
    (pool === 'chakra' ? 1 - K.ccCostPerLevel * snap.levels.cc : 1);
  return {
    damage,
    castMs: secMs(cast),
    cooldownMs: secMs(role.cd * K.rankCd[rank]),
    pool,
    cost: base * reduction * snap.costMod[pool],
  };
}
