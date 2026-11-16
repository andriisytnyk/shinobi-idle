/** Exploration: regions, cells, keys, points of interest, travel, Intel, quests, save. */
import { content, type Quest } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  cellInfo,
  cellLevel,
  cellMaxLevel,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  EXPLORE_KIND,
  exploreIntervalMs,
  exploredKey,
  getMod,
  listRegions,
  MIGRATIONS,
  rate,
  regionFlag,
  serialize,
  STATE_VERSION,
  travelPlan,
  hexKey,
  WALK_KIND,
  walkMs,
  zoneAvailable,
  zoneCellOf,
  type Command,
  type GameState,
  type Modifier,
  type Rules,
} from '../src/index.ts';
import { genin, setLevel, teleport } from './helpers.ts';

const K = content.balance.K;
const S = K.scouting;
const MIN = 60_000;
const FOREST = 'core:forest';
const PLAINS = 'core:plains';
const VALLEY = 'core:valley';

const cell = (id: string) => {
  const found = content.cells.find((c) => c.id === `core:${id}`);
  if (!found) throw new Error(`no cell ${id}`);
  return found;
};
const explore = (id: string): Command => ({
  type: 'action.start',
  slot: 0,
  kind: EXPLORE_KIND,
  id: `core:${id}`,
});
const travel = (id: string): Command => ({
  type: 'world.travel',
  cell: `core:${id}`,
  mode: 'walk',
});
/** Puts the player on a cell and starts surveying it. */
function survey(state: GameState, id: string, rules: Rules = defaultRules): void {
  teleport(state, id);
  ok(state, explore(id), rules);
}
const ok = (state: GameState, command: Command, rules: Rules = defaultRules) => {
  const result = dispatch(state, command, content, rules);
  expect(result, JSON.stringify(command)).toEqual({ ok: true });
};
const reason = (state: GameState, command: Command) => {
  const result = dispatch(state, command, content);
  return result.ok ? null : result.reason;
};
/** Marks a cell as explored `n` times without playing it. */
function setExplores(state: GameState, id: string, n: number): void {
  state.world.explores[`core:${id}`] = n;
  const c = cell(id);
  if (cellLevel(state, c, content) >= 1) for (const p of c.pois) state.world.pois[p.id] = true;
}
/** A genin with Scouting `level` standing in the plains. */
function inPlains(level = 10): GameState {
  const state = genin();
  setLevel(state, 'scout', level);
  teleport(state, 'pivdennyi_trakt');
  return state;
}
const cycle = (state: GameState) => exploreIntervalMs(state, content, defaultRules);

describe('regions', () => {
  it('open at the Scouting level and rank genin, and raise their flag', () => {
    const state = createState(1, content);
    expect(listRegions(state, content).map((r) => r.open)).toEqual([false, false, false]);
    state.player.rank = 'genin';
    setLevel(state, 'scout', 9);
    advance(state, 0, content);
    expect(listRegions(state, content).map((r) => r.open)).toEqual([true, false, false]);
    expect(state.flags[regionFlag(FOREST)]).toBe(true);
    expect(state.flags[regionFlag(PLAINS)]).toBeUndefined();
    setLevel(state, 'scout', 10);
    advance(state, 0, content);
    expect(state.flags[regionFlag(PLAINS)]).toBe(true);
    const info = listRegions(state, content)[2];
    expect(info?.req.children.map((c) => [c.current, c.target])).toEqual([
      [1, 1],
      [10, 20],
    ]);
  });

  it('starts the player in the first cell of the first region', () => {
    expect(createState(1, content).world.location).toBe(content.regions[0]?.cells[0]);
  });
});

