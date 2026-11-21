/** Keys block passage and survey: water (river, lake, cells with the key of water) cannot be entered, crossed or surveyed without the key. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  crossingAt,
  deserialize,
  dispatch,
  EXPLORE_KIND,
  hexInfo,
  hexKey,
  hexKeyIds,
  hexesWithin,
  isSurveyed,
  missingKeys,
  routeKeyCost,
  routeTo,
  serialize,
  travelPlan,
  type Command,
  type GameState,
} from '../src/index.ts';
import { genin, setLevel } from './helpers.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The skill level the key of water asks in the data (one `skill` requirement). */
const WATER = content.cellKeys.water as { t: 'skill'; skill: string; level: number };
const LAKE = 'core:lisove_ozero';
const MOLE_CELL = 'core:skhovyshche_fortetsi';

const walk = (address: string, slot = 0): Command => ({
  type: 'world.travel',
  cell: address,
  mode: 'walk',
  slot,
});
const reason = (state: GameState, command: Command): string | null => {
  const r = dispatch(state, command, content);
  return r.ok ? null : r.reason;
};
/** Marks the whole land as surveyed, so that routes do not depend on the surveys that opened them. */
function surveyAll(state: GameState): void {
  for (const h of content.hexes) if (h.terrain) state.world.surveyed[hexKey(h.q, h.r)] = true;
}
const terrainAt = (key: string): string | undefined =>
  content.hexes.find((h) => hexKey(h.q, h.r) === key)?.terrain;
const isWaterHex = (key: string): boolean => hexKeyIds(content, key).includes('water');
const withWater = (state: GameState): void => setLevel(state, WATER.skill, WATER.level);
const playable = content.hexes.filter((h) => h.terrain !== undefined);

/** A start and a target on open ground, such that the short way crosses water and a longer open way exists. */
function detourPair(): { from: string; to: string } {
  const state = genin();
  surveyAll(state);
  for (const a of playable) {
    const from = hexKey(a.q, a.r);
    if (hexKeyIds(content, from).length > 0) continue;
    state.world.location = from;
    for (const b of playable) {
      const to = hexKey(b.q, b.r);
      if (hexKeyIds(content, to).length > 0 || to === from) continue;
      const cost = routeKeyCost(state, content, b);
      if (cost?.length === 1 && cost[0] === 'water' && routeTo(state, content, b))
        return { from, to };
    }
  }
  throw new Error('no pair whose short way crosses water');
}

describe('keys in the data', () => {
  it('gives river and lake the key of water, and the key is a requirement', () => {
    for (const id of ['river', 'lake'])
      expect(content.terrains.find((t) => t.id === id)?.key, id).toBe('water');
    expect(content.cellKeys.water).toBeDefined();
    expect(content.terrains.filter((t) => t.key === undefined).length).toBeGreaterThan(3);
  });

  it('needs the key of a cell and of its terrain; a crossing is exempt from the key of its terrain', () => {
    const ford = content.cells.find((c) => c.id === 'core:prykordonnyi_lis_brid')!;
    expect(ford.key).toBeNull();
    expect(hexKeyIds(content, hexKey(ford.hex[0], ford.hex[1]))).toEqual([]);
    expect(crossingAt(content, hexKey(ford.hex[0], ford.hex[1]))).toBe('ford');
    const rubble = content.cells.find((c) => c.id === MOLE_CELL)!;
    expect(hexKeyIds(content, hexKey(rubble.hex[0], rubble.hex[1]))).toEqual(['rubble']);
  });
});

