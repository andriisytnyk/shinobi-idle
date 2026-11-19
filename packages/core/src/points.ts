import type { ContentDb, Mod, Payout, Place } from '@shinobi/content';
import { addCurrency, addItem } from './bank.ts';
import { emit } from './events.ts';
import { hexKey, isSurveyed, positionHex, touchWorld, worldRevision } from './hex.ts';
import { indexOf } from './lookup.ts';
import type { Modifier, ModifierProvider } from './modifiers.ts';
import { gainXp } from './progression.ts';
import { actingPerformer } from './performer.ts';
import { evalReq } from './requirements.ts';
import type { Rules } from './rules.ts';
import type { GameState } from './state.ts';
import type { System } from './system.ts';
import { moneyOf, ownsNature } from './vocab.ts';
import { subjectOf, surveyLevel, surveyMaxLevel } from './world.ts';

/*
 * Points of interest: places that are worth something (`Place.point`). A point is revealed (on the
 * map), found (a performer stepped on it: its discovery reward is paid, once) and then works:
 * places of power give modifiers while a performer stands there, outposts join the free travel of
 * their group, and the flag `point.<place id>` opens the actions that ask for it. Map mastery, the
 * number of hexes surveyed to their top level, adds modifiers too. Everything here is data driven:
 * no place, point or group is named in code.
 */

/**
 * The flag that reads "the point of this place is found": an action's requirement names it
 * (`{ t: 'flag', id: pointFlag(place) }`). The requirement reads `world.pois`, so the flag is
 * never stored; the prefix `point.` is reserved for it.
 */
export const pointFlag = (placeId: string): string => `point.${placeId}`;

/**
 * What the player knows of a point. `hidden`: nothing (not revealed: its hex is not surveyed, or
 * `revealedBy` does not hold yet). `veiled`: it is there, but what it asks for is not met, so only
 * a vague hint is known. `open`: revealed and can be found by stepping on it. `found`: found.
 */
export type PointStatus = 'hidden' | 'veiled' | 'open' | 'found';

interface PointIndex {
  all: Place[];
  byHex: Map<string, Place[]>;
  /** The points with `power`. */
  powered: Place[];
}

const placesWithPoints = new WeakMap<ContentDb, PointIndex>();

function pointIndex(content: ContentDb): PointIndex {
  let found = placesWithPoints.get(content);
  if (!found) {
    const all = content.places.filter((p) => p.point !== undefined);
    const byHex = new Map<string, Place[]>();
    for (const p of all) {
      const key = hexKey(p.hex[0], p.hex[1]);
      byHex.set(key, [...(byHex.get(key) ?? []), p]);
    }
    found = { all, byHex, powered: all.filter((p) => p.point?.power !== undefined) };
    placesWithPoints.set(content, found);
  }
  return found;
}

/** Every place that is a point of interest, in the order of the content. */
export const pointPlaces = (content: ContentDb): readonly Place[] => pointIndex(content).all;

/** The places on the hex `key` that are points of interest. */
export const pointsAtHex = (content: ContentDb, key: string): readonly Place[] =>
  pointIndex(content).byHex.get(key) ?? [];

/** The point of a place, or undefined for a place that is none. */
export const pointOf = (content: ContentDb, placeId: string): Place | undefined => {
  const place = indexOf(content).places.get(placeId);
  return place?.point ? place : undefined;
};

/** Whether the point of the place was found. */
export const isFound = (state: GameState, placeId: string): boolean =>
  state.world.pois[placeId] === true;

/** A performer on the map: the action slot it works in and the key of the hex it stands on. */
export interface Performer {
  slot: number;
  key: string;
}

/**
 * Where the performers stand: the character (slot 0) and each clone that holds a slot with an
 * action (its figure is on the map). Places of power and finds read this list, so they cannot
 * disagree about who is where.
 */
export function performers(state: GameState, content: ContentDb): Performer[] {
  const out: Performer[] = [];
  const at = (slot: number): void => {
    const here = positionHex(state, content, slot);
    if (here) out.push({ slot, key: hexKey(here.q, here.r) });
  };
  at(0);
  for (const slot of Object.keys(state.world.figures ?? {}).map(Number))
    if (slot > 0 && state.slots[slot]?.action) at(slot);
  return out;
}