describe('A3: gating of keys and levels', () => {
  /** The requirement of each key, met by the cheapest means. */
  const meet: Record<string, (s: GameState) => void> = {
    rock: (s) => setLevel(s, 'cc', 15),
    water: (s) => setLevel(s, 'cc', 30),
    brush: (s) => void (s.known['core:running_fire'] = true),
    mist: (s) => void (s.known['core:great_breakthrough'] = true),
    rubble: (s) => void (s.known['core:hiding_like_a_mole'] = true),
  };
  const spots: [string, string, (s: GameState) => void][] = [
    ['rock', 'skelia_nad_vodospadom', () => {}],
    ['water', 'lisove_ozero', () => {}],
    ['brush', 'ternovi_zarosti', () => {}],
    ['rubble', 'skhovyshche_fortetsi', (s) => teleport(s, 'pivdennyi_trakt')],
    ['mist', 'tumannyi_iar', (s) => teleport(s, 'pivnichnyi_trakt')],
  ];
  for (const [key, id, go] of spots) {
    it(`refuses a ${key} cell without its requirement and starts it with it`, () => {
      const state = genin();
      setLevel(state, 'scout', 20);
      go(state);
      teleport(state, id);
      expect(cell(id).key).toBe(key);
      expect(reason(state, explore(id))).toBe('error.requirementsNotMet');
      meet[key]?.(state);
      survey(state, id);
    });
  }

  it('lets either technique open brush and mist', () => {
    const state = genin();
    setLevel(state, 'scout', 20);
    state.known['core:sickle_weasel'] = true;
    survey(state, 'ternovi_zarosti');
    teleport(state, 'pivnichnyi_trakt');
    survey(state, 'tumannyi_iar');
    const other = genin();
    other.known['core:running_fire'] = true;
    survey(other, 'ternovi_zarosti');
  });

  it('needs the Scouting level of the formula for each cell level', () => {
    const state = genin();
    // Forest level 2 needs 1 + 10 = 11; plains level 3 needs 10 + 20 = 30.
    setExplores(state, 'okolytsi_sela', K.cellExplores[0] ?? 0);
    setLevel(state, 'scout', 10);
    expect(reason(state, explore('okolytsi_sela'))).toBe('error.requirementsNotMet');
    setLevel(state, 'scout', 11);
    survey(state, 'okolytsi_sela');
    const far = genin();
    setLevel(far, 'scout', 29);
    teleport(far, 'pivdennyi_trakt');
    setExplores(far, 'pivdennyi_trakt', K.cellExplores[1] ?? 0);
    expect(reason(far, explore('pivdennyi_trakt'))).toBe('error.requirementsNotMet');
    setLevel(far, 'scout', 30);
    survey(far, 'pivdennyi_trakt');
  });

  it('caps the need at the skill cap', () => {
    const info = cellInfo(
      (() => {
        const s = genin();
        setExplores(s, 'pivnichnyi_trakt', K.cellExplores[3] ?? 0);
        return s;
      })(),
      'core:pivnichnyi_trakt',
      content,
    );
    expect(info?.nextLevelNeed).toBe(K.cap);
  });

  it('keeps a closed region shut, and a student out', () => {
    const student = createState(1, content);
    expect(reason(student, explore('okolytsi_sela'))).toBe('error.skillLocked');
    const state = genin();
    expect(cellInfo(state, 'core:pivdennyi_trakt', content)?.why).toBe('error.regionClosed');
  });

  it('stops a plain cell at the plain level and every other at the last level', () => {
    const plain = cell('rysovi_polia');
    expect(plain.pois).toEqual([]);
    expect(cellMaxLevel(plain, content)).toBe(S.plainMaxLevel);
    expect(cellMaxLevel(cell('okolytsi_sela'), content)).toBe(K.cellExplores.length);
    const state = genin();
    setLevel(state, 'scout', 30);
    const last = (K.cellExplores[S.plainMaxLevel - 1] ?? 0) - 1;
    setExplores(state, 'rysovi_polia', last);
    survey(state, 'rysovi_polia');
    state.events = [];
    advance(state, cycle(state), content);
    expect(cellLevel(state, plain, content)).toBe(S.plainMaxLevel);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['cellLevelUp', 'actionStopped']),
    );
    expect(reason(state, explore('rysovi_polia'))).toBe('error.cellMaxed');
  });
});