describe('routes and keys', () => {
  it('goes round water without the key, and through it with the key', () => {
    const { from, to } = detourPair();
    const state = genin();
    surveyAll(state);
    state.world.location = from;
    const target = content.hexes.find((h) => hexKey(h.q, h.r) === to)!;
    const round = routeTo(state, content, target)!;
    expect(round.hexes.length).toBeGreaterThan(0);
    for (const key of round.hexes) expect(missingKeys(state, content, key), key).toEqual([]);
    const plan = travelPlan(state, to, content);
    expect(plan.blocked).toBeNull();
    expect(plan.detour).toBe(true);
    expect(plan.keys).toEqual(['water']);
    const roundMinutes = round.minutes.reduce((a, b) => a + b, 0);

    withWater(state);
    const direct = routeTo(state, content, target)!;
    expect(direct.hexes.some(isWaterHex)).toBe(true);
    expect(direct.minutes.reduce((a, b) => a + b, 0)).toBeLessThan(roundMinutes);
    const open = travelPlan(state, to, content);
    expect(open.detour).toBe(false);
    expect(open.keys).toEqual([]);
  });

  it('refuses a destination that can be reached only through water, naming the key, for a walk and for a trip for ryo', () => {
    const state = genin();
    surveyAll(state);
    state.world.location = 'core:okolytsi_sela';
    expect(travelPlan(state, LAKE, content).blocked).toBe('error.keyMissing');
    expect(travelPlan(state, LAKE, content).keys).toEqual(['water']);
    expect(reason(state, walk(LAKE))).toBe('error.keyMissing');
    state.bank[content.currencies.find((c) => c.role === 'money')!.id] = 100000;
    expect(reason(state, { type: 'world.travel', cell: LAKE, mode: 'paid', slot: 0 })).toBe(
      'error.keyMissing',
    );
    withWater(state);
    expect(reason(state, walk(LAKE))).toBeNull();
  });

  it('follows the knowledge of the performer: a clone without the key is refused too', () => {
    const state = genin();
    surveyAll(state);
    state.slots.push({ action: null, progress: 0, share: 1000, data: null });
    state.world.figures = { 1: 'core:okolytsi_sela' };
    expect(travelPlan(state, LAKE, content, undefined, 1).blocked).toBe('error.keyMissing');
    expect(routeTo(state, content, { q: 7, r: 14 }, 1)).toBeNull();
    withWater(state);
    expect(routeTo(state, content, { q: 7, r: 14 }, 1)).not.toBeNull();
  });

  it('walks round the water offline too, never entering it', () => {
    const { from, to } = detourPair();
    const state = genin();
    surveyAll(state);
    state.world.location = from;
    expect(reason(state, walk(to))).toBeNull();
    advance(state, 6 * HOUR, content);
    expect(state.world.location).toBe(to);
    const entered = state.events.filter((e) => e.type === 'hexEntered');
    expect(entered.length).toBeGreaterThan(1);
    for (const e of entered) expect(isWaterHex(e.hex), e.hex).toBe(false);
  });

  it('stops a walk when the way is shut under the walker', () => {
    const state = genin();
    surveyAll(state);
    withWater(state);
    state.world.location = 'core:okolytsi_sela';
    expect(reason(state, walk(LAKE))).toBeNull();
    // The key is lost (a doctored state): the walk finds no way on and ends.
    setLevel(state, WATER.skill, WATER.level - 1);
    advance(state, 6 * HOUR, content);
    expect(state.world.location).not.toBe(LAKE);
  });
});

describe('surveying keyed hexes', () => {
  /** A plain river hex in fog with an open surveyed hex beside it. */
  function riverBank(): { state: GameState; water: string } {
    const state = genin();
    setLevel(state, 'scout', 99);
    const water = '14,12';
    expect(terrainAt(water)).toBe('river');
    const bank = '14,13';
    expect(hexKeyIds(content, bank)).toEqual([]);
    state.world.surveyed[bank] = true;
    state.world.location = bank;
    return { state, water };
  }

  it('refuses to survey a plain river hex without the key, and surveys it with the key', () => {
    const { state, water } = riverBank();
    const start: Command = { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id: water };
    expect(reason(state, start)).toBe('error.requirementsNotMet');
    expect(hexInfo(state, water, content)?.surveyWhy).toBe('error.scoutLevelLow');
    withWater(state);
    expect(reason(state, start)).toBeNull();
    advance(state, 10 * MIN, content);
    expect(isSurveyed(state, content, water)).toBe(true);
  });

  it('names the key on a surveyed keyed hex and in its view', () => {
    const { state, water } = riverBank();
    state.world.surveyed[water] = true;
    const info = hexInfo(state, water, content)!;
    expect(info.surveyWhy).toBe('error.keyMissing');
    expect(info.keys.map((k) => [k.id, k.req.met])).toEqual([['water', false]]);
    withWater(state);
    expect(hexInfo(state, water, content)!.keys[0]?.req.met).toBe(true);
  });

  it('refuses a cell with the key of water, and surveys it with the key', () => {
    const state = genin();
    setLevel(state, 'scout', 99);
    state.world.surveyed['8,14'] = true;
    state.world.location = 'core:ternovi_zarosti';
    const start: Command = { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id: LAKE };
    expect(reason(state, start)).toBe('error.requirementsNotMet');
    withWater(state);
    expect(reason(state, start)).toBeNull();
  });
});

