import type { ContentDb, Enemy, NatureId, SkillId, Technique } from '@shinobi/content';
import { MS_PER_SECOND, techniqueCastSeconds } from '../formulas.ts';
import { nonNativeLevel } from '../natures.ts';
import { fightData } from './fight-data.ts';
import { need } from './need.ts';

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
  /** Techniques taken into the fight; absent means every known technique. */
  loadout?: string[];
  /** Trait ids the player knows, per enemy id; an enemy without an entry is fully known. */
  knowledge?: Record<string, string[]>;
  /** The player's rank tier (0 student, 1 genin, ...); absent means 0. */
  tier?: number;
  /** The signature technique, which habituates more slowly. */
  signature?: string;
  /** The pouch, slot by slot (an empty slot has an empty id), and the slot the medic pouch empties on its own. */
  pouch?: { id: string; n: number }[];
  medic?: number | null;
  /** Wound stacks; each one cuts the combat stats. */
  wounds?: number;
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
  return K.hpBase + K.hpPerVit * (levels.vit ?? 1);
}

export function maxChakraOf(levels: Levels, content: ContentDb): number {
  const K = content.balance.K;
  return K.chakraBase * (1 + K.chakraPerMed * (levels.med ?? 1));
}

export function chakraRegenOf(levels: Levels, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.chakraRegen;
  return (base ?? 0) + (perLevel ?? 0) * (levels.med ?? 1);
}

export function maxStaminaOf(levels: Levels, content: ContentDb): number {
  const K = content.balance.K;
  return K.staminaBase * (1 + K.staminaPerAth * (levels.ath ?? 1));
}

export function staminaRegenOf(levels: Levels, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.staminaRegen;
  return (base ?? 0) + (perLevel ?? 0) * (levels.ath ?? 1);
}

/**
 * The evasion rating of the player: the base, a term per rank tier and what the known defensive
 * techniques add, scaled by their mastery (the share a technique gives for merely being known at
 * mastery 1, all of it at the cap). There is no skill term.
 */
export function evasionOf(
  snap: Pick<PlayerSnapshot, 'tier' | 'known' | 'mastery'>,
  content: ContentDb,
): number {
  const K = content.balance.K;
  let rating = K.evaBase + K.rating.evaTier * (snap.tier ?? 0);
  const known = new Set(snap.known);
  for (const tech of content.techniques) {
    const fx = tech.combat?.passive?.fx;
    if (fx === undefined || !known.has(tech.id)) continue;
    const row = need(K.passiveFx[fx], `passiveFx.${fx}`);
    const share = (Math.max(1, snap.mastery[tech.id] ?? 1) - 1) / (K.masteryCap - 1);
    rating += row.evasion * (row.base + (1 - row.base) * Math.min(1, share));
  }
  return rating;
}

/** Accuracy rating when attacking with a technique of `skill`. */
export function accuracyOf(levels: Levels, skill: SkillId, content: ContentDb): number {
  const K = content.balance.K;
  return K.accBase + K.accPerLevel * (levels[skill] ?? 1);
}

export interface BasicAttack {
  accuracy: number;
  damage: number;
  /** How long the plain strike takes, in ms: it is an action of its own. */
  castMs: number;
  /** The stamina it costs. */
  cost: number;
}

/** The basic attack uses the higher of the Taijutsu and Ninjutsu levels. */
export function basicAttackOf(levels: Levels, content: ContentDb): BasicAttack {
  const K = content.balance.K;
  const lvl = Math.max(levels.tai ?? 1, levels.nin ?? 1);
  return {
    accuracy: K.accBase + K.accPerLevel * lvl,
    damage: K.basicDmg[0] + K.basicDmg[1] * lvl,
    castMs: secMs(K.basicCast),
    cost: K.basicCost,
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
export function enemyStats(enemy: Pick<Enemy, 'cl'>, content: ContentDb): EnemyStats {
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
  snap: Pick<PlayerSnapshot, 'levels' | 'mastery' | 'costMod'> & { natures?: readonly NatureId[] },
  tech: Technique,
  content: ContentDb,
): TechniqueNumbers {
  const K = content.balance.K;
  const role = need(K.role[tech.role], `role.${tech.role}`);
  const rank = tech.rank;
  const pool = fightData(content).physical.has(tech.skill) ? 'stamina' : 'chakra';
  if (rank === null) return { damage: 0, castMs: 0, cooldownMs: 0, pool, cost: 0 };
  const skillLvl = snap.levels[tech.skill] ?? 1;
  const mastery = snap.mastery[tech.id] ?? 1;
  const masteryShare = mastery / K.masteryCap;
  const damage = tech.noDamage
    ? 0
    : need(K.power[rank], `power.${rank}`) *
      role.m *
      need(K.tierMult[`${tech.tier}`], `tierMult.${tech.tier}`) *
      (1 + K.levelScale * skillLvl) *
      (1 + K.masteryDmg * masteryShare);
  const cast = techniqueCastSeconds(
    tech,
    mastery,
    content,
    nonNativeLevel(tech.skill, snap.natures ?? [], skillLvl, content),
  );
  const base =
    need(pool === 'stamina' ? K.staminaCost[rank] : K.chakraCost[rank], `cost.${rank}`) * role.c;
  const reduction =
    (1 - K.masteryCost * masteryShare) *
    (pool === 'chakra' ? 1 - K.ccCostPerLevel * (snap.levels.cc ?? 1) : 1);
  return {
    damage,
    castMs: secMs(cast),
    cooldownMs: secMs(role.cd * need(K.rankCd[rank], `rankCd.${rank}`)),
    pool,
    cost: base * reduction * snap.costMod[pool],
  };
}
