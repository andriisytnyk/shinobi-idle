/** Structured modifiers: pool checkpoints switch on at their share, and every wired key changes its mechanic by exactly the modifier. */
import { MODIFIER_KEYS, content, type SkillId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  bushSize,
  missionForecast,
  payMission,
  craftBonusChance,
  craftKeepChance,
  defaultRules,
  dispatch,
  exploreIntervalMs,
  gainPoolXp,
  gainXp,
  gatherKind,
  getMod,
  grantMastery,
  masteryXpPerAction,
  meditationChances,
  poolCapacity,
  poolGain,
  shopPrice,
  woundHealMs,
  woundIntervalMs,
  regrowEachMs,
  regrowMs,
  techniqueNumbers,
  travelPrice,
  useTonic,
  walkMs,
  type GameState,
  type Modifier,
  type Rules,
} from '../src/index.ts';
import { genin, HOUR, plainRules, setLevel, start, withBuildings } from './helpers.ts';

const K = content.balance.K;
const MINT = 'core:mint';
const ANTIDOTE = 'core:antidote';
const ONIGIRI = 'core:onihiri';
const CLEAR_MIND = 'core:tonik_iasnoho_rozumu';

/** Fills a skill's pool to exactly `pct` percent of its capacity, the threshold a checkpoint names. */
function reach(state: GameState, skill: SkillId, pct: number): void {
  state.pools[skill]!.xp = (poolCapacity(skill, content) * pct) / 100;
}

const withProvider = (...mods: Modifier[]): Rules => ({
  ...defaultRules,
  modifierProviders: [() => mods],
});
const test = (key: string, value: number, op: 'add' | 'mul' = 'add'): Modifier => ({
  key,
  op,
  value,
  group: 'items',
  source: 'test',
});

const missionById = (id: string) => {
  const found = content.missions.find((x) => x.id === id);
  if (!found) throw new Error(`no mission ${id}`);
  return found;
};

/** The modifiers of the checkpoint with this skill and share. */
function checkpoint(skill: string, pct: number) {
  const found = content.pools.find((p) => p.skill === skill && p.pct === pct);
  if (!found) throw new Error(`no checkpoint ${skill} ${pct}`);
  return found;
}

describe('A5: pool checkpoints switch on exactly at their share', () => {
  const real = content.pools.filter((p) => p.mods.length > 0);

  it('covers 39 checkpoints: 10, 25 and 50% of the 13 mastery skills', () => {
    expect(real).toHaveLength(39);
  });

  it('is off just below the threshold and on at it, with the skill as source', () => {
    for (const p of real) {
      const capacity = poolCapacity(p.skill, content);
      const threshold = (capacity * p.pct) / 100;
      const from = (s: GameState) =>
        p.mods.flatMap((m) =>
          getMod(s, m.key, content).parts.filter(
            (part) =>
              typeof part.source === 'object' &&
              part.source.kind === 'skill' &&
              part.source.id === p.skill &&
              part.value === m.value,
          ),
        );
      const below = genin();
      below.pools[p.skill]!.xp = threshold - 0.001;
      // Other checkpoints of the same skill below this one may be on; this one must not be.
      const countBelow = from(below).length;
      const at = genin();
      at.pools[p.skill]!.xp = threshold;
      expect(from(at).length, p.id).toBe(countBelow + p.mods.length);
    }
  });

  it('switches on at the moment gainPoolXp announces the checkpoint', () => {
    const state = genin();
    const p = checkpoint('herb', 10);
    const key = 'bush.stock';
    const threshold = (poolCapacity('herb', content) * 10) / 100;
    state.pools.herb!.xp = threshold - 1;
    expect(getMod(state, key, content).total).toBe(1);
    gainPoolXp(state, 'herb', 1, content);
    expect(state.events.some((e) => e.type === 'poolCheckpoint' && e.id === p.id)).toBe(true);
    expect(getMod(state, key, content).total).toBe(1 + 5);
  });

  it('keeps the 95% checkpoints text-only', () => {
    const state = genin();
    for (const skill of Object.keys(state.pools) as (keyof typeof state.pools)[]) {
      state.pools[skill]!.xp = poolCapacity(skill, content);
    }
    const sources = new Set(
      Object.keys(MODIFIER_KEYS)
        // The Athletics cut of explore and walk time is not a checkpoint.
        .filter((key) => key !== 'interval.explore' && key !== 'interval.walk')
        .flatMap((key) => getMod(state, key, content).parts)
        // Village bonuses come from buildings, not from checkpoints.
        .filter((p) => typeof p.source !== 'object' || p.source.kind !== 'building'),
    );
    // Every part comes from a 10 / 25 / 50% checkpoint: at most one part per such checkpoint.
    expect(sources.size).toBeLessThanOrEqual(39);
  });
});

