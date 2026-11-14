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
  /** Mastery levels stop here. */
  masteryCap: 99,
} as const;
