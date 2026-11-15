import type { Boss, ContentDb, Enemy, NatureId } from '@shinobi/content';
import { encounterFor } from '@shinobi/core';

/** What the simplified balance model (docs: «модель балансу», `balance.mjs`) expects of one fight. */
export interface ModelExpectation {
  /** Seconds to kill everything: total enemy health over the player's expected damage per second. */
  ttkSec: number;
  /** Share of the player's health the enemy takes off over that time. */
  hpLossShare: number;
  /** Expected damage per second of the player. */
  playerDps: number;
}

/** Melvor hit chance as the balance model writes it, clamped to the balance bounds. */
function hit(acc: number, eva: number, content: ContentDb): number {
  const K = content.balance.K;
  const raw = acc >= eva ? 1 - (K.combat.hitEven * eva) / acc : (K.combat.hitEven * acc) / eva;
  return Math.min(K.hitMax, Math.max(K.hitMin, raw));
}

/**
 * The model's player at `level` (every skill, native nature `natures[0]`, techniques at
 * `mastery`) against the entry. The player carries the four techniques with the best damage per
 * cycle among the damaging ones he could know, plus basic attacks in the gaps; the enemy bodies
 * come from `encounterFor`, their numbers from the level formulas. All numbers are read from the
 * balance data; nothing is copied by hand. Returns null for an entry with no damage to count.
 */
export function modelExpectation(
  entry: Enemy | Boss,
  level: number,
  natures: readonly NatureId[],
  mastery: number,
  content: ContentDb,
): ModelExpectation | null {
  const K = content.balance.K;
  const encounter = encounterFor(entry, content);
  const bodies = encounter.spawns.reduce((n, s) => n + s.count, 0);
  const eHp = (cl: number) => K.eHp[0] + K.eHp[1] * cl;
  const eDmg = (cl: number) => K.eDmg[0] + K.eDmg[1] * cl;
  const hpTotal = encounter.spawns.reduce((sum, s) => sum + s.count * eHp(s.cl) * s.hpMult, 0);

  const acc = K.accBase + K.accPerLevel * level;
  const eva = K.evaBase + K.evaPerLevel * level;
  const m = mastery / K.masteryCap;
  const owned = new Set<string>(['tai', 'nin', ...natures.slice(0, 1)]);
  const figures = content.techniques
    .filter((t) => t.rank !== null && !t.noDamage && owned.has(t.skill) && t.level <= level)
    .map((t) => {
      const role = K.role[t.role];
      const rank = t.rank as keyof typeof K.power;
      const seals = Math.max(
        Math.round(t.sealSeq.length * (1 - K.masteryCast * m)),
        t.sealSeq.length > 0 ? 1 : 0,
      );
      const cast = Math.max(K.castFloor, K.castBase + K.castPerSeal * seals);
      const cycle = cast + role.cd * K.rankCd[rank];
      const reach = t.role === 'area' ? Math.min(bodies, K.loadout.areaBodies) : 1;
      return {
        cast,
        cycle,
        value:
          K.power[rank] *
          role.m *
          K.tierMult[`${t.tier}`] *
          (1 + K.levelScale * level) *
          (1 + K.masteryDmg * m) *
          reach,
      };
    })
    .filter((f) => f.value > 0)
    .sort((a, b) => b.value / b.cycle - a.value / a.cycle)
    .slice(0, K.loadout.slots.genin);
  const first = encounter.spawns[0];
  if (!first) return null;
  const hitRate = hit(acc, K.eEva[0] + K.eEva[1] * first.cl, content);
  const busy = Math.min(
    1,
    figures.reduce((s, f) => s + f.cast / f.cycle, 0),
  );
  const basic = K.basicDmg[0] + K.basicDmg[1] * level;
  const playerDps =
    hitRate *
    (figures.reduce((s, f) => s + f.value / f.cycle, 0) + ((1 - busy) * basic) / K.basicInterval);
  if (!(playerDps > 0)) return null;
  const ttkSec = hpTotal / playerDps;

  const enemyHit = (cl: number) => hit(K.eAcc[0] + K.eAcc[1] * cl, eva, content);
  const enemyDps = encounter.spawns.reduce(
    (sum, s) => sum + (s.count * eDmg(s.cl) * s.dmgMult * enemyHit(s.cl)) / K.eInterval,
    0,
  );
  const playerHp = K.hpBase + K.hpPerVit * level;
  return { ttkSec, hpLossShare: (enemyDps * ttkSec) / playerHp, playerDps };
}
