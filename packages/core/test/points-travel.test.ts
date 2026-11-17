/**
 * Points of interest on places, travel on foot or for ryo, outposts, XP and finds on the road, map
 * mastery, and a clone that stands where it arrived (X3).
 */
import { content, type ContentDb, type Place } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  autoPlan,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  EXPLORE_KIND,
  getMod,
  hexInfo,
  hexKey,
  isFound,
  jumpBlocked,
  listHexes,
  mapMastery,
  outpostTargets,
  pay,
  performers,
  pointStatus,
  rareChance,
  rareLeft,
  rate,
  routeTo,
  serialize,
  settlePoints,
  surveyLevel,
  subjectOf,
  touchWorld,
  travelPlan,
  travelPrice,
  walkHook,
  worldRevision,
  type Command,
  type GameEvent,
  type GameState,
  type Rules,
} from '../src/index.ts';
import { modContent, modGenin, modRules } from './packs-helpers.ts';
import { genin, setLevel } from './helpers.ts';

const K = content.balance.K;
const S = K.scouting;
const MIN = 60_000;
const HOUR = 60 * MIN;

const ok = (
  state: GameState,
  command: Command,
  c: ContentDb = content,
  rules: Rules = defaultRules,
) => expect(dispatch(state, command, c, rules), JSON.stringify(command)).toEqual({ ok: true });
const refusal = (state: GameState, command: Command, c: ContentDb = content): string | null => {
  const r = dispatch(state, command, c, defaultRules);
  return r.ok ? null : r.reason;
};
const eventsOf = <T extends GameEvent['type']>(state: GameState, type: T) =>
  state.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const placeOf = (id: string, c: ContentDb = content): Place => {
  const place = c.places.find((p) => p.id === id);
  if (!place) throw new Error(`no place ${id}`);
  return place;
};
const keyOfPlace = (id: string, c: ContentDb = content): string => {
  const p = placeOf(id, c);
  return hexKey(p.hex[0], p.hex[1]);
};
const cellAt = (key: string, c: ContentDb = content): string | undefined =>
  c.cells.find((x) => hexKey(x.hex[0], x.hex[1]) === key)?.id;

/** Explores the cell on the hex of a place to its first level (which is what makes a place known on it). */
function reveal(state: GameState, placeId: string, c: ContentDb = content): void {
  const cell = cellAt(keyOfPlace(placeId, c), c);
  if (cell)
    state.world.explores[cell] = Math.max(state.world.explores[cell] ?? 0, K.cellExplores[0] ?? 1);
  state.world.surveyed[keyOfPlace(placeId, c)] = true;
  touchWorld(state);
}

/** The state with the performer of `slot` put on the hex of a place. */
function stand(state: GameState, placeId: string, slot = 0): void {
  const key = keyOfPlace(placeId);
  const address = cellAt(key) ?? key;
  if (slot === 0) state.world.location = address;
  else (state.world.figures ??= {})[slot] = address;
}

/** A second action slot with a clone standing in it at the hex of a place. */
function cloneAt(state: GameState, placeId: string): void {
  state.slots.push({ action: { kind: 'stand', id: 'here' }, progress: 0, share: 500, data: null });
  stand(state, placeId, 1);
}

const withPlaces = (places: Place[]): ContentDb => ({ ...content, places });
const without = (id: string): Place[] => content.places.filter((p) => p.id !== id);

const TG44 = 'core:training_ground_44';
const TG44_CELL = 'core:polihon_44_lis_smerti';

// ---------- a. the discovery reward ----------

describe('discovery reward', () => {
  it('pays once, when a performer first steps on a revealed point', () => {
    const s = genin(1);
    reveal(s, TG44);
    expect(pointStatus(s, content, placeOf(TG44))).toBe('open');
    expect(isFound(s, TG44)).toBe(false);
    ok(s, { type: 'world.travel', cell: TG44_CELL, mode: 'walk', slot: 0 });
    advance(s, 10 * MIN, content);
    expect(s.world.location).toBe(TG44_CELL);
    expect(isFound(s, TG44)).toBe(true);
    expect(s.skills.tai?.xp).toBe(40);
    expect(eventsOf(s, 'pointFound')).toHaveLength(1);
    // Away and back: nothing is paid again.
    ok(s, { type: 'world.travel', cell: 'core:okolytsi_sela', mode: 'walk', slot: 0 });
    advance(s, 10 * MIN, content);
    ok(s, { type: 'world.travel', cell: TG44_CELL, mode: 'walk', slot: 0 });
    advance(s, 10 * MIN, content);
    expect(s.skills.tai?.xp).toBe(40);
    expect(eventsOf(s, 'pointFound')).toHaveLength(1);
  });

  it('is not paid on a hex whose point is not revealed yet, but at the moment it is revealed under the performer', () => {
    const s = genin(1);
    stand(s, TG44);
    s.world.surveyed[keyOfPlace(TG44)] = true;
    advance(s, 1 * MIN, content);
    expect(isFound(s, TG44)).toBe(false);
    // Surveying the cell where the performer stands reveals the place, and the system finds it.
    ok(s, { type: 'action.start', slot: 0, kind: EXPLORE_KIND, id: TG44_CELL });
    advance(s, 5 * MIN, content);
    expect(isFound(s, TG44)).toBe(true);
    expect(s.skills.tai?.xp).toBe(40);
  });

  it('pays ryo, items, other currencies and XP of a payout', () => {
    const s = genin(1);
    const paid = pay(s, content, defaultRules, {
      ryo: 12,
      items: [{ item: 'core:rice', n: 3 }],
      currencies: { intel: 4 },
      xp: { skill: 'tai', amount: 10 },
    });
    expect(paid).toMatchObject({
      ryo: 12,
      currencies: { intel: 4 },
      xp: { skill: 'tai', amount: 10 },
    });
    expect(s.currencies.ryo).toBe(12);
    expect(s.currencies.intel).toBe(4);
    expect(s.bank['core:rice']).toBe(3);
    expect(s.skills.tai?.xp).toBe(10);
  });

  it('gives every point of the core pack a reward', () => {
    const points = content.places.filter((p) => p.point);
    expect(points.length).toBeGreaterThanOrEqual(15);
    for (const p of points)
      expect(Object.keys(p.point?.reward ?? {}).length, p.id).toBeGreaterThan(0);
    // About a dozen with a bonus or an unlock.
    const worth = points.filter(
      (p) => p.point?.power || p.point?.travel || p.point?.needs || p.point?.revealedBy,
    );
    expect(worth.length).toBeGreaterThanOrEqual(8);
  });

  it('knows the point on the starting hex from the first day, without a reward', () => {
    const s = createState(1, content);
    expect(isFound(s, 'core:west_gate_post')).toBe(true);
    expect(s.currencies.ryo).toBe(0);
  });
});

