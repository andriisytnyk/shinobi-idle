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
  /** Engine limits against rules and modifiers of packs (see `balanceParamsSchema`). */
  engine: { packEventsPerHour: 3600, minActionMs: 1000, modMin: 0.01, modMax: 100 },
  /** While a student, XP gained at a skill level at or above this is slowed. */
  academyCap: 10,
  /** Multiplier applied to that XP. */
  academySlow: 0.25,
  /** Longest stretch of offline time that is simulated, in hours. */
  offlineCapHours: 12,
  /** The sensei test: 300 s, 1% shorter per level of the exam's skills, never under 120 s. */
  senseiTest: { base: 300, perLevel: 0.01, floor: 120 },
  /** Combat timing: ms per combat XP tick, ms per pool regeneration step, hit share at equal ratings, the longest fight (ms) before it ends as a timeout, the most enemies one fight holds, and the most times one hook timer may fire within one moment before the hook is treated as failed; the smallest period of a hook timer (ms); the events one hook may have in a fight second; the largest factor a hook may return. */
  combat: {
    xpTickMs: 1000,
    regenMs: 1000,
    hitEven: 0.5,
    fightCapMs: 240000,
    maxEnemies: 8,
    timerFires: 1000,
    timerMinMs: 100,
    hookEventsPerSec: 500,
    hookStatMax: 10,
    interruptLost: 0.5,
  },
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
   * Exploration: a cell with no point of interest stops at this level in the slice; Athletics
   * shortens explore and walk time by 0.1% per level, never by more than 10%.
   */
  scouting: {
    plainMaxLevel: 3,
    athPerLevel: 0.001,
    athCap: 0.1,
  },
  /**
   * The hex map. Minutes to cross a hex by terrain (a road is quickest, hills slowest) and the
   * factor of the survey time; how far the player can survey by Scouting level; one more hex from a
   * found outpost; the hexes within 2 steps of the first cell are surveyed from the start; a hex
   * that is no cell is surveyed twice (6 and 18 surveys) at the pace of Scouting level 1.
   */
  map: {
    terrain: {
      road: { walkMin: 2, survey: 0.6 },
      settlement: { walkMin: 2, survey: 0.8 },
      plains: { walkMin: 3, survey: 0.8 },
      coast: { walkMin: 3, survey: 1 },
      forest: { walkMin: 4, survey: 1.2 },
      river: { walkMin: 4, survey: 1.2 },
      hills: { walkMin: 5, survey: 1.4 },
      lake: { walkMin: 6, survey: 1 },
    },
    range: [
      { scout: 0, range: 2 },
      { scout: 10, range: 3 },
      { scout: 25, range: 4 },
      { scout: 40, range: 5 },
    ],
    outpostRange: 1,
    startRadius: 2,
    plainSurvey: [6, 18],
    plainScout: 1,
    /** Walking pays Athletics at the pace of level 3 and Scouting at the pace of level 2, for the minutes of each hex. */
    walk: { athLevel: 3, scoutLevel: 2 },
    /** Paid travel costs 1.5 ryo per minute the walk would take (a 3-minute plain is 4.5 ryo), never under 5. */
    travel: { ryoPerMinute: 1.5, min: 5 },
    /**
     * Map mastery, by hexes surveyed to their highest level: 30 hexes +5% Scouting XP, 60 hexes
     * 10% cheaper paid travel, all of them 5% faster surveys.
     */
    mastery: [
      { hexes: 30, mods: [{ key: 'xp.skill.scout', op: 'add', value: 0.05 }] },
      { hexes: 60, mods: [{ key: 'travel.price', op: 'add', value: -0.1 }] },
      { hexes: 'all', mods: [{ key: 'interval.explore', op: 'add', value: -0.05 }] },
    ],
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
    /** Stance of the First Gate: extra Taijutsu damage, stamina drain, Wounds after the fight. */
    gateOpening: { taiDamage: 0.03, staminaPerSec: 2, woundsAfter: 1 },
    /** Stance of the Second Gate. */
    gateHealing: { taiDamage: 0.05, staminaPerSec: 3, woundsAfter: 1 },
    /** Scales the cast time of the next technique. */
    nextCast: { castMult: 0.5 },
    /** Removes the Hidden trait for this long. */
    reveal: { durationMs: 20000 },
    /**
     * Combat clones (the shadow clone technique in a fight): `count` bodies, one more for every
     * `masteryStep` levels of the technique's Mastery up to `max`; together they take `share` of the
     * caster's current chakra and stamina, split evenly, and give back what they have left when
     * dispelled. A body has `hp` of the caster's maximum health and strikes for `dmg` of what the caster's same technique does. Enemies pick a target among the
     * living bodies of the caster's side by weight: the caster 1, a body `threat`. The technique
     * can be cast `casts` times in a fight.
     */
    combatClone: {
      count: 2,
      masteryStep: 50,
      max: 3,
      share: 0.4,
      hp: 0.3,
      dmg: 0.5,
      threat: 0.6,
      casts: 1,
    },
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
      everyMs: 9000,
      mult: 0.05,
      sigEveryMs: 16000,
      sigMult: 0.3,
      sigOpenMs: 2000,
      hp: 1,
      dmg: 1,
      habituationMult: 2,
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
  /** The player's AI: the combat level from which an enemy waits by a higher AI tier. */
  ai: { enemyTier: { genin: 8, chunin: 35 } },
  /** Health share below which a won fight still costs a Wound. */
  woundHp: 0.1,
  /** The Bingo book: wins that fully study an ordinary enemy and a boss. */
  bingo: { studiedWins: { enemy: 25, boss: 3 }, rareBelow: 0.05 },
  /** Battle analysis: fights per zone or boss run, runs per operation, the seed, the time budget (ms) of a default run, and the options a hint lists. */
  analysis: {
    samples: 400,
    opSamples: 200,
    seed: 7,
    budgetMs: 5000,
    hintOptions: 3,
    sessionMinutes: { zone: 15, boss: 60, operation: 60 },
    sessionHours: { zone: 5, boss: 16, operation: 16 },
    minSessions: 4,
    afterShare: 0.25,
    horizonMinutes: 240,
    confidenceZ: 1.64,
    batch: { zone: 50, operation: 20 },
    verdict: { collapseBelow: 0.5, hopelessBelow: 0.1, stableMedian: 0.8, stableCollapse: 0.15 },
  },
  /** Battle report: the latest defeats it keeps. */
  report: { defeats: 5 },
  /** Operations: ms of the approach stage, and its share when the shortening requirement holds. */
  operation: { approachMs: 30000, approachShort: 0.5 },
  /** Missions: -1% time per level above a stage's requirement (never under half), -0.3% per mastery level of the technique used, a slower fallback takes twice the time; a stage attempt succeeds with 90% plus 1% per level and 0.2% per mastery level, at most 99%. */
  mission: {
    perLevel: 0.01,
    floor: 0.5,
    masteryTime: 0.003,
    slowAlt: 2,
    minFactor: 0.2,
    maxDefeats: 3,
    defaultStyle: 'tai',
    fightSkills: ['vit'],
    success: { base: 0.9, perLevel: 0.01, perMastery: 0.002, cap: 0.99 },
  },
  /** The team: a teammate stands at 80% of the player's level, performs with mastery 10, and in a fight hits every 9 s for 60% of the player's basic damage with the state of its nature. */
  team: {
    levelShare: 0.8,
    mastery: 10,
    support: { everyMs: 9000, damage: 0.6 },
    states: { katon: 'burn', suiton: 'wet', raiton: 'stun', futon: null, doton: null },
  },
  /** A merchant crate: oil, salt and spices, and a gem now and then. */
  crate: {
    goods: { 'core:oil': [2, 4], 'core:salt': [2, 4], 'core:spice': [1, 2] },
    gem: { item: 'core:gem', chance: 0.05 },
  },
  /** Numbers of tools that the item data does not carry: the poisoned senbon's damage over time (share of maximum health per second, seconds), and the damage multiplier of a burn ointment against the nature it names. */
  toolFx: { dot: { pct: 0.012, durS: 10 }, resist: 0.6 },
  /** Ryo dropped by an enemy per combat level: range of the multiplier. */
  ryoDrop: [5, 8],
  /** Chance of a trophy drop per kill. */
  dropChance: { band: 0.25, pelt: 0.4, fang: 0.3, coin: 0.03, gem: 0.01 },
  /** Sell price of a trophy in ryo. */
  sell: { band: 15, pelt: 8, fang: 20, coin: 40, gem: 250 },
} as const;
