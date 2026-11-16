/** The hex map: grid data, routes, travel, fog and survey range, surveys, auto-survey, hooks and the save. */
import { composeContent, content, corePack } from '@shinobi/content';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addRule,
  advance,
  AUTOSURVEY_ID,
  AUTOSURVEY_KIND,
  autoPlan,
  composeRules,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  EXPLORE_KIND,
  hexDistance,
  hexesWithin,
  hexInfo,
  hexKey,
  hexLine,
  isSurveyed,
  listHexes,
  neighbours,
  parseHexKey,
  rangeNow,
  routeTo,
  serialize,
  STATE_VERSION,
  subjectOf,
  surveyAccess,
  surveyLevel,
  surveyRange,
  travelPlan,
  type Command,
  type GameEvent,
  type GameState,
  type HexEnteredHook,
  type Rules,
} from '../src/index.ts';
import { testmodPack } from '../src/testmod/index.ts';
import { genin, setLevel, teleport } from './helpers.ts';

const K = content.balance.K;
const MIN = 60_000;
const HOUR = 60 * MIN;

const ok = (state: GameState, command: Command, rules: Rules = defaultRules) =>
  expect(dispatch(state, command, content, rules), JSON.stringify(command)).toEqual({ ok: true });
const refusal = (state: GameState, command: Command): string | null => {
  const r = dispatch(state, command, content);
  return r.ok ? null : r.reason;
};
const walk = (address: string, slot = 0): Command => ({
  type: 'world.travel',
  cell: address,
  mode: 'walk',
  slot,
});
const survey = (address: string): Command => ({
  type: 'action.start',
  slot: 0,
  kind: EXPLORE_KIND,
  id: address,
});
const cellHex = (id: string) => {
  const c = content.cells.find((x) => x.id === `core:${id}`);
  if (!c) throw new Error(`no cell ${id}`);
  return { q: c.hex[0], r: c.hex[1], key: hexKey(c.hex[0], c.hex[1]), id: c.id };
};
const START = cellHex('okolytsi_sela');
/** Marks the whole land as surveyed, so that routes do not depend on the surveys that opened them. */
function surveyAll(state: GameState): void {
  for (const h of content.hexes) if (h.terrain) state.world.surveyed[hexKey(h.q, h.r)] = true;
}
const eventsOf = <T extends GameEvent['type']>(state: GameState, type: T) =>
  state.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const isFog = (state: GameState, key: string) => !isSurveyed(state, content, key);
/** A playable hex that is no cell, at `distance` from the start, in fog at the start of a game. */
function fogPlain(state: GameState, distance: number): string {
  for (const h of content.hexes) {
    const key = hexKey(h.q, h.r);
    if (!h.terrain || subjectOf(content, key)?.cell) continue;
    if (hexDistance(h, START) === distance && isFog(state, key)) return key;
  }
  throw new Error(`no fog hex at ${distance}`);
}

