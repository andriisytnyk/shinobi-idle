/**
 * Values that win over the documented ones until the documents are updated.
 */
export const BALANCE_OVERRIDE: Partial<Record<string, number>> = {
  /** HP regained between the fights of a zone: with no healing item at all, grinding an enemy of the player's level for two hours needs this much (see sustained.test.ts). */
  zoneHpRegen: 0.8,
};

/**
 * Puts the overrides over `base`. A key that `base` does not have is a typo, not a new
 * parameter: it throws, so an override can never silently shadow nothing.
 */
export function withOverrides<T extends object>(
  base: T,
  overrides: Readonly<Record<string, number | undefined>>,
): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (!Object.hasOwn(out, key)) throw new Error(`Balance override "${key}" names no parameter`);
    out[key] = value;
  }
  return out as T;
}

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
   * Numbers of boss specials; `hp` and `dmg` scale the boss's own health and damage for its fight. Bind duration of the mist fugitive is `bind.dur`, and the hit
   * counters of the rival are the generic `habituation` ones.
   */
  bossFx: {
    /** The leader of the wolves calls `count` wolves back every `everyMs` while he lives; a wolf has `hp` and `dmg` of an ordinary enemy of the leader's level. */
    wolfPack: { count: 4, everyMs: 20000, hp: 0.12, dmg: 0.05, leaderHp: 0.97, leaderDmg: 0.97 },
    /** The rival casts `techniques` techniques of the nature that beats the player's, one every `everyMs` (each hits for `mult` x his damage), and a signature every `sigEveryMs` for `sigMult` x. */
    rivalDuel: {
      techniques: 1,
      everyMs: 9000,
      mult: 0.05,
      sigEveryMs: 16000,
      sigMult: 0.3,
      sigOpenMs: 2000,
      hp: 0.92,
      dmg: 0.92,
    },
    rivalTournament: {
      techniques: 2,
      habituationMult: 2,
      everyMs: 9000,
      mult: 0.05,
      sigEveryMs: 16000,
      sigMult: 0.3,
      sigOpenMs: 2000,
      hp: 1,
      dmg: 1,
    },
    drunkenEvasion: { maxMult: 2, hp: 1, dmg: 1 },
    /** A heavy cast: `castMs` wind-up every `everyMs`, `damageMult` x damage, stuns the player for `stunMs` when it lands. */
    heavyCast: { everyMs: 20000, castMs: 2500, damageMult: 2, stunMs: 500, hp: 0.85, dmg: 1.05 },
    /** Two bodies: each has `hpEach` of the boss health and `dmgEach` of its damage; while both live the mist poisons the player for `mistMult` x the poison strength. */
    twins: { count: 2, hpEach: 0.5, dmgEach: 0.5, mistMult: 0.3 },
    mistRehide: { everyMs: 25000, hp: 0.97, dmg: 0.95 },
    illusion: { everyMs: 8000, fleeAtHp: 0.3, hp: 1.25, dmg: 1.25 },
  },
  /** Loadout: slots and distinct natures by rank (a student has no limit), and the number of saved loadouts. */
  loadout: {
    slots: { genin: 4, chunin: 5 },
    natures: { genin: 1, chunin: 2 },
    saved: 5,
    nameMax: 24,
    /** An area technique counts as hitting this many bodies when loadouts are scored. */
    areaBodies: 2,
  },
  /** The signature technique: the mastery it needs and its extra mastery XP share. */
  signature: { minMastery: 25, xpBonus: 0.1 },
  /** Pouch slots: the base count and the extra slots the chunin vest gives. */
  pouch: { slots: 3, vest: 1, vestRank: 'chunin' },
  /** The player's AI: the reaction delay (ms) of the genin tier to a cast it has to answer, and the health share below which a spare buff is cast. */
  ai: { geninReactionMs: 1000, guardBelow: 0.6 },
  /** Health share below which a won fight still costs a Wound. */
  woundHp: 0.1,
  /** The Bingo book: wins that fully study an ordinary enemy and a boss. */
  bingo: { studiedWins: { enemy: 25, boss: 3 } },
  /** Battle analysis: fights per zone or boss run, runs per operation, the seed, the time budget (ms) of a default run, and the options a hint lists. */
  analysis: {
    samples: 400,
    opSamples: 200,
    seed: 7,
    budgetMs: 5000,
    hintOptions: 3,
    sessionMinutes: 120,
    sessionHours: { zone: 8, boss: 30, operation: 30 },
    minSessions: 4,
    agree: 0.05,
    stopFresh: 0.03,
    batch: { zone: 50, operation: 20 },
    verdict: { collapseBelow: 0.5, hopelessBelow: 0.1, stableMedian: 0.8, stableCollapse: 0.05 },
  },
  /** Battle report: the latest defeats it keeps. */
  report: { defeats: 5 },
  /** Operations: ms of the approach stage, and its share when the shortening requirement holds. */
  operation: { approachMs: 30000, approachShort: 0.5 },
  /** Numbers of tools that the item data does not carry: the poisoned senbon's damage over time (share of maximum health per second, seconds), and the damage multiplier of a burn ointment against the nature it names. */
  toolFx: { dot: { pct: 0.012, durS: 10 }, resist: 0.6 },
  /** Ryo dropped by an enemy per combat level: range of the multiplier. */
  ryoDrop: [5, 8],
  /** Chance of a trophy drop per kill. */
  dropChance: { band: 0.25, pelt: 0.4, fang: 0.3, coin: 0.03, gem: 0.01 },
  /** Sell price of a trophy in ryo. */
  sell: { band: 15, pelt: 8, fang: 20, coin: 40, gem: 250 },
} as const;
