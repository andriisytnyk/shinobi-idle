/**
 * Balance parameters that the design documents do not carry yet. The importer merges them under
 * the documented values, so a parameter added to balance.json later wins automatically.
 */
export const BALANCE_EXT = {
  /** While a student, XP gained at a skill level at or above this is slowed. */
  academyCap: 10,
  /** Multiplier applied to that XP. */
  academySlow: 0.25,
  /** Longest stretch of offline time that is simulated, in hours. */
  offlineCapHours: 12,
  /** The sensei test: 300 s, 1% shorter per level of the exam's skills, never under 120 s. */
  senseiTest: { base: 300, perLevel: 0.01, floor: 120 },
  /** Combat timing: ms per combat XP tick, ms per pool regeneration step, hit share at equal ratings. */
  combat: { xpTickMs: 1000, regenMs: 1000, hitEven: 0.5 },
  /** Herb bushes: stock is stockBase plus the herb's mastery level; an empty bush regrows for regrowMs. */
  field: { stockBase: 5, regrowMs: 5000 },
  /** Crafting mastery tiers (mastery levels 1 / 20 / 50 / 90): each tier above the first adds this chance of one bonus unit. */
  craftRules: { masteryTiers: [1, 20, 50, 90], bonusPerTier: 0.25 },
  /** A tonic holds at most this many times the charges of one tonic. */
  tonic: { capMult: 2 },
  /** Shop sell price of a craft product: this share of the value computed from its ingredients; herbs are worth herbBase + herbPerLevel x level. */
  shop: { craftSellFactor: 0.4, herbBase: 2, herbPerLevel: 0.4 },
  /** Size of one owned training-gear tier: XP share, time share, keep-ingredients chance, speed share, time share. */
  gearFx: { mannequin: 0.03, sickle: 0.05, alembic: 0.03, stations: 0.05, maps: 0.03 },
  /** Numbers of item effects that name them by key (the recipe text gives no number for the sleeping powder). */
  itemFx: { sleep: { chance: 0.5 } },
  /** Mastery levels stop here. */
  masteryCap: 99,
  /**
   * Numbers of non-damaging technique effects (balance_tables.md, section 3, «Особливі ефекти»,
   * and the slice amendments). Technique data names an entry by key; it never carries the number.
   */
  techFx: {
    /** Absorbs power[rank] x mult x level scaling. */
    shield: { mult: 1.3, durationMs: 6000 },
    /** The next enemy hit misses. */
    decoy: { charges: 1, durationMs: 8000 },
    /** Multiplies the player's evasion. */
    evasionBuff: { mult: 1.5, durationMs: 8000 },
    /** Out of the loadout: cancels one hit now and then. */
    passiveNegate: { everyMs: 20000 },
    /** Stance of the First Gate: extra Taijutsu damage, stamina drain, Wounds after the fight. */
    gateOpening: { taiDamage: 0.03, staminaPerSec: 2, woundsAfter: 1 },
    /** Stance of the Second Gate. */
    gateHealing: { taiDamage: 0.05, staminaPerSec: 3, woundsAfter: 1 },
    /** Scales the cast time of the next technique. */
    nextCast: { castMult: 0.5 },
    /** Removes the Hidden trait for this long. */
    reveal: { durationMs: 20000 },
  },
  /**
   * Numbers of boss specials. Bind duration of the mist fugitive is `bind.dur`, and the hit
   * counters of the rival are the generic `habituation` ones.
   */
  bossFx: {
    wolfPack: { count: 4, everyMs: 20000 },
    rivalDuel: { techniques: 1 },
    rivalTournament: { techniques: 2, habituationMult: 2 },
    drunkenEvasion: { maxMult: 3 },
    heavyCast: { everyMs: 15000, castMs: 2500, damageMult: 4 },
    twins: { count: 2 },
    mistRehide: { everyMs: 25000 },
    illusion: { everyMs: 8000, fleeAtHp: 0.3 },
  },
  /** Ryo dropped by an enemy per combat level: range of the multiplier. */
  ryoDrop: [5, 8],
  /** Chance of a trophy drop per kill. */
  dropChance: { band: 0.25, pelt: 0.4, fang: 0.3, coin: 0.03, gem: 0.01 },
  /** Sell price of a trophy in ryo. */
  sell: { band: 15, pelt: 8, fang: 20, coin: 40, gem: 250 },
} as const;