describe('the grid in the content', () => {
  const byKey = new Map(content.hexes.map((h) => [hexKey(h.q, h.r), h]));
  const playable = content.hexes.filter((h) => h.terrain !== undefined);

  it('holds the world: 1134 hexes, 118 of them playable, in the Land of Fire', () => {
    expect(content.hexes).toHaveLength(1134);
    expect(playable).toHaveLength(118);
    expect(playable.every((h) => h.country === 'core:fire')).toBe(true);
    expect(byKey.size).toBe(1134);
  });

  it('puts every cell on its own playable hex and every place on a playable hex', () => {
    const used = new Set<string>();
    for (const c of content.cells) {
      const key = hexKey(c.hex[0], c.hex[1]);
      expect(byKey.get(key)?.terrain, c.id).toBeDefined();
      expect(used.has(key), `${c.id} shares a hex`).toBe(false);
      used.add(key);
    }
    expect(content.places).toHaveLength(25);
    for (const p of content.places)
      expect(byKey.get(hexKey(p.hex[0], p.hex[1]))?.terrain, p.id).toBeDefined();
  });

  it('has the numbers of every terrain, and a locale name for every country, terrain and place', () => {
    for (const t of content.terrains) {
      expect(K.map.terrain[t.id]?.walkMin, t.id).toBeGreaterThan(0);
      expect(content.locales.uk[`terrain.${t.id}.name`], t.id).toBeTruthy();
    }
    for (const c of content.countries)
      expect(content.locales.uk[`country.${c.id}.name`]).toBeTruthy();
    for (const p of content.places) {
      expect(content.locales.uk[`place.${p.id}.name`], p.id).toBeTruthy();
      expect(content.locales.uk[`place.${p.id}.desc`], p.id).toBeTruthy();
    }
  });

  it('is one connected land: every cell can be reached from the first once everything is surveyed', () => {
    const state = genin();
    surveyAll(state);
    for (const c of content.cells) {
      expect(routeTo(state, content, { q: c.hex[0], r: c.hex[1] }), c.id).not.toBeNull();
    }
  });

  it('draws neighbours at distance one, lines between hexes and keys', () => {
    const origin = { q: 5, r: 5 };
    for (const n of neighbours(origin)) expect(hexDistance(origin, n)).toBe(1);
    expect(hexesWithin(origin, 2)).toHaveLength(19);
    expect(parseHexKey('-3,12')).toEqual({ q: -3, r: 12 });
    expect(parseHexKey('3;12')).toBeNull();
    const line = hexLine({ q: 0, r: 0 }, { q: 4, r: -2 });
    expect(line).toHaveLength(5);
    for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1]!, line[i]!)).toBe(1);
  });
});

describe('fog and the survey range', () => {
  it('surveys the starting area in a new game, plain hexes at level 1, cells only marked', () => {
    const state = genin();
    const radius = K.map.startRadius;
    let plain = 0;
    for (const a of hexesWithin(START, radius)) {
      const key = hexKey(a.q, a.r);
      const hex = content.hexes.find((h) => h.q === a.q && h.r === a.r);
      if (!hex?.terrain) continue;
      expect(state.world.surveyed[key], key).toBe(true);
      const subject = subjectOf(content, key)!;
      if (subject.cell) expect(state.world.explores[subject.address]).toBeUndefined();
      else {
        plain++;
        expect(surveyLevel(state, subject, content), key).toBe(1);
      }
    }
    expect(plain).toBeGreaterThan(3);
    // The land beyond is fog: no terrain, no cell, no way in.
    const key = fogPlain(state, radius + 1);
    const info = hexInfo(state, key, content)!;
    expect(info.surveyed).toBe(false);
    expect(info.terrain).toBeNull();
    expect(info.cell).toBeNull();
    expect(travelPlan(state, key, content).blocked).toBe('error.cellNotReachable');
  });

  it('lets the player survey a hex up to the range away, not only a neighbour', () => {
    const state = genin();
    expect(surveyRange(state, content)).toBe(K.map.range[0]?.range);
    const key = fogPlain(state, K.map.startRadius + 1);
    // Out of the range of 2? The hex is 3 away from the start: too far.
    expect(refusal(state, survey(key))).toBe('error.outOfRange');
    setLevel(state, 'scout', 10);
    expect(surveyRange(state, content)).toBe(3);
    ok(state, survey(key));
    advance(state, 10 * MIN, content);
    expect(isSurveyed(state, content, key)).toBe(true);
    expect(hexInfo(state, key, content)?.terrain).not.toBeNull();
  });

  it('keeps a hex behind fog out of reach until surveyed ground touches it', () => {
    const state = genin();
    setLevel(state, 'scout', 99);
    const far = fogPlain(state, 5);
    const at = parseHexKey(far)!;
    expect(surveyAccess(state, content, at)).toBe('cutOff');
    expect(refusal(state, survey(far))).toBe('error.cutOff');
    // Surveyed land that reaches a neighbour of it opens it.
    const next = neighbours(at).find((n) => {
      const hex = content.hexes.find((h) => h.q === n.q && h.r === n.r);
      return hex?.terrain && hexDistance(n, START) <= K.map.startRadius + 3;
    })!;
    // A chain of surveyed hexes from the start to that neighbour.
    for (const h of hexLine(START, next)) state.world.surveyed[hexKey(h.q, h.r)] = true;
    expect(surveyAccess(state, content, at)).toBe('ok');
  });

  it('refuses the outside of the range, with the range of the balance by Scouting level', () => {
    const state = genin();
    for (const step of K.map.range.filter((s) => s.scout > 0)) {
      setLevel(state, 'scout', step.scout);
      expect(surveyRange(state, content)).toBeGreaterThanOrEqual(step.range);
    }
    expect(rangeNow(state, content)).toBe(surveyRange(state, content));
  });

  it('adds a hex of range while standing on a found outpost', () => {
    const state = genin();
    const outpost = content.cells.find((c) => c.pois.some((p) => p.kind === 'outpost'))!;
    teleport(state, outpost.id);
    const plain = surveyRange(state, content);
    for (const p of outpost.pois) state.world.pois[p.id] = true;
    expect(surveyRange(state, content)).toBe(plain + K.map.outpostRange);
  });

  it('makes a hex passable when it reaches level 1, and not before', () => {
    const state = genin();
    setLevel(state, 'scout', 10);
    const key = fogPlain(state, K.map.startRadius + 1);
    const need = K.map.plainSurvey[0]!;
    const each = Math.round(
      K.explore * 1000 * (K.map.terrain[subjectOf(content, key)!.hex.terrain]?.survey ?? 1),
    );
    ok(state, survey(key));
    advance(state, (need - 1) * each, content);
    expect(state.world.explores[key] ?? 0).toBeGreaterThan(0);
    expect(isSurveyed(state, content, key)).toBe(false);
    expect(routeTo(state, content, parseHexKey(key)!)).toBeNull();
    advance(state, 5 * MIN, content);
    expect(isSurveyed(state, content, key)).toBe(true);
    expect(routeTo(state, content, parseHexKey(key)!)).not.toBeNull();
  });

  it('lists every hex and shows places only on a hex that was surveyed', () => {
    const state = genin();
    expect(listHexes(state, content)).toHaveLength(content.hexes.length);
    const place = content.places.find(
      (p) => subjectOf(content, hexKey(p.hex[0], p.hex[1]))?.cell === null,
    )!;
    const key = hexKey(place.hex[0], place.hex[1]);
    state.world.surveyed[key] = true;
    state.world.explores[key] = 0;
    expect(hexInfo(state, key, content)?.places).toEqual([]);
    state.world.explores[key] = K.map.plainSurvey[0] ?? 1;
    expect(hexInfo(state, key, content)?.places).toContain(place.id);
  });
});