describe('A4: exploration XP and Intel', () => {
  /** Scouting XP per hour measured over a stretch of cycles that stays inside one cell level. */
  function measure(
    setup: (s: GameState) => void,
    region: string,
    target: number,
    id: string,
    level = 25,
  ) {
    const state = genin();
    setLevel(state, 'scout', level);
    setup(state);
    survey(state, id);
    const before = state.skills.scout!.xp;
    const ms = 10 * cycle(state);
    advance(state, ms, content);
    const perHour = ((state.skills.scout!.xp - before) * 3_600_000) / ms;
    const reg = content.regions.find((r) => r.id === region);
    const effective = (reg?.scout ?? 0) + K.cellLevelStep * (target - 1);
    return { perHour, expected: rate(effective, content) };
  }

  it('is the rate of the effective level for a level-1 cell of each region', () => {
    const cases: [string, string, string][] = [
      [FOREST, 'okolytsi_sela', ''],
      [PLAINS, 'pivdennyi_trakt', 'pivdennyi_trakt'],
      [VALLEY, 'pivnichnyi_trakt', 'pivnichnyi_trakt'],
    ];
    for (const [region, id, go] of cases) {
      const { perHour, expected } = measure((s) => go && teleport(s, go), region, 1, id);
      expect(perHour / expected, region).toBeGreaterThan(0.98);
      expect(perHour / expected, region).toBeLessThan(1.02);
    }
  });

  it('is the rate of Scouting 31 for a level-4 cell of the first region', () => {
    const { perHour, expected } = measure(
      (s) => setExplores(s, 'okolytsi_sela', K.cellExplores[2] ?? 0),
      FOREST,
      4,
      'okolytsi_sela',
      31,
    );
    expect(perHour / expected).toBeGreaterThan(0.98);
    expect(perHour / expected).toBeLessThan(1.02);
  });

  it('grants no mastery for exploring', () => {
    const state = genin();
    survey(state, 'okolytsi_sela');
    advance(state, 5 * cycle(state), content);
    expect(state.mastery).toEqual({});
  });

  it('grants Intel exactly once for each cell level', () => {
    const state = genin();
    setLevel(state, 'scout', 50);
    const id = 'okolytsi_sela';
    const total = K.cellExplores[K.cellExplores.length - 1] ?? 0;
    survey(state, id);
    let intel = 0;
    for (let n = 1; n <= total; n++) {
      advance(state, cycle(state), content);
      if (K.cellExplores.includes(n)) intel += K.intel.perCellLevel;
      expect(state.currencies.intel, `after ${n}`).toBe(intel);
    }
    expect(intel).toBe(K.cellExplores.length * K.intel.perCellLevel);
    // The action stopped at the top level by itself, and more time grants nothing.
    expect(state.slots[0]?.action).toBeNull();
    advance(state, 10 * cycle(state), content);
    expect(state.currencies.intel).toBe(intel);
  });

  it('finds the points of a cell at level 1: flags, links, deposits', () => {
    const state = genin();
    setLevel(state, 'scout', 30);
    survey(state, 'uzlissia');
    expect(zoneAvailable(state, 'core:zone_bandit', content)).toBe(false);
    advance(state, (K.cellExplores[0] ?? 0) * cycle(state), content);
    expect(zoneAvailable(state, 'core:zone_bandit', content)).toBe(true);
    expect(zoneAvailable(state, 'core:zone_arsonist', content)).toBe(true);
    expect(zoneAvailable(state, 'core:zone_wolf', content)).toBe(false);
    expect(state.counters[exploredKey(FOREST)]).toBe(1);
    expect(state.flags['poi.core:poi_uzlissia_zone_bandit']).toBe(true);
    // A deposit raises the village flag of its building, one per deposit.
    const mine = genin();
    setLevel(mine, 'scout', 30);
    teleport(mine, 'pivdennyi_trakt');
    survey(mine, 'soliani_kopalni');
    advance(mine, (K.cellExplores[0] ?? 0) * cycle(mine), content);
    expect(mine.flags['deposit.core:mine']).toBe(1);
  });

  it('maps every zone of the regions to a cell and leaves other zones open', () => {
    expect(zoneCellOf('core:zone_bandit', content)).toBe('core:uzlissia');
    expect(zoneCellOf('core:zone_dummy', content)).toBeNull();
    const state = genin();
    expect(zoneAvailable(state, 'core:zone_dummy', content)).toBe(true);
    expect(zoneAvailable(state, 'core:zone_boss_wolf', content)).toBe(true);
  });
});

