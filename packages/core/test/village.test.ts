/** The village: tick, production, storage, treasury, construction, stage, bonuses, shop gating, saves. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  STATE_VERSION,
  addShinobiResource,
  advance,
  advanceOffline,
  createState,
  deserialize,
  dispatch,
  getMod,
  serialize,
  shopPrice,
  villageBuildings,
  villageQueue,
  villageResources,
  villageStage,
  type Command,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, setLevel, withBuildings } from './helpers.ts';
import { bestOf, speedBudget } from './speed.ts';

const K = content.balance.K;
const TICK = K.tickMin * 60_000;
const id = (slug: string) => `core:${slug}`;
const ok = (s: GameState, c: Command) => expect(dispatch(s, c, content)).toEqual({ ok: true });
const refused = (s: GameState, c: Command, reason: string) =>
  expect(dispatch(s, c, content)).toEqual({ ok: false, reason });
const v = (s: GameState) => {
  if (!s.village) throw new Error('no village');
  return s.village;
};
/** A genin with a full store of everything. */
function rich(): GameState {
  const s = genin();
  const village = v(s);
  for (const key of Object.keys(village.res)) village.res[key] = 1e6;
  village.treasury = 1e6;
  return s;
}
const MIGRATION_BASE = 11;

describe('A2: the tick', () => {
  it('gives a student nothing and a Genin the starting buildings', () => {
    const student = createState(1, content);
    advance(student, 12 * HOUR, content);
    expect(student.village).toBeNull();
    const s = genin();
    expect(v(s).levels).toEqual({
      'core:tower': 1,
      'core:bureau': 1,
      'core:store': 1,
      'core:sawmill': 1,
      'core:mine': 1,
      'core:farms': 1,
      'core:market': 1,
    });
  });

  it('produces prod x level of each resource, treasury income and nothing before the first tick', () => {
    const s = genin();
    advance(s, TICK - 1, content);
    expect(v(s).res.wood).toBe(0);
    advance(s, 1, content);
    // Sawmill 1 -> wood; Mine 1 -> stone and iron; Farms 1 -> food.
    expect(v(s).res).toEqual({ wood: K.prod, stone: K.prod, iron: K.prod, food: K.prod });
    expect(v(s).treasury).toBe(K.bureauIncome);
    v(s).power = 7;
    advance(s, TICK, content);
    expect(v(s).treasury).toBe(2 * K.bureauIncome + 7);
    withBuildings(s, { 'core:sawmill': 3, 'core:hunt': 2 });
    advance(s, TICK, content);
    expect(v(s).res.wood).toBe(5 * K.prod);
    expect(v(s).res.food).toBe(K.prod + K.prod + 3 * K.prod);
  });

  it('caps by the store level and loses the overflow, with one event when it fills', () => {
    const s = genin();
    const cap = K.storeCap[0] + K.storeCap[1];
    v(s).res.wood = cap - 5;
    s.events = [];
    advance(s, TICK, content);
    expect(v(s).res.wood).toBe(cap);
    expect(s.events.filter((e) => e.type === 'storageFull')).toEqual([
      { type: 'storageFull', resource: 'wood', at: TICK },
    ]);
    advance(s, TICK, content);
    expect(v(s).res.wood).toBe(cap);
    expect(s.events.filter((e) => e.type === 'storageFull')).toHaveLength(1);
    withBuildings(s, { 'core:store': 2 });
    advance(s, TICK, content);
    expect(v(s).res.wood).toBe(cap + K.prod);
  });

  it('moves the construction job one tick per tick and completes it', () => {
    const s = rich();
    ok(s, { type: 'village.build', building: id('library') });
    expect(villageQueue(s, content)?.ticksLeft).toBe(K.buildTicks[0]);
    advance(s, K.buildTicks[0]! * TICK - 1, content);
    expect(v(s).levels[id('library')]).toBeUndefined();
    advance(s, 1, content);
    expect(v(s).levels[id('library')]).toBe(1);
    expect(v(s).job).toBeNull();
    expect(s.events.some((e) => e.type === 'buildingBuilt')).toBe(true);
  });

  it('is deterministic and split-invariant, also with an action running', () => {
    const make = () => {
      const s = rich();
      ok(s, { type: 'village.build', building: id('grounds') });
      ok(s, { type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' });
      return s;
    };
    const whole = make();
    advance(whole, 12 * HOUR, content);
    // The small chunks cover the first stretch (and cross a village tick boundary at the end of it);
    // the large ones cover the whole run.
    const runs: [number, number][] = [
      [1, 60_000],
      [7, 60_000],
      [999, 12 * HOUR],
      [3600, 12 * HOUR],
    ];
    for (const [chunk, span] of runs) {
      const s = make();
      for (let done = 0; done < span; done += chunk)
        advance(s, Math.min(chunk, span - done), content);
      advance(s, 12 * HOUR - span, content);
      expect(serialize(s)).toBe(serialize(whole));
    }
    const edge = make();
    advance(edge, TICK - 3, content);
    for (let i = 0; i < 6; i++) advance(edge, 1, content);
    const edgeWhole = make();
    advance(edgeWhole, TICK + 3, content);
    expect(serialize(edge)).toBe(serialize(edgeWhole));
    const again = make();
    advance(again, 12 * HOUR, content);
    expect(serialize(again)).toBe(serialize(whole));
  });

  it('runs 12 hours offline exactly like 12 hours online', () => {
    const a = rich();
    const b = rich();
    ok(a, { type: 'village.build', building: id('library') });
    ok(b, { type: 'village.build', building: id('library') });
    advance(a, 12 * HOUR, content);
    advanceOffline(b, 13 * HOUR, content);
    expect(serialize(b)).toBe(serialize(a));
  });

  it('keeps 12 hours of advance fast with the village running', () => {
    const limit = speedBudget(500, 2000);
    const best = bestOf(3, limit, () => {
      advance(rich(), 12 * HOUR, content);
    });
    expect(best).toBeLessThan(limit);
  });
});

describe('A3: building', () => {
  it('costs costBase x multiplier for levels 1-6, iron at half from level 4', () => {
    const wood = [20, 44, 96, 210, 460, 1000];
    const ryo = K.costMult.map((m) => Math.round(K.treasuryBase * m));
    expect(ryo).toEqual([25, 55, 120, 263, 575, 1250]);
    const ticks = [1, 2, 3, 4, 5, 8];
    const s = genin();
    const grounds = villageBuildings(s, content).find((b) => b.id === id('grounds'));
    expect(grounds?.cost?.res).toEqual({ wood: 20, stone: 20 });
    for (let level = 1; level <= 6; level++) {
      const b = content.buildings.find((x) => x.id === id('grounds'))!;
      const s2 = rich();
      v(s2).levels[id('grounds')] = level - 1;
      v(s2).stage = 2;
      s2.currencies.rep = K.rep.stage2!;
      for (const r of Object.keys(v(s2).shinobi)) v(s2).shinobi[r] = 30;
      const before = structuredClone(v(s2));
      ok(s2, { type: 'village.build', building: b.id });
      const job = v(s2).job;
      expect(job?.ticks).toBe(ticks[level - 1]);
      expect(before.res.wood! - v(s2).res.wood!).toBe(wood[level - 1]);
      expect(before.res.stone! - v(s2).res.stone!).toBe(wood[level - 1]);
      expect(before.res.iron! - v(s2).res.iron!).toBe(level >= 4 ? wood[level - 1]! / 2 : 0);
      expect(before.treasury - v(s2).treasury).toBe(ryo[level - 1]);
      expect(before.res.food).toBe(v(s2).res.food);
    }
  });

  it('refuses for every reason, changing nothing', () => {
    const s = genin();
    refused(s, { type: 'village.build', building: 'core:nope' }, 'error.unknownBuilding');
    refused(s, { type: 'village.build', building: id('grounds') }, 'error.notEnoughResources');
    v(s).res.wood = 1000;
    v(s).res.stone = 1000;
    refused(s, { type: 'village.build', building: id('grounds') }, 'error.notEnoughTreasury');
    v(s).treasury = 1000;
    ok(s, { type: 'village.build', building: id('grounds') });
    refused(s, { type: 'village.build', building: id('shrine') }, 'error.queueBusy');
    ok(s, { type: 'village.cancel' });
    // Stage 1 stops at level 3.
    const r = rich();
    v(r).levels[id('grounds')] = 3;
    refused(r, { type: 'village.build', building: id('grounds') }, 'error.stageCap');
    // Level 6: not one of the six, stage 2, shinobi resources.
    v(r).levels[id('library')] = 5;
    refused(r, { type: 'village.build', building: id('library') }, 'error.noLevelSix');
    v(r).levels[id('grounds')] = 5;
    refused(r, { type: 'village.build', building: id('grounds') }, 'error.stageNotReached');
    r.currencies.rep = K.rep.stage2!;
    refused(r, { type: 'village.build', building: id('grounds') }, 'error.notEnoughShinobi');
    v(r).shinobi.dilianky = 30;
    v(r).shinobi.kladka = 30;
    const snapshot = { ...structuredClone(v(r)), stage: 2 as const };
    ok(r, { type: 'village.build', building: id('grounds') });
    expect(v(r).shinobi.dilianky).toBe(0);
    expect(v(r).shinobi.kladka).toBe(0);
    ok(r, { type: 'village.cancel' });
    expect(v(r)).toEqual(snapshot);
    v(r).levels[id('grounds')] = 6;
    refused(r, { type: 'village.build', building: id('grounds') }, 'error.maxLevel');
    refused(r, { type: 'village.cancel' }, 'error.noJob');
    refused(r, { type: 'village.workforce' }, 'error.noJob');
    expect(dispatch(genin(), { type: 'village.donate', ryo: 0 }, content)).toEqual({
      ok: false,
      reason: 'error.invalidAmount',
    });
  });

  it('refunds a cancel exactly', () => {
    const s = rich();
    v(s).levels[id('hospital')] = 3;
    s.currencies.rep = K.rep.stage2!;
    const before = structuredClone(v(s));
    ok(s, { type: 'village.build', building: id('hospital') });
    expect(v(s)).not.toEqual(before);
    ok(s, { type: 'village.cancel' });
    expect(v(s)).toEqual({ ...before, stage: 2 });
  });

  it('donates ryo to the treasury', () => {
    const s = genin();
    s.currencies.ryo = 500;
    ok(s, { type: 'village.donate', ryo: 200 });
    expect(s.currencies.ryo!).toBe(300);
    expect(v(s).treasury).toBe(200);
    refused(s, { type: 'village.donate', ryo: 301 }, 'error.notEnoughRyo');
  });
});

describe('A4: the stage', () => {
  it('switches on exactly at the Reputation threshold and lifts the level cap', () => {
    const s = genin();
    s.currencies.rep = K.rep.stage2! - 1;
    advance(s, 1000, content);
    expect(villageStage(s, content).stage).toBe(1);
    expect(villageStage(s, content).levelCap).toBe(K.towerStageMax[0]);
    s.currencies.rep = K.rep.stage2!;
    advance(s, 1, content);
    expect(villageStage(s, content).stage).toBe(2);
    expect(villageStage(s, content).levelCap).toBe(K.towerStageMax[1]);
    expect(s.events.filter((e) => e.type === 'villageStage')).toHaveLength(1);
  });
});

describe('A5: bonuses', () => {
  const cases: [string, string, number][] = [
    ['grounds', 'xp.skill.tai', 0.01],
    ['grounds', 'xp.skill.ath', 0.01],
    ['shrine', 'xp.skill.med', 0.01],
    ['shrine', 'xp.skill.cc', 0.01],
    ['academy', 'xp.skill.katon', 0.01],
    ['academy', 'xp.skill.futon', 0.01],
    ['academy', 'xp.skill.raiton', 0.01],
    ['academy', 'xp.skill.doton', 0.01],
    ['academy', 'xp.skill.suiton', 0.01],
    ['academy', 'xp.skill.nin', 0.01],
    ['hospital', 'wound.heal', -0.05],
    ['lab', 'speed.skill.alch', 0.01],
    ['lab', 'speed.skill.prov', 0.01],
    ['lab', 'craft.keep', 0.01],
    ['bureau', 'mission.ryo', 0.01],
    ['market', 'shop.price', -0.02],
  ];
  for (const [slug, key, per] of cases) {
    it(`${slug} gives ${per} per level to ${key}, with the building as the source`, () => {
      const s = withBuildings(genin(), { [id(slug)]: 0 });
      expect(getMod(s, key, content).total).toBe(1);
      for (const level of [1, 4, 6]) {
        withBuildings(s, { [id(slug)]: level });
        const mod = getMod(s, key, content);
        expect(mod.total).toBeCloseTo(1 + per * level, 12);
        expect(mod.parts.map((p) => p.source)).toEqual([{ kind: 'building', id: id(slug) }]);
        expect(mod.parts[0]?.group).toBe('village');
      }
      withBuildings(s, { [id(slug)]: 0 });
      expect(getMod(s, key, content).parts).toEqual([]);
    });
  }

  it('doubles the sparring Shinobi Power only at Grounds level 6', () => {
    const s = withBuildings(genin(), { 'core:grounds': 5 });
    expect(getMod(s, 'power.sparring', content).total).toBe(1);
    withBuildings(s, { 'core:grounds': 6 });
    const mod = getMod(s, 'power.sparring', content);
    expect(mod.total).toBe(2);
    expect(mod.parts[0]?.source).toEqual({ kind: 'building', id: 'core:grounds' });
  });

  it('lowers shop prices by 2% per Market level', () => {
    const s = withBuildings(genin(), { 'core:market': 5 });
    expect(shopPrice(s, 'core:meat', content)).toBe(Math.round((K.goods.meat ?? 0) * 0.9));
  });
});

describe('A6: shop gating', () => {
  const fresh = () => {
    const s = genin();
    s.currencies.ryo = 1e6;
    return withBuildings(s, { 'core:market': 0, 'core:forge': 0, 'core:library': 0 });
  };

  it('lets a fresh Genin buy water, rice, salt, oil and meat', () => {
    const s = genin();
    s.currencies.ryo = 1000;
    for (const item of ['water', 'rice', 'salt', 'oil', 'meat']) {
      ok(s, { type: 'shop.buy', item: id(item), n: 1 });
    }
  });

  it('opens each market good and tool at its building level', () => {
    const goods = [
      ...content.market.map((m) => ({ item: m.item, b: id('market'), level: m.marketLevel })),
    ];
    const tools = content.shop.flatMap((e) => {
      const leaf = (e.req.t === 'all' ? e.req.of : []).find((r) => r.t === 'building');
      return leaf && leaf.t === 'building' && leaf.id !== id('market')
        ? [{ item: e.item, b: leaf.id, level: leaf.level }]
        : [];
    });
    expect(tools.length).toBeGreaterThan(0);
    for (const g of [...goods, ...tools]) {
      const s = fresh();
      refused(s, { type: 'shop.buy', item: g.item, n: 1 }, 'error.requirementsNotMet');
      withBuildings(s, { [g.b]: g.level - 1 });
      if (g.level > 1)
        refused(s, { type: 'shop.buy', item: g.item, n: 1 }, 'error.requirementsNotMet');
      withBuildings(s, { [g.b]: g.level });
      ok(s, { type: 'shop.buy', item: g.item, n: 1 });
    }
  });

  it('opens each library scroll at its Library level, at the scroll price', () => {
    const scrolls = content.items.filter((i) => i.scroll?.source.t === 'library');
    expect(scrolls).toHaveLength(8);
    for (const item of scrolls) {
      const src = item.scroll!.source;
      if (src.t !== 'library') continue;
      const s = fresh();
      withBuildings(s, { 'core:library': src.level - 1 });
      refused(s, { type: 'shop.buy', item: item.id, n: 1 }, 'error.requirementsNotMet');
      withBuildings(s, { 'core:library': src.level });
      ok(s, { type: 'shop.buy', item: item.id, n: 1 });
      expect(s.currencies.ryo!).toBe(1e6 - (K.scroll[String(src.level)] ?? 0));
    }
  });

  it('opens each gear tier at its building level', () => {
    for (const line of content.gear) {
      for (const [i, tier] of line.tiers.entries()) {
        if (!tier.building) continue;
        const s = genin();
        s.currencies.ryo = 1e6;
        setLevel(s, line.skill, tier.level);
        s.gear[line.id] = i;
        withBuildings(s, { [tier.building.id]: tier.building.level - 1 });
        refused(s, { type: 'gear.buy', line: line.id }, 'error.requirementsNotMet');
        withBuildings(s, { [tier.building.id]: tier.building.level });
        ok(s, { type: 'gear.buy', line: line.id });
      }
    }
  });

  it('matches the building texts: Forge 1-4, Market 1-3, Library 1-5, Laboratory 3', () => {
    const s = genin();
    const unlocks = (b: string) =>
      villageBuildings(s, content)
        .find((x) => x.id === id(b))
        ?.unlocks.map((u) => `${u.level}`)
        .sort()
        .join('');
    expect(new Set(unlocks('forge')?.split(''))).toEqual(new Set(['1', '2', '3', '4']));
    expect(new Set(unlocks('market')?.split(''))).toEqual(new Set(['1', '2', '3']));
    expect(new Set(unlocks('library')?.split(''))).toEqual(new Set(['1', '2', '3', '4', '5']));
    const lab = villageBuildings(s, content).find((x) => x.id === id('lab'));
    expect(lab?.unlocks.map((u) => u.level)).toContain(3);
  });
});

describe('A7: deposits', () => {
  it('raise the producer by exactly one level', () => {
    const a = genin();
    const b = genin();
    b.flags['deposit.core:sawmill'] = 1;
    advance(a, TICK, content);
    advance(b, TICK, content);
    expect(v(b).res.wood! - v(a).res.wood!).toBe(K.prod);
    expect(villageBuildings(b, content).find((x) => x.id === id('sawmill'))?.effectiveLevel).toBe(
      2,
    );
    expect(villageResources(b, content).find((r) => r.id === 'wood')?.perTick).toBe(2 * K.prod);
  });
});

describe('review fixes', () => {
  it('lets a deposit raise a built producer only: an unbuilt one stays idle', () => {
    const s = genin();
    s.flags['deposit.core:hunt'] = 1;
    advance(s, TICK, content);
    expect(v(s).res.food).toBe(K.prod);
    withBuildings(s, { 'core:hunt': 1 });
    advance(s, TICK, content);
    expect(v(s).res.food).toBe(K.prod + K.prod + 2 * K.prod);
  });

  it('applies the Market discount to the stack total, so cheap goods get it too', () => {
    const s = withBuildings(genin(), { 'core:market': 5 });
    s.currencies.ryo = 1000;
    ok(s, { type: 'shop.buy', item: 'core:water', n: 100 });
    // 100 water at 1 ryo and -10%: 90, not 100.
    expect(s.currencies.ryo!).toBe(1000 - 90);
  });

  it('does not create a village for a command that is refused', () => {
    const s = createState(1, content);
    s.player.rank = 'genin';
    refused(s, { type: 'village.cancel' }, 'error.noVillage');
    expect(s.village).toBeNull();
  });
});

describe('A8: shinobi resources', () => {
  it('respects caps, workforce charges and Shinobi Power', () => {
    const s = genin();
    const cap = K.shinobiCap[0] + K.shinobiCap[1];
    expect(addShinobiResource(s, 'okhorona', 10, content)).toBe(10);
    expect(addShinobiResource(s, 'okhorona', 1000, content)).toBe(cap - 10);
    expect(v(s).shinobi.okhorona).toBe(cap);
    expect(addShinobiResource(s, 'robocha_syla', 5, content)).toBe(5);
    expect(v(s).workforce).toBe(5);
    expect(addShinobiResource(s, 'syla_shynobi', 1_000_000, content)).toBe(1_000_000);
    expect(v(s).power).toBe(1_000_000);
    expect(addShinobiResource(s, 'wood', 5, content)).toBe(0);
    expect(addShinobiResource(s, 'okhorona', 0, content)).toBe(0);
    withBuildings(s, { 'core:store': 3 });
    expect(addShinobiResource(s, 'okhorona', 1000, content)).toBe(10 * 2);
  });

  it('lets a workforce charge remove one tick from the job', () => {
    const s = rich();
    ok(s, { type: 'village.build', building: id('forge') });
    refused(s, { type: 'village.workforce' }, 'error.noWorkforce');
    addShinobiResource(s, 'robocha_syla', 2, content);
    ok(s, { type: 'village.workforce' });
    expect(v(s).workforce).toBe(1);
    expect(v(s).levels[id('forge')]).toBe(1);
    ok(s, { type: 'village.build', building: id('forge') });
    ok(s, { type: 'village.workforce' });
    expect(v(s).job?.ticks).toBe(K.buildTicks[1]! - 1);
  });
});

describe('A9: pace report', () => {
  type Group = string[];
  interface Played {
    report: string[];
    library3: number;
    library5: number;
    firstFive: number;
  }
  const slugs = (list: string[]): Group => list.map(id);
  const PRODUCERS = slugs(['sawmill', 'mine', 'farms', 'hunt']);

  /** Plays 12 game hours with `dispatch` and `advance` only: always the cheapest affordable upgrade of the first group that has one. The variant lifts Reputation to the stage-2 threshold at hour 4 and donates 300 ryo an hour from hour 2; otherwise nothing is donated. */
  function play(groups: Group[], variant = false): Played {
    const s = genin();
    const when: Record<string, number> = {};
    const policy = (): void => {
      if (v(s).job) return;
      for (const group of groups) {
        const options = villageBuildings(s, content)
          .filter((b) => group.includes(b.id) && b.build.ok && b.cost)
          .sort((x, y) => x.cost!.ryo - y.cost!.ryo || group.indexOf(x.id) - group.indexOf(y.id));
        const pick = options[0];
        if (pick) {
          dispatch(s, { type: 'village.build', building: pick.id }, content);
          return;
        }
      }
    };
    const report: string[] = [];
    for (let minute = K.tickMin; minute <= 12 * 60; minute += K.tickMin) {
      if (variant && minute === 4 * 60) s.currencies.rep = K.rep.stage2!;
      if (variant && minute >= 2 * 60 && minute % 60 === 0) {
        s.currencies.ryo = (s.currencies.ryo ?? 0) + 300;
        dispatch(s, { type: 'village.donate', ryo: 300 }, content);
      }
      policy();
      advance(s, TICK, content);
      policy();
      for (const [b, level] of Object.entries(v(s).levels)) {
        for (const at of [3, 5]) {
          if (level >= at && when[`${b}:${at}`] === undefined) when[`${b}:${at}`] = minute / 60;
        }
      }
      if ([120, 240, 480, 720].includes(minute)) {
        const levels = Object.entries(v(s).levels)
          .map(([b, l]) => `${b.replace('core:', '')}${l}`)
          .join(' ');
        report.push(
          `  ${minute / 60}h: ${levels} | wood ${v(s).res.wood} stone ${v(s).res.stone} iron ${v(s).res.iron} food ${v(s).res.food} | treasury ${v(s).treasury}`,
        );
      }
    }
    const fives = Object.entries(when)
      .filter(([k]) => k.endsWith(':5'))
      .map(([, h]) => h);
    const library3 = when['core:library:3'] ?? Infinity;
    const library5 = when['core:library:5'] ?? Infinity;
    const firstFive = fives.length ? Math.min(...fives) : Infinity;
    report.push(
      '  library 3 at ' +
        library3 +
        'h; library 5 at ' +
        library5 +
        'h; first level-5 building at ' +
        firstFive +
        'h',
    );
    return { report, library3, library5, firstFive };
  }

  it('prints levels and resources after 2, 4, 8 and 12 hours for two builder policies', () => {
    const spec = play([
      PRODUCERS,
      slugs(['store']),
      slugs(['library']),
      slugs(['forge']),
      slugs(['market']),
      slugs(['grounds']),
    ]);
    const variant = play(
      [
        PRODUCERS,
        slugs(['store']),
        slugs(['library']),
        slugs(['forge']),
        slugs(['market']),
        slugs(['grounds']),
      ],
      true,
    );
    const libraryFirst = play([
      slugs(['library']),
      slugs(['store']),
      PRODUCERS,
      slugs(['forge']),
      slugs(['market']),
      slugs(['grounds']),
    ]);
    const libraryFirstVariant = play(
      [
        slugs(['library']),
        slugs(['store']),
        PRODUCERS,
        slugs(['forge']),
        slugs(['market']),
        slugs(['grounds']),
      ],
      true,
    );
    console.log(
      [
        'Policy as specified (producers first):',
        ...spec.report,
        'Variant (Reputation at 4 h, 300 ryo donated per hour from 2 h):',
        ...variant.report,
        'Library first, no donations:',
        ...libraryFirst.report,
        'Library first with the variant (Reputation at 4 h, donations):',
        ...libraryFirstVariant.report,
      ].join('\n'),
    );
    // Library 3 by hour 4 with the Library first or with the variant; the first level-5 building
    // between hours 6 and 12 in the variant; Library 5 by hour 12 with the Library first and the variant.
    expect(libraryFirst.library3).toBeLessThanOrEqual(4);
    expect(variant.library3).toBeLessThanOrEqual(4);
    expect(variant.firstFive).toBeGreaterThanOrEqual(6);
    expect(variant.firstFive).toBeLessThanOrEqual(12);
    expect(libraryFirstVariant.library5).toBeLessThanOrEqual(12);
    // Without Reputation nothing passes the stage-1 cap of level 3.
    expect(spec.firstFive).toBe(Infinity);
  });
});

describe('A11: saves', () => {
  it('round-trips a village byte for byte', () => {
    const s = rich();
    ok(s, { type: 'village.build', building: id('library') });
    advance(s, 3 * TICK + 17, content);
    const text = serialize(s);
    expect(deserialize(text, content).village).toEqual(s.village);
  });

  it('migrates: a genin save gets a village, a student save none', () => {
    expect(STATE_VERSION).toBeGreaterThanOrEqual(MIGRATION_BASE);
    const old = (rank: 'student' | 'genin') => {
      const s = rank === 'genin' ? genin() : createState(1, content);
      const parsed = JSON.parse(serialize(s)) as { v: number; state: Record<string, unknown> };
      parsed.v = MIGRATION_BASE - 1;
      parsed.state.v = MIGRATION_BASE - 1;
      delete parsed.state.village;
      return deserialize(JSON.stringify(parsed), content);
    };
    expect(old('genin').village?.levels[id('tower')]).toBe(1);
    expect(old('student').village).toBeNull();
  });

  it('cleans a doctored village', () => {
    const s = genin();
    const parsed = JSON.parse(serialize(s)) as { state: { village: Record<string, unknown> } };
    parsed.state.village = {
      levels: { 'core:library': 99, 'core:ghost': 4, 'core:grounds': 6 },
      res: { wood: 1e9, ghost: 5 },
      shinobi: { okhorona: 1e9 },
      workforce: -4,
      treasury: 'x',
      job: { building: 'core:library', ticks: 1e9 },
      clock: 1e12,
    };
    const loaded = deserialize(JSON.stringify(parsed), content);
    const village = v(loaded);
    expect(village.levels[id('library')]).toBe(5);
    expect(village.levels['core:ghost']).toBeUndefined();
    expect(village.res.wood).toBe(K.storeCap[0] + K.storeCap[1]);
    expect(village.shinobi.okhorona).toBe(K.shinobiCap[0] + K.shinobiCap[1]);
    expect(village.workforce).toBe(0);
    expect(village.treasury).toBe(0);
    expect(village.job).toBeNull();
    expect(village.clock).toBeLessThan(TICK);
  });
});
