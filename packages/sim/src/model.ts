import { NATURE_IDS, type Boss, type ContentDb, type Enemy, type NatureId } from '@shinobi/content';
import { encounterFor, loadoutLimits, planningSnapshot, type GameState } from '@shinobi/core';
import { BASIC_SKILLS } from './constants.ts';

/** What the simplified balance model (docs: «модель балансу», `balance.mjs`) expects of one fight. */
export interface ModelExpectation {
  /** Seconds to kill everything: total enemy health over the player's expected damage per second. */
  ttkSec: number;
  /** Share of the player's health the enemy takes off over that time. */
  hpLossShare: number;
  /** Expected damage per second of the player. */
  playerDps: number;
}

/**
 * What the model still ignores, for the report header: the enemy's traits and the character's
 * answers to them, resource costs (chakra, stamina), habituation to repeated techniques and the
 * nature wheel. Pouch tools and meals are not in the model either; the report runs its comparison
 * on fights without tools and gives meals only where it says so.
 */
export const MODEL_IGNORES = [
  'риси ворога і відповіді на них',
  'вартість технік (чакра, витривалість)',
  'звикання до повторів',
  'колесо природ',
  'інструменти підсумку',
] as const;

/** Melvor hit chance as the balance model writes it, clamped to the balance bounds. */
function hit(acc: number, eva: number, content: ContentDb): number {
  const K = content.balance.K;
  const raw = acc >= eva ? 1 - (K.combat.hitEven * eva) / acc : (K.combat.hitEven * acc) / eva;
  return Math.min(K.hitMax, Math.max(K.hitMin, raw));
}

/** Every subset of `items` of at most `size` elements. */
function subsets<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [[]];
  for (const item of items) {
    for (const s of [...out]) if (s.length < size) out.push([...s, item]);
  }
  return out;
}

/**
 * The model's player for this very character: the same skill levels, masteries, natures, known
 * techniques and rank (so the same number of loadout slots and distinct natures), against the
 * entry. It carries the techniques with the best damage per cycle among those that fit the rank's
 * limits, plus basic attacks in the gaps. All numbers come from the balance data; nothing is
 * copied by hand. Returns null for an entry with no damage to count.
 */
export function modelExpectation(
  entry: Enemy | Boss,
  state: GameState,
  content: ContentDb,
): ModelExpectation | null {
  const K = content.balance.K;
  const snap = planningSnapshot(state, content);
  const encounter = encounterFor(entry, content);
  const bodies = encounter.spawns.reduce((n, s) => n + s.count, 0);
  const eHp = (cl: number) => K.eHp[0] + K.eHp[1] * cl;
  const eDmg = (cl: number) => K.eDmg[0] + K.eDmg[1] * cl;
  const hpTotal = encounter.spawns.reduce((sum, s) => sum + s.count * eHp(s.cl) * s.hpMult, 0);
  const levels = snap.levels;
  const style = Math.max(...BASIC_SKILLS.map((s) => levels[s]));

  const acc = K.accBase + K.accPerLevel * style;
  const eva = K.evaBase + K.evaPerLevel * levels.eva;
  const known = new Set(snap.known);
  const figures = content.techniques
    .filter((t) => t.rank !== null && !t.noDamage && known.has(t.id))
    .map((t) => {
      const role = K.role[t.role];
      const rank = t.rank as keyof typeof K.power;
      const m = (snap.mastery[t.id] ?? 1) / K.masteryCap;
      const seals = Math.max(
        Math.round(t.sealSeq.length * (1 - K.masteryCast * m)),
        t.sealSeq.length > 0 ? 1 : 0,
      );
      const cast = Math.max(K.castFloor, K.castBase + K.castPerSeal * seals);
      const cycle = cast + role.cd * K.rankCd[rank];
      const reach = t.role === 'area' ? Math.min(bodies, K.loadout.areaBodies) : 1;
      const nature = (NATURE_IDS as readonly string[]).includes(t.skill)
        ? (t.skill as NatureId)
        : null;
      return {
        nature,
        cast,
        cycle,
        value:
          K.power[rank] *
          role.m *
          K.tierMult[`${t.tier}`] *
          (1 + K.levelScale * levels[t.skill]) *
          (1 + K.masteryDmg * m) *
          reach,
      };
    })
    .filter((f) => f.value > 0);

  // The rank's limits: a student takes everything, a Genin or a Chunin a number of slots and natures.
  const limits = loadoutLimits(snap.tier ?? 0, content);
  const natures = NATURE_IDS.filter((n) => figures.some((f) => f.nature === n));
  const choices = limits ? subsets(natures, limits.natures) : [natures];
  let best: typeof figures = [];
  let bestScore = -1;
  for (const choice of choices) {
    const pool = figures
      .filter((f) => f.nature === null || choice.includes(f.nature))
      .sort((a, b) => b.value / b.cycle - a.value / a.cycle)
      .slice(0, limits ? limits.slots : figures.length);
    const score = pool.reduce((s, f) => s + f.value / f.cycle, 0);
    if (score > bestScore) [best, bestScore] = [pool, score];
  }

  const first = encounter.spawns[0];
  if (!first) return null;
  const hitRate = hit(acc, K.eEva[0] + K.eEva[1] * first.cl, content);
  const busy = Math.min(
    1,
    best.reduce((s, f) => s + f.cast / f.cycle, 0),
  );
  const basic = K.basicDmg[0] + K.basicDmg[1] * style;
  const playerDps = hitRate * (bestScore + ((1 - busy) * basic) / K.basicInterval);
  if (!(playerDps > 0)) return null;
  const ttkSec = hpTotal / playerDps;

  const enemyHit = (cl: number) => hit(K.eAcc[0] + K.eAcc[1] * cl, eva, content);
  const enemyDps = encounter.spawns.reduce(
    (sum, s) => sum + (s.count * eDmg(s.cl) * s.dmgMult * enemyHit(s.cl)) / K.eInterval,
    0,
  );
  const playerHp = K.hpBase + K.hpPerVit * levels.vit;
  return { ttkSec, hpLossShare: (enemyDps * ttkSec) / playerHp, playerDps };
}