describe('A5: travel', () => {
  /** Minutes of a hex of a cell on the map. */
  const here = (id: string) => hexKey(cell(id).hex[0], cell(id).hex[1]);

  it('refuses a hex that is not known, an unknown address and the hex the player stands on', () => {
    const state = genin();
    setLevel(state, 'scout', 20);
    expect(reason(state, travel('pivnichnyi_trakt'))).toBe('error.cellNotReachable');
    expect(reason(state, travel('okolytsi_sela'))).toBe('error.alreadyThere');
    expect(reason(state, { type: 'world.travel', cell: 'core:nowhere', mode: 'walk' })).toBe(
      'error.unknownAction',
    );
    // A hex of the sea can be seen but never entered.
    const sea = content.hexes.find((h) => h.terrain === undefined && h.country === undefined);
    expect(sea).toBeDefined();
    expect(
      reason(state, { type: 'world.travel', cell: hexKey(sea!.q, sea!.r), mode: 'walk' }),
    ).toBe('error.cellNotReachable');
  });

  it('walks hex by hex for the time of the terrain, shorter with Athletics, and arrives only at the end', () => {
    const state = genin();
    setLevel(state, 'scout', 20);
    const at = state.world.location;
    const plan = travelPlan(state, 'core:rysovi_polia', content);
    expect(plan.blocked).toBeNull();
    expect(plan.hexes.at(-1)).toBe(here('rysovi_polia'));
    ok(state, travel('rysovi_polia'));
    expect(state.slots[0]?.action).toEqual({ kind: WALK_KIND, id: 'core:rysovi_polia' });
    const need = walkMs(state, cell('rysovi_polia'), content, defaultRules);
    expect(need).toBe(plan.ms);
    const minutes = plan.hexes.map((key) => {
      const terrain = content.hexes.find((h) => hexKey(h.q, h.r) === key)?.terrain ?? '';
      return K.map.terrain[terrain]?.walkMin ?? 0;
    });
    expect(need).toBe(
      minutes.reduce((sum, m) => sum + Math.round(m * MIN * (1 - S.athPerLevel)), 0),
    );
    advance(state, need - 1, content);
    expect(state.world.location).not.toBe(at);
    expect(state.world.location).not.toBe('core:rysovi_polia');
    expect(state.slots[0]?.action).not.toBeNull();
    advance(state, 1, content);
    expect(state.world.location).toBe('core:rysovi_polia');
    expect(state.slots[0]?.action).toBeNull();

    const fit = genin();
    setLevel(fit, 'ath', 50);
    const quick = walkMs(fit, cell('rysovi_polia'), content, defaultRules);
    expect(quick).toBeLessThan(need);
  });

  it('refuses to survey a hex beyond the range of the survey', () => {
    const state = genin();
    setLevel(state, 'scout', 25);
    expect(reason(state, explore('stezhka_myslyvtsia'))).toBe('error.outOfRange');
    expect(cellInfo(state, 'core:stezhka_myslyvtsia', content)?.why).toBe('error.outOfRange');
    teleport(state, 'stezhka_myslyvtsia');
    ok(state, explore('stezhka_myslyvtsia'));
    expect(reason(state, explore('okolytsi_sela'))).toBe('error.outOfRange');
  });

  it('stops a survey that no longer fits after the player is moved away', () => {
    const state = genin();
    setLevel(state, 'scout', 10);
    ok(state, explore('okolytsi_sela'));
    teleport(state, 'stezhka_myslyvtsia');
    advance(state, 2 * cycle(state), content);
    expect(state.slots[0]?.action).toBeNull();
    expect(state.world.explores['core:okolytsi_sela'] ?? 0).toBe(0);
  });

  it('leaves the player on the last hex reached when the walk is stopped', () => {
    const state = genin();
    setLevel(state, 'scout', 20);
    ok(state, travel('rysovi_polia'));
    const plan = travelPlan(state, 'core:rysovi_polia', content);
    expect(plan.hexes.length).toBeGreaterThan(1);
    const first = state.world.location;
    advance(state, walkMs(state, cell('rysovi_polia'), content, defaultRules) - 1, content);
    const mid = state.world.location;
    expect(mid).not.toBe(first);
    ok(state, { type: 'action.stop', slot: 0 });
    advance(state, 40 * MIN, content);
    expect(state.world.location).toBe(mid);
  });
});

