/** Where to look: the region and the search area of a thing a requirement or a step asks to find. */
import { composeContent, content, corePack } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createState,
  hexDistance,
  hexKey,
  locationHint,
  parseHexKey,
  subjectOf,
  regionOfHex,
  type GameState,
  type HintTarget,
} from '../src/index.ts';

const CELL = 'core:karavannyi_shliakh';
const ENEMY: HintTarget = { kind: 'enemy', id: 'core:merc_pack' };
const cell = content.cells.find((c) => c.id === CELL)!;
const cellKey = hexKey(cell.hex[0], cell.hex[1]);
const K = content.balance.K.map;

const hint = (state: GameState, target: HintTarget) => locationHint(state, content, target);
const fresh = (): GameState => {
  const state = createState(1, content);
  delete state.world.surveyed[cellKey];
  state.world.explores = {};
  return state;
};

describe('the location hint', () => {
  it('has a data knob of radius 2', () => {
    expect(K.hintRadius).toBe(2);
  });

  it('places an enemy in the cell of its zone: its region and a search area that holds the cell', () => {
    const h = hint(fresh(), ENEMY)!;
    expect(h.exact).toBe(false);
    expect(h.cells).toEqual([CELL]);
    expect(h.regions).toEqual([cell.region]);
    expect(h.hexes).toContain(cellKey);
    expect(h.hexes.length).toBeGreaterThan(1);
    expect(h.hexes.length).toBeLessThanOrEqual(19);
  });

  it('keeps every hex of the area within radius 2 of a neighbour of the target, so it is not the centre', () => {
    const h = hint(fresh(), ENEMY)!;
    const at = { q: cell.hex[0], r: cell.hex[1] };
    // Every hex is within 3 steps of the target (a neighbour as the centre, plus the radius).
    for (const key of h.hexes) expect(hexDistance(parseHexKey(key)!, at)).toBeLessThanOrEqual(3);
    // All of them are playable, and (the area being large enough) inside the target's region.
    for (const key of h.hexes) {
      const subject = subjectOf(content, key)!;
      expect(subject).not.toBeNull();
      expect(regionOfHex(content, subject)).toBe(cell.region);
    }
  });

  it('is the same for the same target, and the same for any game state that has not surveyed it', () => {
    const a = hint(fresh(), ENEMY)!;
    const b = hint(createState(7, content), ENEMY)!;
    expect(b).toEqual(a);
    expect(hint(fresh(), ENEMY)).toEqual(a);
  });

  it('places a zone, a point of interest and a cell on the same cell', () => {
    const zone = content.zones.find((z) => z.enemy === ENEMY.id)!;
    const poi = cell.pois.find((p) => p.kind === 'zone' && p.zone === zone.id)!;
    for (const target of [
      { kind: 'zone', id: zone.id },
      { kind: 'poi', id: poi.id },
      { kind: 'cell', id: CELL },
    ] as const) {
      const h = hint(fresh(), target)!;
      expect(h.cells).toEqual([CELL]);
      expect(h.hexes).toContain(cellKey);
      expect(h.regions).toEqual([cell.region]);
    }
  });

  it('places a named place by its hex', () => {
    const place = content.places[0]!;
    const h = hint(fresh(), { kind: 'place', id: place.id });
    expect(h?.hexes).toContain(hexKey(place.hex[0], place.hex[1]));
  });

  it('gives the exact cell once it is surveyed', () => {
    const state = fresh();
    state.world.surveyed[cellKey] = true;
    for (const target of [ENEMY, { kind: 'cell', id: CELL } as const]) {
      const h = hint(state, target)!;
      expect(h.exact).toBe(true);
      expect(h.hexes).toEqual([cellKey]);
    }
  });

  it('gives the exact cell when the radius is 0', () => {
    const flat = composeContent([corePack]);
    const zero = {
      ...flat,
      balance: {
        ...flat.balance,
        K: { ...flat.balance.K, map: { ...flat.balance.K.map, hintRadius: 0 } },
      },
    };
    const h = locationHint(fresh(), zero, ENEMY)!;
    expect(h.exact).toBe(true);
    expect(h.hexes).toEqual([cellKey]);
  });

  it('gives no hint to a target with no place on the map', () => {
    const state = fresh();
    expect(hint(state, { kind: 'enemy', id: 'core:no_such_enemy' })).toBeNull();
    expect(hint(state, { kind: 'cell', id: 'core:no_such_cell' })).toBeNull();
    expect(hint(state, { kind: 'poi', id: 'core:no_such_poi' })).toBeNull();
    const zoned = new Set(content.zones.map((z) => z.enemy));
    const free = content.enemies.find((e) => !zoned.has(e.id));
    if (free) expect(hint(state, { kind: 'enemy', id: free.id })).toBeNull();
  });

  it('holds the target for every cell of the map, never as a neighbour outside the area', () => {
    const state = fresh();
    for (const c of content.cells) {
      state.world.surveyed = {};
      const h = hint(state, { kind: 'cell', id: c.id });
      if (!h) continue;
      const key = hexKey(c.hex[0], c.hex[1]);
      if (!h.exact) expect(h.hexes, c.id).toContain(key);
      expect(h.regions, c.id).toContain(c.region);
    }
  });
});