describe('routes', () => {
  it('goes only over surveyed, enterable hexes, and the same way each time', () => {
    const state = genin();
    surveyAll(state);
    teleport(state, 'okolytsi_sela');
    const to = cellHex('stezhka_myslyvtsia');
    const a = routeTo(state, content, to);
    expect(a).not.toBeNull();
    expect(routeTo(state, content, to)).toEqual(a);
    for (const key of a!.hexes) {
      const h = content.hexes.find((x) => hexKey(x.q, x.r) === key);
      expect(h?.terrain, `${key} is land`).toBeDefined();
    }
    expect(a!.minutes.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
  });

  it('refuses a way through fog', () => {
    const state = genin();
    const far = cellHex('stezhka_myslyvtsia');
    expect(routeTo(state, content, far)).toBeNull();
    expect(travelPlan(state, 'core:stezhka_myslyvtsia', content).blocked).toBe(
      'error.cellNotReachable',
    );
    surveyAll(state);
    expect(routeTo(state, content, far)).not.toBeNull();
    expect(travelPlan(state, 'core:stezhka_myslyvtsia', content).blocked).toBeNull();
  });

  it('is cheaper over a road than through hills, by the balance numbers', () => {
    expect(K.map.terrain.road?.walkMin).toBeLessThan(K.map.terrain.forest?.walkMin ?? 0);
    expect(K.map.terrain.forest?.walkMin).toBeLessThan(K.map.terrain.hills?.walkMin ?? 0);
  });
});

describe('surveying a plain hex', () => {
  it('trains Scouting, has two levels and stops by itself at the top', () => {
    const state = genin();
    setLevel(state, 'scout', 10);
    const key = fogPlain(state, K.map.startRadius + 1);
    ok(state, survey(key));
    const levels = K.map.plainSurvey.length;
    expect(levels).toBe(2);
    const xp = state.skills.scout!.xp;
    advance(state, 2 * HOUR, content);
    expect(state.world.explores[key]).toBe(K.map.plainSurvey[levels - 1]);
    expect(state.skills.scout!.xp).toBeGreaterThan(xp);
    expect(state.slots[0]?.action).toBeNull();
    expect(refusal(state, survey(key))).toBe('error.cellMaxed');
    expect(eventsOf(state, 'hexSurveyed').map((e) => e.level)).toEqual([1, 2]);
  });

  it('is quick: both levels take minutes, scaled by the terrain', () => {
    const total = (K.map.plainSurvey[1] ?? 0) * K.explore * 1000 * 1.4;
    expect(total).toBeLessThan(30 * MIN);
  });

  it('is refused to a student', () => {
    const state = createState(1, content);
    expect(refusal(state, survey(fogPlain(state, K.map.startRadius + 1)))).not.toBeNull();
  });
});

describe('travel is hex by hex', () => {
  it('reports each hex entered as an event and runs the hooks of the rules in order', () => {
    const calls: string[] = [];
    const a: HexEnteredHook = (_s, ctx) => void calls.push(`a:${ctx.hex}`);
    const b: HexEnteredHook = (_s, ctx) => void calls.push(`b:${ctx.terrain}`);
    const rules = addRule(addRule(defaultRules, 'hexEntered', a), 'hexEntered', b);
    const state = genin();
    ok(state, walk('core:rysovi_polia'), rules);
    advance(state, 90 * MIN, content, rules);
    const entered = eventsOf(state, 'hexEntered');
    expect(entered.length).toBeGreaterThanOrEqual(2);
    expect(entered.every((e) => e.by === 'walk')).toBe(true);
    expect(entered.at(-1)?.hex).toBe(cellHex('rysovi_polia').key);
    expect(calls).toHaveLength(entered.length * 2);
    expect(calls.filter((c) => c.startsWith('a:'))).toEqual(entered.map((e) => `a:${e.hex}`));
    expect(calls.slice(0, 2).map((c) => c[0])).toEqual(['a', 'b']);
    expect(eventsOf(state, 'travelled')).toHaveLength(1);
  });

  it('has no handlers in the built-in rules', () => {
    expect(defaultRules.hexEntered).toEqual([]);
    expect(composeRules(defaultRules, [corePack], content).hexEntered).toEqual([]);
  });

  it('keeps walking when a handler of a pack throws', () => {
    const boom: HexEnteredHook = () => {
      throw new Error('boom');
    };
    const own = testmodPack.rules as unknown as (b: Rules, c: typeof content) => Rules;
    const pack = {
      ...testmodPack,
      rules: (base: Rules, c: typeof content) => addRule(own(base, c), 'hexEntered', boom),
    };
    const withMod = composeContent([corePack, pack]);
    const game = composeRules(defaultRules, [corePack, pack], withMod);
    const state = genin();
    expect(dispatch(state, walk('core:rysovi_polia'), withMod, game)).toEqual({ ok: true });
    advance(state, 90 * MIN, withMod, game);
    expect(state.world.location).toBe('core:rysovi_polia');
    expect(state.events.some((e) => e.type === 'ruleDisabled')).toBe(true);
  });

  it('gives the same state however the time is cut', () => {
    const make = (): GameState => {
      const state = genin(9);
      ok(state, walk('core:rysovi_polia'));
      return state;
    };
    const whole = make();
    advance(whole, 3 * HOUR, content);
    expect(whole.world.location).toBe('core:rysovi_polia');
    for (const chunk of [997, 60_000, 11 * MIN]) {
      const parts = make();
      for (let done = 0; done < 3 * HOUR; done += chunk)
        advance(parts, Math.min(chunk, 3 * HOUR - done), content);
      expect(serialize(parts), `chunk ${chunk}`).toBe(serialize(whole));
    }
  });
});

describe('auto-survey', () => {
  const start = (state: GameState, rules: Rules = defaultRules) =>
    ok(state, { type: 'action.start', slot: 0, kind: AUTOSURVEY_KIND, id: AUTOSURVEY_ID }, rules);

  it('plans the nearest hex within range that can be surveyed, from where it stands', () => {
    const state = genin();
    const plan = autoPlan(state, content);
    expect(plan).not.toBeNull();
    expect(plan!.route).toEqual([]);
    const subject = plan!.subject;
    expect(hexDistance(parseHexKey(plan!.stand)!, subject.hex)).toBeLessThanOrEqual(
      surveyRange(state, content),
    );
  });

  it('surveys, goes on from one hex to the next and lifts the fog over an hour of game time', () => {
    const state = genin();
    setLevel(state, 'scout', 20);
    const before = Object.keys(state.world.surveyed).length;
    start(state);
    const xp = state.skills.scout!.xp;
    advance(state, HOUR, content);
    expect(Object.keys(state.world.surveyed).length).toBeGreaterThan(before);
    expect(state.skills.scout!.xp).toBeGreaterThan(xp);
    for (const key of Object.keys(state.world.surveyed))
      expect(isSurveyed(state, content, key), key).toBe(true);
  });

  it('walks when nothing is left in range, only as far as needed', () => {
    const state = genin();
    setLevel(state, 'scout', 20);
    // Everything in range is done already: the only way on is to walk.
    for (const a of hexesWithin(START, surveyRange(state, content))) {
      const s = subjectOf(content, hexKey(a.q, a.r));
      if (!s) continue;
      state.world.surveyed[hexKey(a.q, a.r)] = true;
      state.world.explores[s.address] = s.cell
        ? (K.cellExplores.at(-1) ?? 0)
        : (K.map.plainSurvey.at(-1) ?? 0);
    }
    start(state);
    advance(state, 6 * HOUR, content);
    expect(state.world.location).not.toBe(START.id);
    expect(Object.keys(state.world.surveyed).length).toBeGreaterThan(30);
  });

  it('stops when nothing is left to survey, with its reason', () => {
    const state = genin();
    setLevel(state, 'scout', 99);
    start(state);
    advance(state, 48 * HOUR, content);
    expect(state.slots[0]?.action).toBeNull();
    expect(autoPlan(state, content)).toBeNull();
    expect(
      refusal(state, { type: 'action.start', slot: 0, kind: AUTOSURVEY_KIND, id: AUTOSURVEY_ID }),
    ).toBe('error.nothingToSurvey');
  });

  it('is deterministic and gives the same state however the time is cut', () => {
    const make = (): GameState => {
      const state = genin(3);
      setLevel(state, 'scout', 20);
      start(state);
      return state;
    };
    for (const [total, chunks] of [
      [2 * HOUR, [5003, 7 * MIN, 41 * MIN]],
      [90_000, [1, 999]],
    ] as const) {
      const whole = make();
      advance(whole, total, content);
      const again = make();
      advance(again, total, content);
      expect(serialize(again)).toBe(serialize(whole));
      for (const chunk of chunks) {
        const parts = make();
        for (let done = 0; done < total; done += chunk)
          advance(parts, Math.min(chunk, total - done), content);
        expect(serialize(parts), `chunk ${chunk}`).toBe(serialize(whole));
      }
    }
  });

  it('survives a save in the middle of a walk and goes on the same', () => {
    const state = genin(5);
    setLevel(state, 'scout', 20);
    start(state);
    advance(state, 37 * MIN + 123, content);
    const loaded = deserialize(serialize(state), content);
    expect(serialize(loaded)).toBe(serialize(state));
    advance(state, HOUR, content);
    advance(loaded, HOUR, content);
    expect(serialize(loaded)).toBe(serialize(state));
  });
});

describe('the save', () => {
  type Fixture = Record<'fresh' | 'mid' | 'late', string>;
  const saves = JSON.parse(
    readFileSync(new URL('./fixtures/save-v15-world.json', import.meta.url), 'utf8'),
  ) as Fixture;
  const raw = (name: keyof Fixture) =>
    JSON.parse(saves[name]) as {
      v: number;
      state: { world: { explores: Record<string, number>; location: string } };
    };

  it('has the version after the reveal rule', () => {
    expect(STATE_VERSION).toBeGreaterThanOrEqual(16);
  });

  it('loads a real version-15 save with nothing explored: the starting area is surveyed', () => {
    expect(raw('fresh').v).toBe(15);
    const loaded = deserialize(saves.fresh, content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(loaded.world.location).toBe(content.regions[0]?.cells[0]);
    expect(loaded.world.surveyed).toEqual(createState(1, content).world.surveyed);
    expect(Object.keys(loaded.world.surveyed).length).toBeGreaterThan(6);
  });

  it('carries explored cells, the position and the found points over a real version-15 save', () => {
    const before = raw('mid');
    expect(before.v).toBe(15);
    const loaded = deserialize(saves.mid, content);
    for (const [id, n] of Object.entries(before.state.world.explores))
      expect(loaded.world.explores[id], id).toBe(n);
    expect(loaded.world.location).toBe(before.state.world.location);
    // Every explored cell and its whole region are surveyed, with the line that leads to them.
    for (const id of Object.keys(before.state.world.explores)) {
      const cell = content.cells.find((c) => c.id === id)!;
      const region = content.regions.find((r) => r.id === cell.region)!;
      for (const other of region.cells) {
        const o = content.cells.find((c) => c.id === other)!;
        expect(loaded.world.surveyed[hexKey(o.hex[0], o.hex[1])], other).toBe(true);
      }
    }
    for (const cell of content.cells) {
      if ((loaded.world.explores[cell.id] ?? 0) < (K.cellExplores[0] ?? 1)) continue;
      for (const poi of cell.pois) expect(loaded.world.pois[poi.id], poi.id).toBe(true);
    }
    // A cell that was only marked keeps its level 0, and the player can walk from there to every cell of the region.
    for (const c of content.cells.filter((x) => x.region === content.regions[0]!.id))
      expect(routeTo(loaded, content, { q: c.hex[0], r: c.hex[1] }), c.id).not.toBeNull();
    expect(serialize(deserialize(serialize(loaded), content))).toBe(serialize(loaded));
  });

  it('carries a late save over: three regions explored, the player in the last', () => {
    const before = raw('late');
    const loaded = deserialize(saves.late, content);
    for (const [id, n] of Object.entries(before.state.world.explores))
      expect(loaded.world.explores[id], id).toBe(n);
    for (const c of content.cells)
      expect(routeTo(loaded, content, { q: c.hex[0], r: c.hex[1] }), c.id).not.toBeNull();
  });

  it('cleans a doctored world: foreign hexes, huge surveys, a position in the sea', () => {
    const state = genin();
    const parsed = JSON.parse(serialize(state)) as { state: { world: Record<string, unknown> } };
    const sea = content.hexes.find((h) => h.terrain === undefined)!;
    const plain = hexKey(START.q + 1, START.r);
    parsed.state.world = {
      location: hexKey(sea.q, sea.r),
      explores: { [plain]: 1e9, '999,999': 5, [hexKey(sea.q, sea.r)]: 3, 'core:ghost': 2 },
      surveyed: { '999,999': true, [plain]: true, [hexKey(sea.q, sea.r)]: true, junk: true },
      pois: {},
      claimed: {},
    };
    const loaded = deserialize(JSON.stringify(parsed), content);
    expect(loaded.world.location).toBe(content.regions[0]?.cells[0]);
    const keys = Object.keys(loaded.world.surveyed);
    for (const bad of ['999,999', 'junk', hexKey(sea.q, sea.r)]) expect(keys).not.toContain(bad);
    for (const [key, n] of Object.entries(loaded.world.explores))
      expect(n, key).toBeLessThanOrEqual(K.map.plainSurvey.at(-1) ?? 0);
    expect(loaded.world.explores['999,999']).toBeUndefined();
    expect(loaded.world.explores[hexKey(sea.q, sea.r)]).toBeUndefined();
  });
});