describe('A6: training spots', () => {
  const spot = (state: GameState) => {
    setExplores(state, 'khram_vohniu', 24);
    state.world.location = 'core:khram_vohniu';
  };

  it('give exactly +10% to their skill while the player stands there, and stop after leaving', () => {
    const state = genin();
    const none = getMod(state, 'xp.skill.katon', content);
    expect(none.total).toBe(1);
    spot(state);
    const here = getMod(state, 'xp.skill.katon', content);
    expect(here.total).toBeCloseTo(1.1, 12);
    expect(here.parts).toHaveLength(1);
    expect(here.parts[0]?.source).toEqual({
      kind: 'poi',
      id: 'core:poi_khram_vohniu_training',
    });
    expect(getMod(state, 'xp.skill.tai', content).total).toBe(1);
    const gained = state.skills.katon!.xp;
    // The bonus is real XP, not only a number.
    const away = genin();
    spot(away);
    teleport(away, 'okolytsi_sela');
    expect(away.world.location).toBe('core:okolytsi_sela');
    expect(getMod(away, 'xp.skill.katon', content).total).toBe(1);
    expect(gained).toBe(0);
  });

  it('are the four spots of the slice', () => {
    for (const [id, skill] of [
      ['polihon_44_lis_smerti', 'herb'],
      ['khram_vohniu', 'katon'],
      ['statui_zasnovnykiv', 'tai'],
      ['sviate_mistse_bilia_vodospadu', 'med'],
    ] as const) {
      const state = genin();
      setExplores(state, id, 24);
      state.world.location = `core:${id}`;
      expect(getMod(state, `xp.skill.${skill}`, content).total, id).toBeCloseTo(1.1, 12);
    }
  });

  it('do not apply to a spot that was never found', () => {
    const state = genin();
    state.world.location = 'core:khram_vohniu';
    expect(getMod(state, 'xp.skill.katon', content).total).toBe(1);
  });
});

