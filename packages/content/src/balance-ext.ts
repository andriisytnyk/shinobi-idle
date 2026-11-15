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
  /** Combat timing: ms per combat XP tick, ms per pool regeneration step, hit share at equal ratings, the longest fight (ms) before it ends as a timeout, and the most enemies one fight holds. */
  combat: { xpTickMs: 1000, regenMs: 1000, hitEven: 0.5, fightCapMs: 240000, maxEnemies: 8 },
  /** Evasion multiplier of a bound enemy (the balance tables: Сковування, ухилення ×0.3). */
  bindEva: 0.3,
  /** Chance to resist an Illusionist's illusion per Meditation level (Медитація ÷ 200). */
  illusionResist: 0.005,
  /** Herb bushes: stock is stockBase plus the herb's mastery level; an empty bush regrows for regrowMs. */
  field: { stockBase: 5, regrowMs: 5000 },
  /** Crafting mastery tiers (mastery levels 1 / 20 / 50 / 90): each tier above the first adds this chance of one bonus unit. */
  craftRules: { masteryTiers: [1, 20, 50, 90], bonusPerTier: 0.25 },
  /** A tonic holds at most this many times the charges of one tonic. */
  tonic: { capMult: 2 },
  /** Shop sell price of a craft product: this share of the value computed from its ingredients; herbs are worth herbBase + herbPerLevel x level. */
  shop: { craftSellFactor: 0.35, herbBase: 2, herbPerLevel: 0 },
  /** Size of one owned training-gear tier: XP share, time share, keep-ingredients chance, speed share, time share. */
  gearFx: { mannequin: 0.03, sickle: 0.05, alembic: 0.03, stations: 0.05, maps: 0.03 },
  /** Numbers of item effects that name them by key (the recipe text gives no number for the sleeping powder). */
  itemFx: { sleep: { chance: 0.5 } },
  /**
   * Chakra natures: Chakra Control needed for the second and the third nature, the most natures the
   * slice allows, and the skill level at which the non-native cast penalty (K.nonNativeCast) is gone.
   */
  natures: { second: 20, third: 40, max: 3, penaltyEnd: 50 },
  /**
   * Exploration: a cell with no point of interest stops at this level in the slice; a walk takes
   * 10 minutes within a region and 30 between regions; Athletics shortens explore and walk time by
   * 0.1% per level, never by more than 10%.
   */
  scouting: {
    plainMaxLevel: 3,
    walkWithinMin: 10,
    walkBetweenMin: 30,
    athPerLevel: 0.001,
    athCap: 0.1,
  },
  /**
   * The village: building levels a new Genin starts with (every building not named starts at 0;
   * the Market starts at 1 because the first meals and rations come from it), the building level
   * from which the `late` civil resource (iron) is needed, and its share of the base cost.
   */
  village: {
    start: {
      'core:tower': 1,
      'core:bureau': 1,
      'core:store': 1,
      'core:sawmill': 1,
      'core:mine': 1,
      'core:farms': 1,
      'core:market': 1,
    },
    lateFromLevel: 4,
    lateShare: 0.5,
  },
  /** Mastery levels stop here. */
  masteryCap: 99,
  /**
   * Meditation: 5% Insight and 2% Enlightenment per finished cycle; an Insight modifier has up to
   * 8 levels and an Enlightenment one up to 5; the three of each kind open at these practice masteries.
   */
  meditation: {
    insightChance: 0.05,
    enlightChance: 0.02,
    insightLevels: 8,
    enlightLevels: 5,
    insightGates: [1, 40, 80],
    enlightGates: [20, 60, 99],
  },
  /** Athletics course: slot 1 is free the first time; five built obstacles raise the pillar, +5% Athletics XP. */
  athletics: { freeSlot: 1, pillarCount: 5, pillarXp: 0.05 },
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
