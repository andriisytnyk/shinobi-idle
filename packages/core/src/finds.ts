import type { ContentDb, Place } from '@shinobi/content';
import { addItem } from './bank.ts';
import { emit } from './events.ts';
import { MS_PER_HOUR, MS_PER_MINUTE, rate } from './formulas.ts';
import { hexDistance, parseHexKey, terrainMinutes } from './hex.ts';
import type { HexEnteredHook } from './hex-hooks.ts';
import { indexOf } from './lookup.ts';
import { pay } from './points.ts';
import { gainXp } from './progression.ts';
import { nextFloat } from './rng.ts';
import type { GameState } from './state.ts';
import { activitySkill } from './vocab.ts';

/*
 * What a walk gives: Athletics and Scouting XP for every hex walked, the small finds of the
 * terrain (forest: herbs and wood, river: food, hills: ore, roads: small things; data of the
 * terrain), and the rare finds bound to places (traces, notes, Intel): they drop within a radius
 * of their place with a chance that grows as the hex gets closer, there is a limited stock, and the
 * stock is restocked over time. It is the built-in handler of the `hexEntered` hook, and only a
 * step of a walk pays it: a trip paid for or an outpost jump gives nothing on the way.
 */

/** The places that hold a rare find, in the order of the content. */
const rarePlaces = new WeakMap<ContentDb, Place[]>();
function placesWithRare(content: ContentDb): Place[] {
  let list = rarePlaces.get(content);
  if (!list) rarePlaces.set(content, (list = content.places.filter((p) => p.rare !== undefined)));
  return list;
}

/**
 * The drops the rare find of a place holds now: its stock, less what was drawn, plus one for each
 * `restockMs` since the last draw (never above the stock). Reads only; whole periods count.
 */
export function rareLeft(state: GameState, place: Place): number {
  const rare = place.rare;
  if (!rare) return 0;
  const drawn = state.world.stock?.[place.id];
  if (!drawn) return rare.stock;
  const gained = Math.floor(Math.max(0, state.now - drawn.at) / rare.restockMs);
  return Math.min(rare.stock, Math.max(0, drawn.left) + gained);
}

/** Takes one drop out of the stock of a place, keeping the restock clock of what was already drawn. */
function draw(state: GameState, place: Place): void {
  const rare = place.rare;
  if (!rare) return;
  const left = rareLeft(state, place);
  const drawn = state.world.stock?.[place.id];
  // A full stock starts its clock now; a stock that is being restocked keeps the periods it has not used.
  const at =
    drawn && left < rare.stock
      ? drawn.at + Math.floor(Math.max(0, state.now - drawn.at) / rare.restockMs) * rare.restockMs
      : state.now;
  (state.world.stock ??= {})[place.id] = { left: left - 1, at };
}

/** Chance of the rare find of a place on a hex `distance` steps from it: the full chance at the place, falling to a share of it on the outermost ring. */
export const rareChance = (place: Place, distance: number): number => {
  const rare = place.rare;
  if (!rare || distance > rare.radius) return 0;
  return (rare.chance * (rare.radius + 1 - distance)) / (rare.radius + 1);
};

/** The built-in handler of `hexEntered`: pays a step of a walk. */
export const walkHook: HexEnteredHook = (state, ctx, content, rules) => {
  if (ctx.by !== 'walk') return;
  const K = content.balance.K.map;
  const hours = (terrainMinutes(content, ctx.terrain) * MS_PER_MINUTE) / MS_PER_HOUR;
  const athletics = activitySkill(content, 'course');
  const scouting = activitySkill(content, 'map');
  if (athletics !== null)
    gainXp(state, athletics, rate(K.walk.athLevel, content) * hours, content, rules);
  if (scouting !== null)
    gainXp(state, scouting, rate(K.walk.scoutLevel, content) * hours, content, rules);

  // The small find of the terrain: one draw for the chance, one for what it is.
  const finds = indexOf(content).terrains.get(ctx.terrain)?.finds;
  if (finds && nextFloat(state.rng, 'world') < finds.chance) {
    const total = finds.drops.reduce((sum, d) => sum + d.weight, 0);
    let roll = nextFloat(state.rng, 'world') * total;
    const drop = finds.drops.find((d) => (roll -= d.weight) < 0) ?? finds.drops[0];
    if (drop && addItem(state, drop.item, drop.n)) {
      emit(state, { type: 'itemGained', id: drop.item, n: drop.n });
      emit(state, {
        type: 'wayFound',
        hex: ctx.hex,
        place: '',
        items: [{ id: drop.item, n: drop.n }],
        currencies: {},
        slot: ctx.slot,
      });
    }
  }

  // The rare finds of the places around: nearest chance first by content order, drawn only while stock is left.
  const at = parseHexKey(ctx.hex);
  if (!at) return;
  for (const place of placesWithRare(content)) {
    const chance = rareChance(place, hexDistance(at, { q: place.hex[0], r: place.hex[1] }));
    if (chance <= 0 || rareLeft(state, place) <= 0) continue;
    if (nextFloat(state.rng, 'world') >= chance) continue;
    if (!place.rare) continue;
    draw(state, place);
    const paid = pay(state, content, rules, place.rare.payout);
    emit(state, {
      type: 'wayFound',
      hex: ctx.hex,
      place: place.id,
      items: paid.items,
      currencies: paid.currencies,
      slot: ctx.slot,
    });
  }
};