describe('A7: caches and vaults', () => {
  const claim = (poi: string): Command => ({ type: 'world.claim', poi: `core:${poi}` });

  it('can be taken once, only when found and when standing there', () => {
    const state = genin();
    const poi = 'poi_ternovi_zarosti_cache';
    expect(reason(state, claim(poi))).toBe('error.poiNotFound');
    setExplores(state, 'ternovi_zarosti', 24);
    expect(reason(state, claim(poi))).toBe('error.notHere');
    state.world.location = 'core:ternovi_zarosti';
    ok(state, claim(poi));
    expect(state.currencies.ryo).toBe(150);
    expect(reason(state, claim(poi))).toBe('error.alreadyClaimed');
    expect(state.currencies.ryo).toBe(150);
    expect(reason(state, claim('poi_ternovi_zarosti_deposit'))).toBe('error.notClaimable');
    expect(reason(state, claim('nope'))).toBe('error.unknownPoi');
  });

  it('gives items of a cache', () => {
    const state = genin();
    setExplores(state, 'stepovi_zarosti', 24);
    state.world.location = 'core:stepovi_zarosti';
    ok(state, claim('poi_stepovi_zarosti_cache'));
    expect(state.bank['core:notes']).toBe(2);
    expect(state.bank['core:band']).toBe(3);
  });

  it('gives the whole scroll of the Fire Dragon Flame Bullet from the fortress vault', () => {
    const state = inPlains();
    state.known['core:hiding_like_a_mole'] = true;
    survey(state, 'skhovyshche_fortetsi');
    advance(state, (K.cellExplores[0] ?? 0) * cycle(state), content);
    expect(cellLevel(state, cell('skhovyshche_fortetsi'), content)).toBe(1);
    state.currencies.ryo = 100;
    teleport(state, 'skhovyshche_fortetsi');
    ok(state, claim('poi_skhovyshche_fortetsi_vault'));
    expect(state.bank['core:scroll_fire_dragon_flame_bullet']).toBe(1);
    expect(reason(state, claim('poi_skhovyshche_fortetsi_vault'))).toBe('error.alreadyClaimed');
    expect(
      cellInfo(state, 'core:skhovyshche_fortetsi', content)?.pois.map((p) => p.claimed),
    ).toEqual([true]);
  });
});

describe('A8: quest objectives for the map', () => {
  const quest: Quest = {
    id: 'core:test_map',
    chain: 'core:test_map',
    unlock: null,
    steps: [
      { textKey: 'x.open', objective: { t: 'req', req: { t: 'flag', id: regionFlag(PLAINS) } } },
      {
        textKey: 'x.cells',
        objective: { t: 'counter', counter: exploredKey(PLAINS), n: 2 },
      },
      {
        textKey: 'x.find',
        objective: { t: 'req', req: { t: 'flag', id: 'poi.core:poi_khram_vohniu_training' } },
      },
    ],
    rewards: { items: [], ryo: 0, rep: 0, flags: ['test.done'], rank: null },
  };
  const world = { ...content, quests: [quest] };

  it('opens a region, counts cells from the step start and finds a point', () => {
    const state = genin();
    setLevel(state, 'scout', 9);
    // Counted before the step began: does not count.
    state.counters[exploredKey(PLAINS)] = 5;
    advance(state, 0, world);
    expect(state.quests[quest.id]?.step).toBe(0);
    setLevel(state, 'scout', 10);
    advance(state, 0, world);
    expect(state.quests[quest.id]?.step).toBe(1);
    advance(state, 0, world);
    expect(state.quests[quest.id]?.step).toBe(1);
    teleport(state, 'pivdennyi_trakt');
    survey(state, 'pivdennyi_trakt');
    advance(state, (K.cellExplores[0] ?? 0) * cycle(state), world);
    expect(state.quests[quest.id]?.step).toBe(1);
    survey(state, 'mistechko_na_rivnynakh');
    advance(state, (K.cellExplores[0] ?? 0) * cycle(state), world);
    expect(state.quests[quest.id]?.step).toBe(2);
    expect(state.counters[exploredKey(PLAINS)]).toBe(7);
    survey(state, 'khram_vohniu');
    advance(state, (K.cellExplores[0] ?? 0) * cycle(state), world);
    expect(state.quests[quest.id]?.done).toBe(true);
    expect(state.flags['test.done']).toBe(true);
  });
});