describe('A4: each wired key changes its mechanic by exactly the modifier', () => {
  // One case per modifier family; the meta test below keeps this table in step with the registry.
  const cases: Record<string, () => void> = {
    'xp.all': () => {
      const s = genin();
      const before = s.skills.cc!.xp;
      gainXp(s, 'cc', 100, content, withProvider(test('xp.all', 0.1)));
      expect(s.skills.cc!.xp - before).toBeCloseTo(110, 9);
    },
    'xp.skill.*': () => {
      // pool_cc_10: +5% Chakra Control XP
      const s = genin();
      reach(s, 'cc', 10);
      const before = s.skills.cc!.xp;
      gainXp(s, 'cc', 100, content, defaultRules);
      expect(s.skills.cc!.xp - before).toBeCloseTo(105, 9);
      expect(getMod(s, 'xp.skill.cc', content).parts[0]?.source).toEqual({
        kind: 'skill',
        id: 'cc',
      });
    },
    'mastery.xp.all': () => {
      const s = genin();
      grantMastery(
        s,
        'core:clone',
        'nin',
        1000,
        content,
        withProvider(test('mastery.xp.all', 0.2)),
      );
      expect(s.mastery['core:clone']?.xp).toBeCloseTo(1200, 9);
      // The pool takes its share of the unmodified amount.
      expect(s.pools.nin!.xp).toBeCloseTo(poolGain(1000, content), 9);
    },
    'mastery.xp.skill.*': () => {
      // pool_med_10: +5% mastery XP of Meditation
      const s = genin();
      reach(s, 'med', 10);
      grantMastery(s, 'core:tykha_kimnata', 'med', 1000, content, defaultRules);
      expect(s.mastery['core:tykha_kimnata']?.xp).toBeCloseTo(1050, 9);
    },
    'interval.skill.*': () => {
      // pool_alch_10: -5% brewing time
      const s = genin();
      const base =
        defaultRules.actionKinds.craft?.intervalMs(s, ANTIDOTE, content, defaultRules) ?? 0;
      expect(base).toBe(Math.round(K.craft * 1000));
      reach(s, 'alch', 10);
      expect(defaultRules.actionKinds.craft?.intervalMs(s, ANTIDOTE, content, defaultRules)).toBe(
        Math.round(K.craft * 1000 * 0.95),
      );
    },
    'speed.skill.*': () => {
      // pool_prov_10: +5% speed of the active station
      const s = genin();
      reach(s, 'prov', 10);
      expect(defaultRules.actionKinds.craft?.intervalMs(s, ONIGIRI, content, defaultRules)).toBe(
        Math.round((K.craft * 1000) / 1.05),
      );
    },
    'speed.practice': () => {
      // pool_cc_50: +2% speed of technique practice
      const s = genin();
      const plain =
        defaultRules.actionKinds.practice?.intervalMs(s, 'core:clone', content, defaultRules) ?? 0;
      reach(s, 'cc', 50);
      const fast =
        defaultRules.actionKinds.practice?.intervalMs(s, 'core:clone', content, defaultRules) ?? 0;
      expect(fast).toBe(Math.round(plain / 1.02));
    },
    'hp.regen': () => {
      // A flat key: +0.5 is half a point of health more every second, out of a fight.
      const gained = (rules: Rules): number => {
        const s = genin();
        s.player.hp = 10;
        advance(s, 40_000, content, rules);
        return s.player.hp - 10;
      };
      const [base, perLevel] = K.hpRegen;
      expect(gained(plainRules)).toBeCloseTo(40 * ((base ?? 0) + (perLevel ?? 0)), 5);
      expect(gained(withProvider(test('hp.regen', 0.5)))).toBeCloseTo(
        gained(plainRules) + 40 * 0.5,
        5,
      );
    },
    'cost.chakra': () => {
      const s = genin();
      const tech = content.techniques.find(
        (t) => t.skill === 'nin' && t.combat !== null && t.rank !== null,
      );
      if (!tech) throw new Error('no technique');
      const base = techniqueNumbers(s, tech, content, plainRules).cost;
      const cut = techniqueNumbers(s, tech, content, withProvider(test('cost.chakra', -0.1))).cost;
      expect(cut).toBeCloseTo(base * 0.9, 9);
    },
    'cost.stamina': () => {
      const s = genin();
      const tech = content.techniques.find(
        (t) => t.skill === 'tai' && t.combat !== null && t.rank !== null,
      );
      if (!tech) throw new Error('no technique');
      const base = techniqueNumbers(s, tech, content, plainRules).cost;
      const cut = techniqueNumbers(s, tech, content, withProvider(test('cost.stamina', -0.2))).cost;
      expect(cut).toBeCloseTo(base * 0.8, 9);
    },
    'bush.stock': () => {
      // pool_herb_10: +5 herbs in every bush
      const s = genin();
      const base = bushSize(s, MINT, content, defaultRules);
      expect(base).toBe(K.field.stockBase + 1); // mastery level 1
      reach(s, 'herb', 10);
      expect(bushSize(s, MINT, content, defaultRules)).toBe(base + 5);
      setLevel(s, 'herb', 1);
      expect(dispatch(s, start('gather', MINT), content)).toEqual({ ok: true });
      expect(s.bushes[MINT]).toMatchObject({ stock: base + 5, size: base + 5 });
    },
    'bush.regrow': () => {
      // pool_herb_25: -10% regrow time
      const s = genin();
      expect(regrowMs(s, content, defaultRules)).toBe(K.field.regrowMs);
      reach(s, 'herb', 25);
      expect(regrowMs(s, content, defaultRules)).toBe(Math.round(K.field.regrowMs * 0.9));
      expect(regrowEachMs(s, content, defaultRules)).toBe(Math.round(K.field.regrowEachMs * 0.9));
      // An emptied bush: the phase is the (shortened) pause alone; a bush with herbs left: a gathering cycle.
      s.bushes[MINT] = { stock: 0, size: 5, at: 0 };
      expect(gatherKind.intervalMs(s, MINT, content, defaultRules)).toBe(
        Math.round(K.field.regrowMs * 0.9),
      );
      s.bushes[MINT] = { stock: 2, size: 5, at: 0 };
      expect(gatherKind.intervalMs(s, MINT, content, defaultRules)).toBe(
        Math.round(K.gather * 1000),
      );
    },
    'gather.double': () => {
      // pool_herb_50: +5% chance of a second herb
      const s = genin();
      reach(s, 'herb', 50);
      const gathers = 20_000;
      for (let i = 0; i < gathers; i++) {
        delete s.bushes[MINT]; // time does not pass here: every gather finds a full bush
        gatherKind.complete(s, MINT, content, defaultRules);
      }
      const herbs = s.bank[MINT] ?? 0;
      expect(herbs / gathers).toBeGreaterThan(1.05 - 0.01);
      expect(herbs / gathers).toBeLessThan(1.05 + 0.01);
    },
    'craft.keep': () => {
      // pool_alch_25: +5% chance to keep any ingredients
      const s = genin();
      expect(craftKeepChance(s, 'alch', content, defaultRules)).toBe(0);
      reach(s, 'alch', 25);
      expect(craftKeepChance(s, 'alch', content, defaultRules)).toBeCloseTo(0.05, 12);
      expect(craftKeepChance(s, 'prov', content, defaultRules)).toBeCloseTo(0.05, 12);
    },
    'craft.keep.alch': () => {
      const s = genin();
      expect(
        craftKeepChance(s, 'alch', content, withProvider(test('craft.keep.alch', 0.07))),
      ).toBeCloseTo(0.07, 12);
      expect(craftKeepChance(s, 'prov', content, withProvider(test('craft.keep.alch', 0.07)))).toBe(
        0,
      );
    },
    'craft.keep.prov': () => {
      const s = genin();
      expect(
        craftKeepChance(s, 'prov', content, withProvider(test('craft.keep.prov', 0.04))),
      ).toBeCloseTo(0.04, 12);
    },
    'craft.double': () => {
      // pool_alch_50: +5% chance of one extra product
      const s = genin();
      expect(craftBonusChance(s, ANTIDOTE, content, defaultRules)).toBe(0);
      reach(s, 'alch', 50);
      expect(craftBonusChance(s, ANTIDOTE, content, defaultRules)).toBeCloseTo(0.05, 12);
    },
    'tonic.charges': () => {
      // pool_prov_50: tonics hold 25% more charges
      const s = genin();
      const base = content.items.find((i) => i.id === CLEAR_MIND)?.fx;
      if (base?.kind !== 'tonic') throw new Error('no tonic');
      s.bank[CLEAR_MIND] = 2;
      reach(s, 'prov', 50);
      expect(useTonic(s, CLEAR_MIND, content, defaultRules)).toEqual({ ok: true });
      expect(s.buffs[CLEAR_MIND]?.charges).toBe(Math.round(base.charges * 1.25));
    },
    'obstacle.cost': () => {
      // pool_ath_10: -5% obstacle price; the full check is in the Athletics tests
      const s = genin();
      reach(s, 'ath', 10);
      const total = getMod(s, 'obstacle.cost', content).total;
      expect(total).toBeCloseTo(0.95, 12);
    },
    'obstacle.bonus': () => {
      const s = genin();
      reach(s, 'ath', 25);
      expect(getMod(s, 'obstacle.bonus', content).total).toBeCloseTo(1.02, 12);
    },
    'interval.explore': () => {
      const s = genin();
      expect(exploreIntervalMs(s, content, withProvider())).toBe(K.explore * 1000);
      const faster = withProvider(test('interval.explore', -0.1));
      expect(exploreIntervalMs(s, content, faster)).toBe(Math.round(K.explore * 1000 * 0.9));
    },
    'interval.walk': () => {
      const s = genin();
      const cell = content.cells[1];
      if (!cell) throw new Error('no cell');
      const base = walkMs(s, cell, content, withProvider());
      expect(base).toBeGreaterThan(0);
      const faster = withProvider(test('interval.walk', -0.1));
      // Each hex of the route is rounded on its own, so the sum may differ from the whole by a ms per hex.
      expect(Math.abs(walkMs(s, cell, content, faster) - base * 0.9)).toBeLessThanOrEqual(3);
    },
    'shop.price': () => {
      // Each Market level takes 2% off the price of a good.
      const s = withBuildings(genin(), { 'core:market': 0 });
      expect(shopPrice(s, 'core:meat', content)).toBe(K.goods.meat);
      withBuildings(s, { 'core:market': 3 });
      expect(shopPrice(s, 'core:meat', content)).toBe(Math.round((K.goods.meat ?? 0) * 0.94));
    },
    'wound.heal': () => {
      // Each Hospital level shortens the healing of a stack by 5%.
      const s = withBuildings(genin(), { 'core:hospital': 2 });
      expect(woundHealMs(s, content, defaultRules)).toBe(
        Math.round(woundIntervalMs(content) * 0.9),
      );
    },
    'obstacle.penalty': () => {
      const s = genin();
      reach(s, 'ath', 50);
      expect(getMod(s, 'obstacle.penalty', content).total).toBeCloseTo(0.75, 12);
    },
    'meditation.insightChance': () => {
      // pool_med_25: the chance of an Insight goes from 5% to 10%
      const s = genin();
      expect(meditationChances(s, content, defaultRules).insight).toBeCloseTo(0.05, 12);
      reach(s, 'med', 25);
      expect(meditationChances(s, content, defaultRules).insight).toBeCloseTo(0.1, 12);
    },
    'mission.duration': () => {
      const s = genin();
      const weed = missionById('core:weed');
      const base = missionForecast(s, weed, content, withProvider()).stages[0]?.ms ?? 0;
      const faster = missionForecast(
        s,
        weed,
        content,
        withProvider(test('mission.duration', -0.1)),
      );
      expect(Math.abs((faster.stages[0]?.ms ?? 0) - base * 0.9)).toBeLessThanOrEqual(1);
    },
    'mission.duration.nin': () => {
      // The stage of the courier's Ninjutsu alternative is the only one Ninjutsu performs.
      const s = genin();
      setLevel(s, 'nin', 10);
      s.known['core:body_flicker'] = true;
      const courier = missionById('core:courier');
      const base = missionForecast(s, courier, content, withProvider()).stages[0]?.ms ?? 0;
      const faster = missionForecast(
        s,
        courier,
        content,
        withProvider(test('mission.duration.nin', -0.2)),
      );
      expect(Math.abs((faster.stages[0]?.ms ?? 0) - base * 0.8)).toBeLessThanOrEqual(1);
      const other = missionForecast(
        s,
        missionById('core:weed'),
        content,
        withProvider(test('mission.duration.nin', -0.2)),
      );
      expect(other.stages[0]?.ms).toBe(
        missionForecast(s, missionById('core:weed'), content, withProvider()).stages[0]?.ms,
      );
    },
    'mission.ryo': () => {
      const s = genin();
      payMission(s, missionById('core:cat'), [], content, withProvider(test('mission.ryo', 0.1)));
      expect(s.currencies.ryo).toBe(Math.round(missionById('core:cat').ryo * 1.1));
    },
    'power.sparring': () => {
      const s = genin();
      const spar = missionById('core:v_spar');
      payMission(s, spar, [], content, withProvider(test('power.sparring', 1)));
      expect(s.village?.power).toBe(content.balance.K.shinobiResPerMission * 2);
    },
    'mission.rep': () => {
      const s = genin();
      payMission(s, missionById('core:cat'), [], content, withProvider(test('mission.rep', 0.5)));
      expect(s.currencies.rep).toBe(Math.round(missionById('core:cat').rep * 1.5));
    },
    'travel.price': () => {
      const s = genin();
      // Two hexes away, over a road and a forest: 6 minutes of walking.
      const base = travelPrice(s, 'core:uzlissia', content, defaultRules);
      const cheap = travelPrice(
        s,
        'core:uzlissia',
        content,
        withProvider(test('travel.price', -0.5)),
      );
      expect(base).toBe(Math.ceil(content.balance.K.map.travel.ryoPerMinute * 6));
      expect(cheap).toBe(Math.max(content.balance.K.map.travel.min, Math.ceil(base! / 2)));
      expect(cheap).toBeLessThan(base!);
    },
    'meditation.enlightChance': () => {
      const s = genin();
      const chance = meditationChances(
        s,
        content,
        withProvider(test('meditation.enlightChance', 0.03)),
      );
      expect(chance.enlight).toBeCloseTo(0.02 + 0.03, 12);
    },
  };

  const family = (key: string): string =>
    key.replace(/^(xp\.skill|mastery\.xp\.skill|interval\.skill|speed\.skill)\.[a-z]+$/, '$1.*');

  it('has a case for every wired key family of the registry, and no other', () => {
    const wired = new Set(
      Object.entries(MODIFIER_KEYS)
        .filter(([, info]) => info.wired)
        .map(([key]) => family(key)),
    );
    expect([...wired].sort()).toEqual(Object.keys(cases).sort());
  });

  for (const [key, run] of Object.entries(cases)) {
    it(`${key}`, run);
  }

  it('stays split-invariant with every checkpoint reached and a gathering action running', () => {
    const a = genin(3);
    a.pools.herb!.xp = poolCapacity('herb', content);
    setLevel(a, 'herb', 1);
    dispatch(a, start('gather', MINT), content);
    advance(a, 2 * HOUR, content);
    const b = genin(3);
    b.pools.herb!.xp = poolCapacity('herb', content);
    setLevel(b, 'herb', 1);
    dispatch(b, start('gather', MINT), content);
    for (let i = 0; i < 7200; i++) advance(b, 1000, content);
    expect(JSON.stringify(b.bank)).toBe(JSON.stringify(a.bank));
    expect(masteryXpPerAction(1, 1, content)).toBeGreaterThan(0);
  });
});