// ---------- b. places of power ----------

describe('places of power', () => {
  it('give their bonus while a performer stands on a found point, and name the place as the source', () => {
    const s = genin(1);
    s.world.pois[TG44] = true;
    expect(getMod(s, 'xp.skill.tai', content).total).toBe(1);
    stand(s, TG44);
    const mod = getMod(s, 'xp.skill.tai', content);
    expect(mod.total).toBeCloseTo(1.05, 12);
    expect(mod.parts.map((m) => m.source)).toContain(`place.${TG44}.name`);
    // A point not found yet gives nothing.
    delete s.world.pois[TG44];
    expect(getMod(s, 'xp.skill.tai', content).total).toBe(1);
  });

  it('apply to every action of the player, not only the one that runs at the place', () => {
    const s = genin(1);
    s.world.pois['core:training_ground_44'] = true;
    stand(s, TG44);
    ok(s, { type: 'action.start', slot: 0, kind: 'drill', id: content.exercises[0]?.id ?? '' });
    const drill = content.exercises[0];
    const skill = drill?.skill ?? 'cc';
    // The drill trains another skill than tai: its XP is not touched by the bonus of tai ...
    const before = createState(1, content);
    before.player.rank = 'genin';
    const base = genin(1);
    ok(base, { type: 'action.start', slot: 0, kind: 'drill', id: drill?.id ?? '' });
    advance(s, HOUR, content);
    advance(base, HOUR, content);
    expect(s.skills[skill]?.xp).toBe(base.skills[skill]?.xp);
    // ... while the bonus of a point on the key of that skill does apply.
    const c2 = withPlaces(
      content.places.map((p) =>
        p.id === 'core:west_gate_post' && p.point
          ? {
              ...p,
              point: {
                ...p.point,
                power: [{ key: `xp.skill.${skill}`, op: 'add' as const, value: 0.05 }],
              },
            }
          : p,
      ),
    );
    const boosted = genin(1);
    ok(boosted, { type: 'action.start', slot: 0, kind: 'drill', id: drill?.id ?? '' }, c2);
    advance(boosted, HOUR, c2);
    expect((boosted.skills[skill]?.xp ?? 0) / (base.skills[skill]?.xp ?? 1)).toBeCloseTo(1.05, 1);
    expect(boosted.skills[skill]?.xp).toBeGreaterThan(base.skills[skill]?.xp ?? 0);
  });

  it('a clone standing on the point gives its bonus, once, whoever else stands there', () => {
    const s = genin(1);
    s.world.pois[TG44] = true;
    cloneAt(s, TG44);
    expect(performers(s, content)).toEqual([
      { slot: 0, key: keyOfPlace('core:west_gate_post') },
      { slot: 1, key: keyOfPlace(TG44) },
    ]);
    expect(getMod(s, 'xp.skill.tai', content).total).toBeCloseTo(1.05, 12);
    // The character joins the clone: still one point, one bonus.
    stand(s, TG44, 0);
    expect(getMod(s, 'xp.skill.tai', content).total).toBeCloseTo(1.05, 12);
    expect(getMod(s, 'xp.skill.tai', content).parts).toHaveLength(1);
  });

  it('a clone without an action is not on the map: it gives nothing', () => {
    const s = genin(1);
    s.world.pois[TG44] = true;
    cloneAt(s, TG44);
    s.slots[1]!.action = null;
    expect(getMod(s, 'xp.skill.tai', content).total).toBe(1);
  });

  it('different points add up', () => {
    // A second place with the same bonus, two hexes away.
    const twin: Place = {
      id: 'core:twin_ground',
      hex: placeOf('core:rice_hamlet').hex,
      kind: 'training-ground',
      role: 'training',
      point: { reward: { ryo: 1 }, power: [{ key: 'xp.skill.tai', op: 'add', value: 0.05 }] },
    };
    const c2 = withPlaces([...content.places, twin]);
    const s = genin(1);
    s.world.pois[TG44] = true;
    s.world.pois[twin.id] = true;
    cloneAt(s, 'core:rice_hamlet');
    stand(s, TG44, 0);
    expect(getMod(s, 'xp.skill.tai', c2).total).toBeCloseTo(1.1, 12);
  });
});