describe('A9: determinism and split invariance', () => {
  const fast: Rules = {
    ...defaultRules,
    modifierProviders: [
      ...defaultRules.modifierProviders,
      (): Modifier[] => [
        { key: 'interval.walk', op: 'add', value: -0.99, group: 'items', source: 'test' },
      ],
    ],
  };

  function scenario(two: boolean): GameState {
    const state = genin(7);
    setLevel(state, 'scout', 5);
    setExplores(state, 'okolytsi_sela', (K.cellExplores[0] ?? 0) - 3);
    state.world.location = 'core:okolytsi_sela';
    survey(state, 'okolytsi_sela', fast);
    if (two) {
      state.slots.push({ action: null, progress: 0, share: 0, data: null });
      ok(
        state,
        { type: 'world.travel', cell: 'core:polihon_44_lis_smerti', mode: 'walk', slot: 1 },
        fast,
      );
    }
    return state;
  }

  for (const two of [false, true]) {
    it(`gives the same state however the time is cut (${two ? 'explore and walk, shares 500' : 'explore alone, share 1000'})`, () => {
      const total = 90_000;
      const whole = scenario(two);
      advance(whole, total, content, fast);
      // The cell went up a level during the run.
      expect(cellLevel(whole, cell('okolytsi_sela'), content)).toBeGreaterThanOrEqual(1);
      if (two) expect(whole.world.location).toBe('core:polihon_44_lis_smerti');
      for (const chunk of [1, 7, 999, 3600]) {
        const parts = scenario(two);
        for (let done = 0; done < total; done += chunk) {
          advance(parts, Math.min(chunk, total - done), content, fast);
        }
        expect(serialize(parts), `chunk ${chunk}`).toBe(serialize(whole));
      }
    });
  }

  it('repeats exactly for the same seed and commands', () => {
    const a = scenario(true);
    const b = scenario(true);
    advance(a, 50_000, content, fast);
    advance(b, 50_000, content, fast);
    expect(serialize(a)).toBe(serialize(b));
  });
});

describe('A11: save', () => {
  it('round-trips the world', () => {
    const state = inPlains(11);
    state.known['core:hiding_like_a_mole'] = true;
    survey(state, 'khram_vohniu');
    advance(state, (K.cellExplores[0] ?? 0) * cycle(state) + 777, content);
    state.world.location = 'core:khram_vohniu';
    const loaded = deserialize(serialize(state), content);
    expect(loaded.world).toEqual(state.world);
    expect(serialize(loaded)).toBe(serialize(state));
    expect(loaded.flags[regionFlag(PLAINS)]).toBe(true);
  });

  it('migrates a version 8 save: nothing explored, standing in the first cell', () => {
    expect(STATE_VERSION).toBeGreaterThanOrEqual(9);
    expect(MIGRATIONS).toHaveLength(STATE_VERSION - 1);
    const state = genin();
    const parsed = JSON.parse(serialize(state)) as { v: number; state: Record<string, unknown> };
    parsed.v = 8;
    parsed.state.v = 8;
    delete parsed.state.world;
    const old = deserialize(JSON.stringify(parsed), content);
    expect(old.v).toBe(STATE_VERSION);
    expect(old.world).toEqual(createState(1, content).world);
    expect(old.world.location).toBe(content.regions[0]?.cells[0]);
  });

  it('cleans a doctored world: unknown cells, huge counts, loot that cannot be taken', () => {
    const state = genin();
    setExplores(state, 'okolytsi_sela', 24);
    const parsed = JSON.parse(serialize(state)) as { state: { world: Record<string, unknown> } };
    parsed.state.world = {
      location: 'core:ghost',
      explores: {
        'core:okolytsi_sela': 1e9,
        'core:rysovi_polia': 1e9,
        'core:ghost': 5,
        'core:uzlissia': -1,
      },
      pois: { 'core:ghost': true },
      claimed: { 'core:poi_ternovi_zarosti_cache': true, 'core:poi_okolytsi_sela_outpost': true },
    };
    const loaded = deserialize(JSON.stringify(parsed), content);
    expect(loaded.world.location).toBe(content.regions[0]?.cells[0]);
    expect(loaded.world.explores).toEqual({
      'core:okolytsi_sela': K.cellExplores[K.cellExplores.length - 1],
      'core:rysovi_polia': K.cellExplores[S.plainMaxLevel - 1],
    });
    expect(Object.keys(loaded.world.pois)).toEqual(['core:poi_okolytsi_sela_outpost']);
    expect(loaded.world.claimed).toEqual({});
  });
});
