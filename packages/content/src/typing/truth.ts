/**
 * The static types of the ids and of the balance records that depend on the vocabularies. At run
 * time every one of them is an open string (a pack adds members), so this view says exactly that:
 * ids are `string` and a record keyed by vocabulary members is `Record<string, T>`, which
 * `noUncheckedIndexedAccess` makes callers check.
 *
 * Never imported at run time.
 */
export interface IdTypes {
  skill: string;
  nature: string;
  techSkill: string;
  techRank: string;
  terrain: string;
  playerRank: string;
  role: string;
  tag: string;
  trait: string;
  state: string;
  status: string;
  combo: string;
  missionRank: string;
  cellKey: string;
  enemyRegion: string;
  attackStyle: string;
  zoneRegion: string;
  skillGroup: string;
  fxNextCast: string;
  fxReveal: string;
  fxSleep: string;
  fxWolfPack: string;
  fxDrunkenEvasion: string;
  fxHeavyCast: string;
  fxTwins: string;
  fxMistRehide: string;
  fxIllusion: string;
  fxStance: string;
  fxRival: string;
  itemKind: string;
  trophy: string;
  recipeSkill: string;
  gearFxKey: string;
  partChance: string;
  aiTier: string;
  entityKind: string;
  iconKind: string;
  localeKind: string;
}

export interface ShapeTypes {
  byRank: Record<string, number>;
  kRole: Record<string, { m: number; cd: number; c: number }>;
  stun: Record<string, number>;
  combo: Record<string, number>;
  techFx: Record<string, Record<string, number>>;
  bossFx: Record<string, Record<string, number>>;
  dropChance: Record<string, number>;
  kSell: Record<string, number>;
  trait: Record<string, number>;
  ryoPerMin: Record<string, number>;
  repPerMission: Record<string, number>;
  missionRateCap: Record<string, number>;
  rep: Record<string, number>;
  partDrop: Record<string, number>;
  gearFx: Record<string, number>;
  itemFx: Record<string, Record<string, number>>;
  loadoutSlots: Record<string, number>;
  loadoutNatures: Record<string, number>;
  sessionMinutes: Record<string, number>;
  sessionHours: Record<string, number>;
  batch: Record<string, number>;
  terrainFx: Record<string, { walkMin: number; survey: number }>;
}