/**
 * Whether the point of a place is on the map for the player: its hex is surveyed to its first
 * level (where places become known), and `revealedBy` holds when it names a survey level of the
 * hex or another point found (either one is enough).
 */
export function isRevealed(state: GameState, content: ContentDb, place: Place): boolean {
  if (!place.point) return false;
  const key = hexKey(place.hex[0], place.hex[1]);
  if (!isSurveyed(state, content, key)) return false;
  const subject = subjectOf(content, key);
  if (!subject) return false;
  const level = surveyLevel(state, subject, content);
  if (level < 1) return false;
  const by = place.point.revealedBy;
  if (!by) return true;
  return (
    (by.survey !== undefined && level >= by.survey) ||
    (by.point !== undefined && isFound(state, by.point))
  );
}

/** The status of the point of a place (`hidden` for a place with no point). */
export function pointStatus(state: GameState, content: ContentDb, place: Place): PointStatus {
  const point = place.point;
  if (!point) return 'hidden';
  if (isFound(state, place.id)) return 'found';
  if (!isRevealed(state, content, place)) return 'hidden';
  if (point.needs && !evalReq(state, point.needs, content).met) return 'veiled';
  return 'open';
}

// ---------- paying ----------

/** What a payout paid, for the event and the toast. */
export interface Paid {
  ryo: number;
  items: { id: string; n: number }[];
  currencies: Record<string, number>;
  xp: { skill: string; amount: number } | null;
}

/** Pays a payout out to the player: ryo, items, other currencies and a little XP. */
export function pay(state: GameState, content: ContentDb, rules: Rules, payout: Payout): Paid {
  const paid: Paid = { ryo: 0, items: [], currencies: {}, xp: null };
  if (payout.ryo !== undefined && addCurrency(state, moneyOf(content), payout.ryo))
    paid.ryo = payout.ryo;
  for (const { item, n } of payout.items ?? []) {
    if (!addItem(state, item, n)) continue;
    paid.items.push({ id: item, n });
    emit(state, { type: 'itemGained', id: item, n });
  }
  for (const [currency, n] of Object.entries(payout.currencies ?? {}))
    if (addCurrency(state, currency, n)) paid.currencies[currency] = n;
  if (payout.xp) {
    gainXp(state, payout.xp.skill, payout.xp.amount, content, rules);
    paid.xp = payout.xp;
  }
  return paid;
}

// ---------- finding ----------

/**
 * Finds every point a performer stands on that is open: pays its reward once, raises its flag and
 * lets the points it reveals be found in turn. Called wherever a performer arrives or a survey
 * ends, and by the `points` system after every event, so a point revealed (or a requirement
 * met) under a performer's feet is found without stepping off and on. Idempotent.
 */
export function settlePoints(state: GameState, content: ContentDb, rules: Rules): void {
  if (pointIndex(content).all.length === 0) return;
  // The usual case, run after every event: the character alone, on a hex with nothing left to find.
  if (!state.world.figures) {
    const here = positionHex(state, content, 0);
    if (!here) return;
    if (pointsAtHex(content, hexKey(here.q, here.r)).every((p) => state.world.pois[p.id] === true))
      return;
  }
  for (let round = 0; round <= pointIndex(content).all.length; round++) {
    let found = false;
    for (const { slot, key } of performers(state, content)) {
      for (const place of pointsAtHex(content, key)) {
        if (pointStatus(state, content, place) !== 'open') continue;
        // The reward is paid before the point counts as found: the bonus of a place of power never raises its own reward.
        const reward = pay(state, content, rules, (place.point as { reward: Payout }).reward);
        state.world.pois[place.id] = true;
        touchWorld(state);
        emit(state, { type: 'pointFound', place: place.id, hex: key, slot, reward });
        found = true;
      }
    }
    if (!found) return;
  }
}

/** The system that settles the points after every event of the game (it has no events of its own). */
export const pointSystem: System = {
  nextEventIn: () => null,
  run: (state, content, rules) => settlePoints(state, content, rules),
};

// ---------- places of power ----------

const allowed = (state: GameState, mod: Mod): boolean =>
  mod.nature === undefined || ownsNature(state, mod.nature);