describe('the start zone and old saves', () => {
  it('does not survey a hex that needs a key at the start, wherever the start radius reaches', () => {
    const state = createState(1, content);
    const first = content.cells[0]!;
    let seen = 0;
    for (const a of hexesWithin({ q: first.hex[0], r: first.hex[1] }, 4)) {
      const key = hexKey(a.q, a.r);
      if (!terrainAt(key)) continue;
      seen++;
      if (hexKeyIds(content, key).length > 0)
        expect(state.world.surveyed[key], key).toBeUndefined();
    }
    expect(seen).toBeGreaterThan(10);
    // The rubble cell of the fortress is inside the radius of the start and is left in fog.
    const rubble = content.cells.find((c) => c.id === MOLE_CELL)!;
    expect(state.world.surveyed[hexKey(rubble.hex[0], rubble.hex[1])]).toBeUndefined();
    expect(reason(state, walk(MOLE_CELL))).toBe('error.cellNotReachable');
  });

  it('keeps what an old save has surveyed, lets the walker leave a keyed hex it stands on, and shuts it behind', () => {
    const old = genin();
    const rubble = content.cells.find((c) => c.id === MOLE_CELL)!;
    const key = hexKey(rubble.hex[0], rubble.hex[1]);
    old.world.surveyed[key] = true;
    old.world.location = MOLE_CELL;
    const state = deserialize(serialize(old), content);
    // Nothing is un-surveyed, and the walker can leave the hex it stands on.
    expect(state.world.surveyed[key]).toBe(true);
    expect(reason(state, walk('core:okolytsi_sela'))).toBeNull();
    advance(state, 2 * HOUR, content);
    expect(state.world.location).toBe('core:okolytsi_sela');
    // Out of it, the hex is shut again: it cannot be entered without its key.
    expect(reason(state, walk(MOLE_CELL))).toBe('error.keyMissing');
  });
});

describe('crossings', () => {
  const FORD = 'core:prykordonnyi_lis_brid';

  it('lets a ford be walked to and surveyed without the key', () => {
    const state = genin();
    surveyAll(state);
    state.world.location = 'core:okolytsi_sela';
    expect(reason(state, walk(FORD))).toBeNull();
    expect(travelPlan(state, FORD, content).crossings).toEqual(['ford']);
    expect(hexInfo(state, '12,14', content)?.crossing).toBe('ford');
    // Survey: the ford in fog, with surveyed ground beside it.
    const fresh = genin();
    setLevel(fresh, 'scout', 99);
    fresh.world.surveyed['11,14'] = true;
    fresh.world.location = '11,14';
    expect(
      reason(fresh, { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id: FORD }),
    ).toBeNull();
  });

  it('lets a bridge be crossed, while the river beside it and the lake stay shut', () => {
    const bridged = {
      ...content,
      hexes: content.hexes.map((h) =>
        h.q === 14 && h.r === 12 ? { ...h, crossing: 'bridge' as const } : h,
      ),
    };
    expect(crossingAt(bridged, '14,12')).toBe('bridge');
    expect(hexKeyIds(bridged, '14,12')).toEqual([]);
    expect(hexKeyIds(bridged, '13,12')).toEqual(['water']);
    expect(hexKeyIds(bridged, '7,14')).toEqual(['water']);
    const state = genin();
    surveyAll(state);
    state.world.location = '14,13';
    expect(routeTo(state, bridged, { q: 14, r: 12 })).not.toBeNull();
    expect(routeTo(state, bridged, { q: 13, r: 12 })).toBeNull();
    expect(routeTo(state, content, { q: 14, r: 12 })).toBeNull();
  });
});