// ---------- c. outposts ----------

describe('outposts', () => {
  const YARD = 'core:caravan_yard';
  const YARD_CELL = 'core:karavannyi_shliakh';

  it('give free instant travel between found outposts of one group', () => {
    const s = genin(1);
    s.world.pois[YARD] = true;
    expect(outpostTargets(s, content).map((p) => p.id)).toEqual([YARD]);
    const t0 = s.now;
    const ryo = s.currencies.ryo;
    ok(s, { type: 'world.travel', cell: YARD_CELL, mode: 'outpost' });
    expect(s.world.location).toBe(YARD_CELL);
    expect(s.now).toBe(t0);
    expect(s.currencies.ryo).toBe(ryo);
    expect(s.slots[0]?.action).toBeNull();
    expect(eventsOf(s, 'hexEntered').at(-1)).toMatchObject({ by: 'outpost', slot: 0 });
    // And back, from the other end.
    ok(s, { type: 'world.travel', cell: 'core:okolytsi_sela', mode: 'outpost' });
    expect(s.world.location).toBe('core:okolytsi_sela');
  });

  it('refuse a target that is not found, one that is not an outpost, and a performer that stands elsewhere', () => {
    const s = genin(1);
    expect(refusal(s, { type: 'world.travel', cell: YARD_CELL, mode: 'outpost' })).toBe(
      'error.notOutpostTarget',
    );
    s.world.pois[YARD] = true;
    expect(refusal(s, { type: 'world.travel', cell: 'core:uzlissia', mode: 'outpost' })).toBe(
      'error.notOutpostTarget',
    );
    expect(refusal(s, { type: 'world.travel', cell: 'core:okolytsi_sela', mode: 'outpost' })).toBe(
      'error.alreadyThere',
    );
    stand(s, TG44);
    expect(refusal(s, { type: 'world.travel', cell: YARD_CELL, mode: 'outpost' })).toBe(
      'error.notAtOutpost',
    );
    expect(jumpBlocked(s, YARD_CELL, 'outpost', content, defaultRules)).toBe('error.notAtOutpost');
  });

  it('move only the performer of the slot that asks, and a clone that arrives stands there', () => {
    const s = genin(1);
    s.world.pois[YARD] = true;
    s.slots.push({ action: null, progress: 0, share: 0, data: null });
    ok(s, { type: 'world.travel', cell: YARD_CELL, mode: 'outpost', slot: 1 });
    expect(s.world.location).toBe('core:okolytsi_sela');
    expect(s.world.figures?.[1]).toBe(YARD_CELL);
    expect(s.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
    // The clone stands on, with its share of the speed, until it is dispelled.
    advance(s, 3 * HOUR, content);
    expect(s.world.figures?.[1]).toBe(YARD_CELL);
    ok(s, { type: 'action.stop', slot: 1 });
    expect(s.world.figures?.[1]).toBeUndefined();
  });

  it('a hidden outpost does not join the group until it is revealed', () => {
    const s = genin(1);
    s.world.pois['core:wayside_teahouse'] = true;
    // Found by hand but not revealed (its hex is in fog): the status says it is found, and the group lists it.
    expect(outpostTargets(s, content).map((p) => p.id)).toContain('core:wayside_teahouse');
  });
});

// ---------- travel for ryo ----------

describe('travel for ryo', () => {
  const TARGET = 'core:uzlissia';

  it('costs ryo per minute of the route at full speed, at once, to a surveyed hex', () => {
    const s = genin(1);
    const hex = content.hexes.find(
      (h) =>
        hexKey(h.q, h.r) === hexKey(...(content.cells.find((c) => c.id === TARGET)?.hex ?? [0, 0])),
    );
    const route = routeTo(s, content, hex!)!;
    const minutes = route.minutes.reduce((a, b) => a + b, 0);
    const price = Math.max(K.map.travel.min, Math.ceil(K.map.travel.ryoPerMinute * minutes));
    expect(travelPrice(s, TARGET, content, defaultRules)).toBe(price);
    expect(travelPlan(s, TARGET, content).price).toBe(price);
    s.currencies.ryo = price + 3;
    const t0 = s.now;
    ok(s, { type: 'world.travel', cell: TARGET, mode: 'paid' });
    expect(s.currencies.ryo).toBe(3);
    expect(s.now).toBe(t0);
    expect(s.world.location).toBe(TARGET);
    expect(s.slots[0]?.action).toBeNull();
    expect(eventsOf(s, 'paidTravel')).toMatchObject([
      { type: 'paidTravel', hex: keyOfCell(TARGET), price, slot: 0 },
    ]);
    // No walk, so no walking XP.
    expect(s.skills.ath?.xp).toBe(0);
  });

  const keyOfCell = (id: string): string => {
    const c = content.cells.find((x) => x.id === id)!;
    return hexKey(c.hex[0], c.hex[1]);
  };

  it('grows with the distance and with the terrain', () => {
    const s = genin(1);
    const near = travelPrice(s, 'core:polihon_44_lis_smerti', content, defaultRules)!;
    const far = travelPrice(s, TARGET, content, defaultRules)!;
    expect(far).toBeGreaterThan(near);
    // Same number of hexes (two), one route over a forest and one over roads and plains only.
    const forest = routeTo(s, content, { q: 11, r: 15 })!;
    const roads = routeTo(s, content, { q: 11, r: 17 })!;
    expect(forest.hexes).toHaveLength(roads.hexes.length);
    expect(forest.minutes.reduce((a, b) => a + b, 0)).toBeGreaterThan(
      roads.minutes.reduce((a, b) => a + b, 0),
    );
    expect(travelPrice(s, 'core:uzlissia', content, defaultRules)!).toBeGreaterThan(
      travelPrice(s, 'core:rysovi_polia', content, defaultRules)!,
    );
  });

  it('refuses a hex in fog, a purse that is too thin and the hex the performer stands on, and takes nothing', () => {
    const s = genin(1);
    s.currencies.ryo = 1000;
    expect(refusal(s, { type: 'world.travel', cell: 'core:bereh_riky', mode: 'paid' })).toBe(
      'error.cellNotReachable',
    );
    expect(refusal(s, { type: 'world.travel', cell: 'core:okolytsi_sela', mode: 'paid' })).toBe(
      'error.alreadyThere',
    );
    expect(s.currencies.ryo).toBe(1000);
    s.currencies.ryo = 0;
    const r = dispatch(
      s,
      { type: 'world.travel', cell: TARGET, mode: 'paid' },
      content,
      defaultRules,
    );
    expect(r).toMatchObject({ ok: false, reason: 'error.notEnoughRyo' });
    expect(s.world.location).toBe('core:okolytsi_sela');
  });

  it('moves only the performer of the slot that asks', () => {
    const s = genin(1);
    s.slots.push({ action: null, progress: 0, share: 0, data: null });
    s.currencies.ryo = 500;
    ok(s, { type: 'world.travel', cell: TARGET, mode: 'paid', slot: 1 });
    expect(s.world.location).toBe('core:okolytsi_sela');
    expect(s.world.figures?.[1]).toBe(TARGET);
    expect(s.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
  });

  it('is cheaper by the share of the travel.price modifiers (map mastery)', () => {
    const s = genin(1);
    const base = travelPrice(s, TARGET, content, defaultRules)!;
    const cheap: Rules = {
      ...defaultRules,
      modifierProviders: [
        ...defaultRules.modifierProviders,
        () => [{ key: 'travel.price', op: 'add', value: -0.5, group: 'items', source: 'test' }],
      ],
    };
    expect(travelPrice(s, TARGET, content, cheap)!).toBeLessThan(base);
  });
});

// ---------- hidden points, points with a requirement ----------

describe('hidden points and points with a requirement', () => {
  const JOFUKU = 'core:jofuku_forest';

  it('are absent from the hex until a survey level or another find reveals them', () => {
    const s = genin(1);
    const key = keyOfPlace(JOFUKU);
    const cell = cellAt(key)!;
    s.world.surveyed[key] = true;
    const top = (n: number) => K.cellExplores[n - 1] ?? 0;
    s.world.explores[cell] = top(1);
    expect(pointStatus(s, content, placeOf(JOFUKU))).toBe('hidden');
    let info = hexInfo(s, key, content)!;
    expect(info.places).not.toContain(JOFUKU);
    expect(info.points).toEqual([]);
    expect(JSON.stringify(info)).not.toContain('jofuku');
    s.world.explores[cell] = top(2);
    expect(pointStatus(s, content, placeOf(JOFUKU))).toBe('hidden');
    s.world.explores[cell] = top(3);
    expect(pointStatus(s, content, placeOf(JOFUKU))).toBe('open');
    info = hexInfo(s, key, content)!;
    expect(info.places).toContain(JOFUKU);
    expect(info.points).toHaveLength(1);
    expect(info.points[0]).toMatchObject({ place: JOFUKU, status: 'open', reward: null });
  });

  it('are revealed by another find', () => {
    const s = genin(1);
    reveal(s, 'core:fort_cellar');
    expect(pointStatus(s, content, placeOf('core:fort_cellar'))).toBe('hidden');
    s.world.pois['core:war_fort_ruins'] = true;
    expect(pointStatus(s, content, placeOf('core:fort_cellar'))).toBe('open');
  });

  it('a plain hex reveals its hidden point at the survey level that is asked', () => {
    const s = genin(1);
    const key = keyOfPlace('core:wayside_teahouse');
    s.world.surveyed[key] = true;
    s.world.explores[key] = K.map.plainSurvey[0] ?? 0;
    const subject = subjectOf(content, key)!;
    expect(surveyLevel(s, subject, content)).toBe(1);
    expect(pointStatus(s, content, placeOf('core:wayside_teahouse'))).toBe('hidden');
    s.world.explores[key] = K.map.plainSurvey[1] ?? 0;
    expect(pointStatus(s, content, placeOf('core:wayside_teahouse'))).toBe('open');
  });

  it('a point with a requirement shows only a vague hint (and not which place) until it is met', () => {
    const s = genin(1);
    const VALLEY = 'core:valley_of_the_end';
    reveal(s, VALLEY);
    expect(pointStatus(s, content, placeOf(VALLEY))).toBe('veiled');
    const info = hexInfo(s, keyOfPlace(VALLEY), content)!;
    expect(info.places).not.toContain(VALLEY);
    expect(info.points).toEqual([
      {
        place: null,
        status: 'veiled',
        hint: `place.${VALLEY}.hint`,
        power: [],
        travel: null,
        reward: null,
        active: false,
      },
    ]);
    // Standing on it pays nothing ...
    stand(s, VALLEY);
    advance(s, 1 * MIN, content);
    expect(isFound(s, VALLEY)).toBe(false);
    // ... until the requirement is met: the system finds it under the performer's feet at the next event.
    setLevel(s, 'scout', 12);
    ok(s, { type: 'action.start', slot: 0, kind: 'drill', id: content.exercises[0]?.id ?? '' });
    advance(s, 1 * MIN, content);
    expect(isFound(s, VALLEY)).toBe(true);
    expect(s.currencies.intel).toBe(4);
  });

  it('a rank asks for the rank and a currency for the balance', () => {
    const s = genin(1);
    expect(pointStatus(s, content, placeOf('core:mercenary_den'))).toBe('hidden');
    reveal(s, 'core:mercenary_den');
    expect(pointStatus(s, content, placeOf('core:mercenary_den'))).toBe('veiled');
    s.currencies.intel = 5;
    expect(pointStatus(s, content, placeOf('core:mercenary_den'))).toBe('open');
    reveal(s, 'core:fire_temple');
    s.player.rank = 'student';
    expect(pointStatus(s, content, placeOf('core:fire_temple'))).toBe('veiled');
    s.player.rank = 'genin';
    expect(pointStatus(s, content, placeOf('core:fire_temple'))).toBe('open');
  });
});

// ---------- d. actions opened by a place ----------

describe('actions that a place opens', () => {
  it('rare herbs ask for the point of their place', () => {
    const s = genin(1);
    setLevel(s, 'herb', 45);
    setLevel(s, 'cc', 30);
    const start = (id: string): Command => ({ type: 'action.start', slot: 0, kind: 'gather', id });
    for (const [herb, place] of [
      ['core:edelweiss', 'core:jofuku_forest'],
      ['core:lotus', 'core:waterfall_shrine'],
    ] as const) {
      expect(refusal(s, start(herb)), herb).toBe('error.requirementsNotMet');
      s.world.pois[place] = true;
      ok(s, start(herb));
      dispatch(s, { type: 'action.stop', slot: 0 }, content, defaultRules);
    }
  });
});

// ---------- g. map mastery ----------

describe('map mastery', () => {
  /** Surveys `n` playable hexes to their highest level, the way a played game would have left them. */
  function mastered(state: GameState, n: number): void {
    let left = n;
    for (const hex of content.hexes) {
      if (hex.terrain === undefined || left === 0) continue;
      const key = hexKey(hex.q, hex.r);
      const subject = subjectOf(content, key)!;
      const cell = subject.cell;
      state.world.explores[subject.address] = cell
        ? (K.cellExplores[
            (cell.pois.length === 0 ? K.scouting.plainMaxLevel : K.cellExplores.length) - 1
          ] ?? 0)
        : (K.map.plainSurvey[K.map.plainSurvey.length - 1] ?? 0);
      state.world.surveyed[key] = true;
      left--;
    }
    touchWorld(state);
  }

  it('counts the hexes surveyed to their top level and reaches its tiers at 30, 60 and all', () => {
    const s = genin(1);
    const total = content.hexes.filter((h) => h.terrain !== undefined).length;
    expect(mapMastery(s, content).tiers.map((t) => t.need)).toEqual([30, 60, total]);
    expect(mapMastery(s, content).tiers.every((t) => !t.reached)).toBe(true);
    mastered(s, 30);
    expect(mapMastery(s, content).count).toBe(30);
    expect(mapMastery(s, content).tiers.map((t) => t.reached)).toEqual([true, false, false]);
    expect(getMod(s, 'xp.skill.scout', content).total).toBeCloseTo(1.05, 12);
    expect(getMod(s, 'travel.price', content).total).toBe(1);
    mastered(s, 60);
    expect(getMod(s, 'travel.price', content).total).toBeCloseTo(0.9, 12);
    // Athletics level 1 shortens a survey by its own 0.1%: the mastery adds its 5% only at the end.
    const athletics = 1 - S.athPerLevel;
    expect(getMod(s, 'interval.explore', content).total).toBeCloseTo(athletics, 12);
    mastered(s, total);
    expect(mapMastery(s, content).tiers.every((t) => t.reached)).toBe(true);
    expect(getMod(s, 'interval.explore', content).total).toBeCloseTo(athletics - 0.05, 12);
    expect(getMod(s, 'interval.explore', content).parts.map((p) => p.source)).toContain(
      'mod.source.mapMastery',
    );
  });
});

// ---------- h. auto-survey ----------

describe('auto-survey and points', () => {
  it('prefers a hex that holds a point the player knows of', () => {
    const s = genin(1);
    // Everything within sight of the start is surveyed already: no fog to lift first. The point of the
    // start itself is taken away, so that it does not decide.
    setLevel(s, 'scout', 5);
    const bare = content.places.map((p) =>
      p.id === 'core:west_gate_post' ? { ...p, point: undefined } : p,
    );
    const spot: Place = {
      id: 'core:test_spot',
      hex: [10, 17],
      kind: 'camp',
      role: 'landmark',
      point: { reward: { ryo: 1 } },
    };
    // With no point known the nearest hex is chosen: the one underfoot.
    expect(autoPlan(s, withPlaces(bare))?.subject.address).toBe('core:okolytsi_sela');
    // A hex one step away holds a point the player knows of (its hex is surveyed): it goes first.
    expect(autoPlan(s, withPlaces([...bare, spot]))?.subject.address).toBe('10,17');
  });

  it('never lets a hidden point show through the order of the survey', () => {
    // The hidden point of the Jofuku forest: with it and without it the auto-survey chooses the same.
    const bare = withPlaces(
      without('core:jofuku_forest').concat([
        { ...placeOf('core:jofuku_forest'), point: undefined } as Place,
      ]),
    );
    const s = genin(1);
    setLevel(s, 'scout', 30);
    const key = keyOfPlace('core:jofuku_forest');
    s.world.surveyed[key] = true;
    s.world.explores[cellAt(key)!] = K.cellExplores[0] ?? 1;
    touchWorld(s);
    const a = autoPlan(s, content);
    const b = autoPlan(createCopy(s), bare);
    expect(a?.subject.address).toBe(b?.subject.address);
    expect(a?.stand).toBe(b?.stand);
  });
});

function createCopy(state: GameState): GameState {
  return deserialize(serialize(state, 0), content);
}

// ---------- 3. what a walk gives ----------

describe('XP and finds on the road', () => {
  const ctx = (
    terrain: string,
    hex = '10,16',
    by: 'walk' | 'paid' | 'outpost' = 'walk',
    slot = 0,
  ) => ({ hex, q: 10, r: 16, terrain, by, slot }) as const;

  it('pays Athletics and Scouting XP for every hex walked, for the minutes of its terrain', () => {
    const s = genin(1);
    walkHook(s, ctx('road'), content, defaultRules);
    const hours = (K.map.terrain.road?.walkMin ?? 0) / 60;
    expect(s.skills.ath?.xp).toBeCloseTo(rate(K.map.walk.athLevel, content) * hours, 9);
    expect(s.skills.scout?.xp).toBeCloseTo(rate(K.map.walk.scoutLevel, content) * hours, 9);
    // Hills take longer: more XP.
    const h = genin(1);
    walkHook(h, ctx('hills'), content, defaultRules);
    expect(h.skills.ath?.xp).toBeGreaterThan(s.skills.ath?.xp ?? 0);
  });

  it('pays on a real walk, step by step', () => {
    const s = genin(1);
    ok(s, { type: 'world.travel', cell: 'core:rysovi_polia', mode: 'walk', slot: 0 });
    const steps = travelPlan(s, 'core:rysovi_polia', content).hexes.length;
    advance(s, 30 * MIN, content);
    expect(s.world.location).toBe('core:rysovi_polia');
    expect(eventsOf(s, 'hexEntered')).toHaveLength(steps);
    expect(s.skills.ath?.xp).toBeGreaterThan(0);
  });

  it('pays nothing for a trip made at once', () => {
    const s = genin(1);
    walkHook(s, ctx('forest', '8,14', 'paid'), content, defaultRules);
    walkHook(s, ctx('forest', '8,14', 'outpost'), content, defaultRules);
    expect(s.skills.ath?.xp).toBe(0);
    expect(Object.keys(s.bank)).toEqual([]);
  });

  it('finds things of the terrain by chance, the same for the same seed, and only what the terrain holds', () => {
    const run = (seed: number, terrain: string, n: number): GameState => {
      const s = genin(seed);
      for (let i = 0; i < n; i++) walkHook(s, ctx(terrain), content, defaultRules);
      return s;
    };
    const a = run(5, 'forest', 600);
    const b = run(5, 'forest', 600);
    const c = run(6, 'forest', 600);
    expect(a.bank).toEqual(b.bank);
    expect(a.rng.world).toEqual(b.rng.world);
    expect(a.bank).not.toEqual(c.bank);
    const chance = content.terrains.find((t) => t.id === 'forest')?.finds?.chance ?? 0;
    const finds = eventsOf(a, 'wayFound').length;
    expect(finds).toBeGreaterThan(600 * chance * 0.6);
    expect(finds).toBeLessThan(600 * chance * 1.4);
    const allowed = new Set(
      content.terrains.find((t) => t.id === 'forest')?.finds?.drops.map((d) => d.item),
    );
    for (const item of Object.keys(a.bank)) expect(allowed.has(item), item).toBe(true);
    // Another terrain, another drop.
    const river = run(5, 'river', 600);
    expect(Object.keys(river.bank)).toEqual(['core:river_catch']);
    const hills = run(5, 'hills', 600);
    expect(Object.keys(hills.bank)).toContain('core:ore_chunk');
    // A terrain with no finds draws nothing from the world stream.
    const settlement = run(5, 'settlement', 50);
    expect(settlement.bank).toEqual({});
  });
});

describe('rare finds', () => {
  const R: Place = {
    id: 'core:rare_spot',
    hex: [14, 16],
    kind: 'camp',
    role: 'landmark',
    rare: {
      radius: 3,
      chance: 0.8,
      stock: 2,
      restockMs: 2 * HOUR,
      payout: { currencies: { intel: 2 } },
    },
  };
  const c2 = withPlaces([...content.places, R]);
  const at = (q: number, r: number) =>
    ({ hex: hexKey(q, r), q, r, terrain: 'settlement', by: 'walk', slot: 0 }) as const;

  it('fall with the distance from the place and stop at the radius', () => {
    expect(rareChance(R, 0)).toBeCloseTo(0.8, 12);
    expect(rareChance(R, 1)).toBeCloseTo(0.6, 12);
    expect(rareChance(R, 2)).toBeCloseTo(0.4, 12);
    expect(rareChance(R, 3)).toBeCloseTo(0.2, 12);
    expect(rareChance(R, 4)).toBe(0);
  });

  it('are drawn from a limited stock, and the stock is restocked over time, one per period', () => {
    const s = genin(1);
    expect(rareLeft(s, R)).toBe(2);
    const intelOf = () => s.currencies.intel ?? 0;
    // Walk onto the place's own hex until the stock is drawn down; each drop pays Intel.
    for (let i = 0; i < 60 && rareLeft(s, R) > 0; i++) walkHook(s, at(14, 16), c2, defaultRules);
    expect(rareLeft(s, R)).toBe(0);
    expect(intelOf()).toBe(4);
    expect(eventsOf(s, 'wayFound').filter((e) => e.place === R.id)).toHaveLength(2);
    // Nothing is left to find, and nothing is drawn from the world stream by the empty place.
    const rng = JSON.stringify(s.rng.world);
    walkHook(s, at(14, 16), c2, defaultRules);
    expect(intelOf()).toBe(4);
    expect(eventsOf(s, 'wayFound').filter((e) => e.place === R.id)).toHaveLength(2);
    void rng;
    // Restocked one at a time, never above the stock.
    const drawnAt = s.world.stock?.[R.id]?.at ?? 0;
    s.now = drawnAt + 2 * HOUR - 1;
    expect(rareLeft(s, R)).toBe(0);
    s.now = drawnAt + 2 * HOUR;
    expect(rareLeft(s, R)).toBe(1);
    s.now = drawnAt + 100 * HOUR;
    expect(rareLeft(s, R)).toBe(2);
    // A drop drawn from a partly restocked place keeps the periods already counted.
    s.now = drawnAt + 3 * HOUR;
    for (let i = 0; i < 60 && rareLeft(s, R) > 0; i++) walkHook(s, at(14, 16), c2, defaultRules);
    expect(s.world.stock?.[R.id]).toEqual({ left: 0, at: drawnAt + 2 * HOUR });
  });

  it('outside the radius nothing drops', () => {
    const s = genin(1);
    for (let i = 0; i < 200; i++) walkHook(s, at(30, 30), c2, defaultRules);
    expect(s.currencies.intel).toBe(0);
    expect(s.world.stock).toBeUndefined();
  });

  it('keeps their stock in the save', () => {
    const s = genin(1);
    const place = content.places.find((p) => p.rare)!;
    s.world.stock = { [place.id]: { left: 0, at: 1234 } };
    const loaded = deserialize(serialize(s, 0), content);
    expect(loaded.world.stock).toEqual({ [place.id]: { left: 0, at: 1234 } });
    // A doctored entry for a place with no rare find, or with a stock beyond its size, is cut.
    const raw = JSON.parse(serialize(s, 0)) as {
      state: { world: { stock: Record<string, unknown> } };
    };
    raw.state.world.stock = {
      'core:west_gate_post_x': { left: 1, at: 1 },
      [place.id]: { left: 99, at: -5 },
    };
    const cut = deserialize(JSON.stringify(raw), content);
    expect(cut.world.stock).toEqual({ [place.id]: { left: place.rare?.stock, at: 0 } });
  });
});

// ---------- the clone that stands ----------

describe('a clone that arrives stays', () => {
  it('stands in its slot where it arrived, keeps its share of the speed, and goes when dispelled', () => {
    const s = genin(1);
    s.known['core:shadow_clone'] = true;
    s.slots.push({ action: null, progress: 0, share: 0, data: null });
    ok(s, { type: 'action.start', slot: 0, kind: 'drill', id: content.exercises[0]?.id ?? '' });
    ok(s, { type: 'world.travel', cell: 'core:rysovi_polia', mode: 'walk', slot: 1 });
    advance(s, 30 * MIN, content);
    expect(s.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
    expect(s.world.figures?.[1]).toBe('core:rysovi_polia');
    // The standing clone slows the character as every clone does: two slots share the pool.
    expect(s.slots[0]?.share).toBeLessThan(1000);
    expect(s.slots[1]?.share).toBe(s.slots[0]?.share);
    advance(s, 5 * HOUR, content);
    expect(s.world.figures?.[1]).toBe('core:rysovi_polia');
    // Given another action it stays where it is and surveys from there.
    ok(s, { type: 'action.start', slot: 1, kind: 'explore', id: 'core:rysovi_polia' });
    expect(s.world.figures?.[1]).toBe('core:rysovi_polia');
    ok(s, { type: 'clone.dispel' });
    expect(s.world.figures).toBeUndefined();
    expect(s.slots[0]?.share).toBe(1000);
  });

  it('keeps the standing clone through a save', () => {
    const s = genin(1);
    cloneAt(s, TG44);
    const loaded = deserialize(serialize(s, 0), content);
    expect(loaded.slots[1]?.action).toEqual({ kind: 'stand', id: 'here' });
    expect(loaded.world.figures?.[1]).toBe(TG44_CELL);
  });
});

describe('the hexEntered hook cannot move a performer', () => {
  it('puts the position and the clock back after a handler that moved them', () => {
    const rogue = (state: GameState): void => {
      state.world.location = 'core:uzlissia';
      state.world.figures = { 1: 'core:uzlissia' };
      state.now += 5;
    };
    const rules: Rules = { ...defaultRules, hexEntered: [rogue] };
    const s = genin(1);
    ok(
      s,
      { type: 'world.travel', cell: 'core:polihon_44_lis_smerti', mode: 'walk', slot: 0 },
      content,
      rules,
    );
    advance(s, 10 * MIN, content, rules);
    expect(s.world.location).toBe('core:polihon_44_lis_smerti');
    expect(s.world.figures).toBeUndefined();
    expect(s.now).toBe(10 * MIN);
  });
});

// ---------- determinism ----------

describe('determinism and split invariance while walking', () => {
  function scenario(): GameState {
    const s = genin(3);
    setLevel(s, 'scout', 20);
    s.currencies.ryo = 100;
    s.slots.push({ action: null, progress: 0, share: 0, data: null });
    ok(s, { type: 'world.travel', cell: 'core:prykordonnyi_lis_okolytsia', mode: 'walk', slot: 0 });
    ok(s, { type: 'world.travel', cell: 'core:rysovi_polia', mode: 'walk', slot: 1 });
    return s;
  }

  it('gives the same state however the time is cut, finds, XP and points included', () => {
    const total = 80 * MIN;
    const whole = scenario();
    advance(whole, total, content);
    expect(whole.skills.ath?.xp).toBeGreaterThan(0);
    for (const chunk of [999, 12_345, 59_999]) {
      const parts = scenario();
      for (let done = 0; done < total; done += chunk)
        advance(parts, Math.min(chunk, total - done), content);
      expect(serialize(parts), `chunk ${chunk}`).toBe(serialize(whole));
    }
  });

  it('repeats exactly for the same seed, and differs for another', () => {
    const a = scenario();
    const b = scenario();
    advance(a, 80 * MIN, content);
    advance(b, 80 * MIN, content);
    expect(serialize(a)).toBe(serialize(b));
    const c = genin(4);
    expect(serialize(c)).not.toBe(serialize(genin(3)));
  });

  it('a point is found and paid at the same moment however the time is cut', () => {
    const make = (): GameState => {
      const s = genin(1);
      reveal(s, TG44);
      ok(s, { type: 'world.travel', cell: TG44_CELL, mode: 'walk', slot: 0 });
      return s;
    };
    const whole = make();
    advance(whole, 10 * MIN, content);
    const parts = make();
    for (let i = 0; i < 600; i++) advance(parts, 1000, content);
    expect(serialize(parts)).toBe(serialize(whole));
    expect(whole.skills.tai?.xp).toBe(40);
  });
});

// ---------- a pack adds its own points ----------

describe('a pack that adds its own point kind as data', () => {
  const BEACON = 'testmod:isle_beacon';
  const WATCH = 'testmod:isle_watch';

  it('has its places in the composed content, with the pack as the owner of their data', () => {
    expect(placeOf(BEACON, modContent).point?.travel).toBe('testmod:beacons');
    expect(placeOf(WATCH, modContent).point?.reward).toEqual({ ryo: 7 });
  });

  it('pays its reward once, gives a bonus of a key the pack declares, and joins its own travel group', () => {
    const s = modGenin(1);
    const beaconKey = keyOfPlace(BEACON, modContent);
    const watchKey = keyOfPlace(WATCH, modContent);
    for (const key of [beaconKey, watchKey]) s.world.surveyed[key] = true;
    s.world.explores['testmod:grove_edge'] = K.cellExplores[0] ?? 1;
    s.world.explores[watchKey] = K.map.plainSurvey[0] ?? 1;
    touchWorld(s);
    // The character steps on the beacon: found, paid in the pack's own currency.
    s.world.location = 'testmod:grove_edge';
    settlePoints(s, modContent, modRules);
    expect(isFound(s, BEACON)).toBe(true);
    expect(s.currencies['testmod:token']).toBe(2);
    settlePoints(s, modContent, modRules);
    expect(s.currencies['testmod:token']).toBe(2);
    expect(getMod(s, 'testmod:forge.bonus', modContent, modRules).total).toBeCloseTo(1.1, 12);
    s.world.location = 'core:okolytsi_sela';
    expect(getMod(s, 'testmod:forge.bonus', modContent, modRules).total).toBe(1);
    // The second place of the pack is found by stepping on it; the two make a travel group.
    s.world.location = 'testmod:grove_edge';
    s.world.pois[WATCH] = true;
    expect(outpostTargets(s, modContent).map((p) => p.id)).toEqual([WATCH]);
    const r = dispatch(
      s,
      { type: 'world.travel', cell: watchKey, mode: 'outpost' },
      modContent,
      modRules,
    );
    expect(r).toEqual({ ok: true });
    expect(s.world.location).toBe(watchKey);
  });

  it('the core game does not see the pack places', () => {
    const s = genin(1);
    expect(content.places.some((p) => p.id.startsWith('testmod:'))).toBe(false);
    expect(performers(s, content)).toHaveLength(1);
  });
});

describe('the list of hexes shows the points the player knows', () => {
  it('lists a found point with what it gives, and a veiled one without its place', () => {
    const s = genin(1);
    s.world.pois[TG44] = true;
    reveal(s, TG44);
    stand(s, TG44);
    const list = listHexes(s, content, defaultRules, 0, 'playable');
    const here = list.find((h) => h.here)!;
    expect(here.points).toEqual([
      {
        place: TG44,
        status: 'found',
        hint: null,
        power: [{ key: 'xp.skill.tai', op: 'add', value: 0.05 }],
        travel: null,
        reward: { xp: { skill: 'tai', amount: 40 } },
        active: true,
      },
    ]);
    expect(worldRevision(s)).toBeGreaterThan(0);
  });
});