/**
 * The modifiers of the places of power: while a performer (the character or a clone) stands on the
 * hex of a found point with `power`, its modifiers apply to the actions of that performer, and only
 * to them (`actingPerformer`: whose action is being computed). Another performer's place does not
 * help this one, and a clone that only stands on a place helps nobody. The sources are the places,
 * so a breakdown names them.
 */
export const pointsProvider: ModifierProvider = (state, content) => {
  // The providers are asked all the time: with no place of power found there is nothing to look at.
  if (!pointIndex(content).powered.some((p) => state.world.pois[p.id] === true)) return [];
  const out: Modifier[] = [];
  const seen = new Set<string>();
  const acting = actingPerformer();
  for (const { slot, key } of performers(state, content)) {
    if (slot !== acting) continue;
    for (const place of pointsAtHex(content, key)) {
      if (seen.has(place.id) || !place.point?.power || !isFound(state, place.id)) continue;
      seen.add(place.id);
      for (const mod of place.point.power) {
        if (!allowed(state, mod)) continue;
        out.push({
          key: mod.key,
          op: mod.op,
          value: mod.value,
          group: 'character',
          source: `place.${place.id}.name`,
        });
      }
    }
  }
  return out;
};

// ---------- map mastery ----------

/** One tier of the map mastery with what it needs and whether it is reached. */
export interface MasteryTier {
  /** Hexes surveyed to their top level that the tier needs (`all` resolved to the number of playable hexes). */
  need: number;
  reached: boolean;
  mods: Mod[];
}

export interface MapMastery {
  /** Hexes surveyed to their highest level. */
  count: number;
  /** Playable hexes of the map. */
  total: number;
  tiers: MasteryTier[];
}

const counted = new WeakMap<GameState, { revision: number; count: number }>();

/**
 * How many hexes are surveyed to their highest level. Kept while the revision of the surveyed land
 * stays (a hex that reaches its top level changes it); the modifier providers ask all the time.
 */
export function surveyedToTop(state: GameState, content: ContentDb): number {
  const revision = worldRevision(state);
  const memo = counted.get(state);
  if (memo && memo.revision === revision) return memo.count;
  let count = 0;
  for (const hex of indexOf(content).playableHexes) {
    const subject = subjectOf(content, hexKey(hex.q, hex.r));
    if (subject && surveyLevel(state, subject, content) >= surveyMaxLevel(subject, content))
      count++;
  }
  counted.set(state, { revision, count });
  return count;
}

/** The map mastery of the player now. */
export function mapMastery(state: GameState, content: ContentDb): MapMastery {
  const total = indexOf(content).playableHexes.length;
  const count = surveyedToTop(state, content);
  return {
    count,
    total,
    tiers: content.balance.K.map.mastery.map((tier) => {
      const need = tier.hexes === 'all' ? total : tier.hexes;
      return { need, reached: count >= need, mods: tier.mods };
    }),
  };
}

/** The modifiers of the reached tiers of the map mastery (source: the localization key `mod.source.mapMastery`). */
const NO_MODS: Modifier[] = [];
/** The last answer of the provider for a state: good while the surveyed land and the natures stay as they were (the providers are asked all the time). */
const masteryKept = new WeakMap<
  GameState,
  { revision: number; natures: string; mods: Modifier[] }
>();

export const masteryProvider: ModifierProvider = (state, content) => {
  if (content.balance.K.map.mastery.length === 0) return NO_MODS;
  const revision = worldRevision(state);
  const natures = state.player.natures.join(',');
  const kept = masteryKept.get(state);
  if (kept && kept.revision === revision && kept.natures === natures) return kept.mods;
  const out: Modifier[] = [];
  for (const tier of mapMastery(state, content).tiers) {
    if (!tier.reached) continue;
    for (const mod of tier.mods)
      if (allowed(state, mod))
        out.push({
          key: mod.key,
          op: mod.op,
          value: mod.value,
          group: 'character',
          source: 'mod.source.mapMastery',
        });
  }
  const mods = out.length === 0 ? NO_MODS : out;
  masteryKept.set(state, { revision, natures, mods });
  return mods;
};
