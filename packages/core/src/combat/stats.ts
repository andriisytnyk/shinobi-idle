import type { ContentDb, Enemy, SkillId, Technique } from '@shinobi/content';
import { MS_PER_SECOND, masteryLevel, techniqueCastSeconds } from '../formulas.ts';
import { computeMod } from '../modifiers.ts';
import { skillLevel } from '../requirements.ts';
import type { Rules } from '../rules.ts';
import type { GameState } from '../state.ts';

/** Melvor hit chance, clamped to the balance bounds. */
export function hitChance(accuracy: number, evasion: number, content: ContentDb): number {
  const K = content.balance.K;
  const raw =
    accuracy < evasion
      ? (K.combat.hitEven * accuracy) / evasion
      : 1 - (K.combat.hitEven * evasion) / accuracy;
  return Math.min(K.hitMax, Math.max(K.hitMin, raw));
}

const level = (state: GameState, skill: SkillId, content: ContentDb) =>
  skillLevel(state, skill, content);

export function playerMaxHp(state: GameState, content: ContentDb): number {
  const K = content.balance.K;
  return K.hpBase + K.hpPerVit * level(state, 'vit', content);
}

export function playerMaxChakra(state: GameState, content: ContentDb): number {
  const K = content.balance.K;
  return K.chakraBase * (1 + K.chakraPerMed * level(state, 'med', content));
}

export function playerChakraRegen(state: GameState, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.chakraRegen;
  return base + perLevel * level(state, 'med', content);
}

export function playerMaxStamina(state: GameState, content: ContentDb): number {
  const K = content.balance.K;
  return K.staminaBase * (1 + K.staminaPerAth * level(state, 'ath', content));
}

export function playerStaminaRegen(state: GameState, content: ContentDb): number {
  const [base, perLevel] = content.balance.K.staminaRegen;
  return base + perLevel * level(state, 'ath', content);
}

export function playerEvasion(state: GameState, content: ContentDb): number {
  const K = content.balance.K;
  return K.evaBase + K.evaPerLevel * level(state, 'eva', content);
}

/** Accuracy rating when attacking with a technique of `skill`. */
export function playerAccuracy(state: GameState, skill: SkillId, content: ContentDb): number {
  const K = content.balance.K;
  return K.accBase + K.accPerLevel * level(state, skill, content);
}

/** The skill level a basic attack uses: the higher of Taijutsu and Ninjutsu. */
export function basicSkillLevel(state: GameState, content: ContentDb): number {
  return Math.max(level(state, 'tai', content), level(state, 'nin', content));
}

export interface BasicAttack {
  accuracy: number;
  damage: number;
  intervalMs: number;
}

export function basicAttack(state: GameState, content: ContentDb): BasicAttack {
  const K = content.balance.K;
  const lvl = basicSkillLevel(state, content);
  return {
    accuracy: K.accBase + K.accPerLevel * lvl,
    damage: K.basicDmg[0] + K.basicDmg[1] * lvl,
    intervalMs: Math.round(K.basicInterval * MS_PER_SECOND),
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
    intervalMs: Math.round(K.eInterval * MS_PER_SECOND),
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
export function techniqueNumbers(
  state: GameState,
  tech: Technique,
  content: ContentDb,
  rules: Rules,
): TechniqueNumbers {
  const K = content.balance.K;
  const role = K.role[tech.role];
  const rank = tech.rank;
  const pool = tech.skill === 'tai' ? 'stamina' : 'chakra';
  if (rank === null) return { damage: 0, castMs: 0, cooldownMs: 0, pool, cost: 0 };
  const skillLvl = level(state, tech.skill, content);
  const mastery = masteryLevel(state, tech.id, content);
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
    (pool === 'chakra' ? 1 - K.ccCostPerLevel * level(state, 'cc', content) : 1);
  const mod = computeMod(rules.modifierProviders, state, `cost.${pool}`, content).total;
  return {
    damage,
    castMs: Math.round(cast * MS_PER_SECOND),
    cooldownMs: Math.round(role.cd * K.rankCd[rank] * MS_PER_SECOND),
    pool,
    cost: base * reduction * mod,
  };
}
