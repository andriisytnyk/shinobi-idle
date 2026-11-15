/** Field and crafts: gathering, crafting, tonics, coating, shops and training gear. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createState,
  deserialize,
  dispatch,
  getMod,
  rate,
  refreshUnlocks,
  sellPrice,
  buyPrice,
  serialize,
  MIGRATIONS,
  STATE_VERSION,
  xpAt,
  type Command,
  type GameState,
} from '../src/index.ts';
import { genin, HOUR, plainRules, setLevel, start, withNatures } from './helpers.ts';

const K = content.balance.K;
const MINT = 'core:mint';
const NETTLE = 'core:nettle';
const ANTIDOTE = 'core:antidote';
const OINTMENT = 'core:tsiliushcha_maz';
const CLEAR_MIND = 'core:tonik_iasnoho_rozumu';
const SICKLE = 'core:serp_i_rukavytsi_travnyka';
const ALEMBIC = 'core:perehinnyi_kub';

const gather = (id: string, slot = 0): Command => start('gather', id, slot);
const craft = (id: string, slot = 0): Command => start('craft', id, slot);
const ok = (s: GameState, c: Command) => expect(dispatch(s, c, content)).toEqual({ ok: true });
const refused = (s: GameState, c: Command, reason: string) =>
  expect(dispatch(s, c, content)).toEqual({ ok: false, reason });
const stocked = (s: GameState, items: Record<string, number>) => {
  for (const [id, n] of Object.entries(items)) s.bank[id] = (s.bank[id] ?? 0) + n;
};
const stops = (s: GameState) => s.events.filter((e) => e.type === 'actionStopped');
const withMastery = (s: GameState, key: string, level: number) => {
  s.mastery[key] = { xp: xpAt(level) };
};
const BIG = 1_000_000;

describe('skill unlocks: Herbalism, Provisions and Alchemy open at genin', () => {
  it('refuse their actions for a student and accept them for a genin', () => {
    const student = createState(1, content);
    for (const skill of ['herb', 'prov', 'alch'] as const) {
      const unlock = content.skills.find((s) => s.id === skill)?.unlockReq;
      expect(unlock).toEqual({ t: 'rank', rank: 'genin' });
    }
    refused(student, gather(MINT), 'error.skillLocked');
    refused(student, craft(ANTIDOTE), 'error.skillLocked');
    const g = genin();
    ok(g, gather(MINT));
    stocked(g, { [MINT]: 2, 'core:water': 1 });
    ok(g, craft(ANTIDOTE));
  });
});

describe('gather', () => {
  it('needs the herb level and the herb extra requirement (Chakra Control for rare herbs)', () => {
    const s = genin();
    refused(s, gather('core:nettle'), 'error.requirementsNotMet');
    setLevel(s, 'herb', 5);
    ok(s, gather('core:nettle'));
    setLevel(s, 'herb', 35);
    refused(s, gather('core:edelweiss'), 'error.requirementsNotMet');
    setLevel(s, 'cc', 15);
    ok(s, gather('core:edelweiss'));
    setLevel(s, 'herb', 45);
    refused(s, gather('core:lotus'), 'error.requirementsNotMet');
    setLevel(s, 'cc', 30);
    ok(s, gather('core:lotus'));
  });

  it('yields the bush stock, regrows for the pause, then yields again', () => {
    const s = genin();
    ok(s, gather(MINT));
    const size = K.field.stockBase + 1;
    const cycle = K.gather * 1000;
    advance(s, cycle * size - 1, content, plainRules);
    expect(s.bank[MINT]).toBe(size - 1);
    advance(s, 1, content, plainRules);
    expect(s.bank[MINT]).toBe(size);
    // The bush is empty: the next herb comes after the regrow pause and one more cycle.
    advance(s, K.field.regrowMs + cycle - 1, content, plainRules);
    expect(s.bank[MINT]).toBe(size);
    advance(s, 1, content, plainRules);
    expect(s.bank[MINT]).toBe(size + 1);
  });

  for (const level of [1, 30]) {
    it(`gives Herbalism XP per hour equal to rate(${level}) despite the pauses`, () => {
      const s = genin();
      const herb = content.herbs.find((h) => h.level === level);
      if (!herb) throw new Error('no herb');
      setLevel(s, 'herb', level);
      if (herb.req) setLevel(s, 'cc', 30);
      const before = s.skills.herb.xp;
      ok(s, gather(herb.id));
      advance(s, HOUR, content, plainRules);
      const perHour = s.skills.herb.xp - before;
      expect(perHour / rate(level, content)).toBeGreaterThan(0.98);
      expect(perHour / rate(level, content)).toBeLessThan(1.02);
    });
  }

  it('gathers the herbs per hour that interval, stock and regrow imply', () => {
    const s = genin();
    withMastery(s, MINT, K.masteryCap);
    const size = K.field.stockBase + K.masteryCap;
    ok(s, gather(MINT));
    advance(s, HOUR, content, plainRules);
    const perBush = K.gather * 1000 * size + K.field.regrowMs;
    const expected = (HOUR / perBush) * size;
    expect(s.bank[MINT] ?? 0).toBeGreaterThan(expected * 0.99);
    expect(s.bank[MINT] ?? 0).toBeLessThan(expected * 1.01);
  });

  it('grows the bush with mastery and earns mastery and pool XP', () => {
    const s = genin();
    ok(s, gather(MINT));
    advance(s, 60_000, content, plainRules);
    expect(s.mastery[MINT]?.xp).toBeGreaterThan(0);
    expect(s.pools.herb.xp).toBeGreaterThan(0);
    expect(s.bushes[MINT]).toMatchObject({ size: expect.any(Number), carry: 0 });
  });

  it('is sped up by the sickle without changing the regrow pause', () => {
    const s = genin();
    s.gear[SICKLE] = 2;
    expect(getMod(s, 'interval.skill.herb', content).total).toBeCloseTo(
      1 - 2 * K.gearFx.sickle,
      12,
    );
    ok(s, gather(MINT));
    const size = K.field.stockBase + 1;
    const cycle = Math.round(K.gather * 1000 * (1 - 2 * K.gearFx.sickle));
    advance(s, cycle * size, content, plainRules);
    expect(s.bank[MINT]).toBe(size);
  });
});

describe('craft', () => {
  it('consumes the recipe ingredients and adds the product', () => {
    const s = genin();
    stocked(s, { [MINT]: 5, 'core:water': 3 });
    ok(s, craft(ANTIDOTE));
    advance(s, K.craft * 1000, content, plainRules);
    expect(s.bank[MINT]).toBe(3);
    expect(s.bank['core:water']).toBe(2);
    expect(s.bank[ANTIDOTE]).toBeGreaterThanOrEqual(2);
    expect(s.bank[ANTIDOTE]).toBeLessThanOrEqual(3);
  });

  it('A4: gives XP per hour equal to rate x craftXpMult, with ingredients used per recipe', () => {
    for (const [id, level] of [
      [ANTIDOTE, 1],
      ['core:tonik_iasnoho_rozumu', 5],
      ['core:onihiri', 1],
    ] as const) {
      const recipe = content.recipes.find((r) => r.id === id);
      if (!recipe) throw new Error('no recipe');
      const s = genin();
      setLevel(s, recipe.skill, level);
      for (const i of recipe.ingredients) s.bank[i.item] = BIG;
      const before = s.skills[recipe.skill].xp;
      ok(s, craft(id));
      advance(s, HOUR, content, plainRules);
      const crafts = s.counters['actions.craft'] ?? 0;
      expect(crafts).toBe(HOUR / (K.craft * 1000));
      const perHour = s.skills[recipe.skill].xp - before;
      expect(perHour / (rate(level, content) * K.craftXpMult)).toBeGreaterThan(0.98);
      expect(perHour / (rate(level, content) * K.craftXpMult)).toBeLessThan(1.02);
      for (const i of recipe.ingredients) expect(s.bank[i.item]).toBe(BIG - crafts * i.n);
      const made = s.bank[recipe.output.item] ?? 0;
      expect(made).toBeGreaterThanOrEqual(crafts * recipe.output.n);
      expect(made).toBeLessThanOrEqual(crafts * (recipe.output.n + 1));
    }
  });

  it('A4: mastery tier 3 gives one bonus unit in half the crafts', () => {
    const s = genin();
    const recipe = content.recipes.find((r) => r.id === ANTIDOTE);
    if (!recipe) throw new Error('no recipe');
    const [, , third] = K.craftRules.masteryTiers;
    withMastery(s, ANTIDOTE, third ?? 0);
    for (const i of recipe.ingredients) s.bank[i.item] = BIG;
    const crafts = 5000;
    ok(s, craft(ANTIDOTE));
    advance(s, crafts * K.craft * 1000, content, plainRules);
    expect(s.counters['actions.craft']).toBe(crafts);
    const bonus = (s.bank[recipe.output.item] ?? 0) - crafts * recipe.output.n;
    expect(bonus / crafts).toBeGreaterThan(0.5 - 0.03);
    expect(bonus / crafts).toBeLessThan(0.5 + 0.03);
  });

  it('gives no bonus at tier 1 and 25% / 75% at tiers 2 / 4', () => {
    const [, second, , fourth] = K.craftRules.masteryTiers;
    const rateAt = (mastery: number | null, crafts: number) => {
      const s = genin(7);
      if (mastery !== null) withMastery(s, ANTIDOTE, mastery);
      s.bank[MINT] = BIG;
      s.bank['core:water'] = BIG;
      ok(s, craft(ANTIDOTE));
      advance(s, crafts * K.craft * 1000, content, plainRules);
      return ((s.bank[ANTIDOTE] ?? 0) - crafts * 2) / crafts;
    };
    expect(rateAt(null, 100)).toBe(0);
    expect(rateAt(second ?? 0, 4000)).toBeCloseTo(K.craftRules.bonusPerTier, 1);
    expect(rateAt(fourth ?? 0, 4000)).toBeCloseTo(3 * K.craftRules.bonusPerTier, 1);
  });

  it('A4: alembic tier 2 keeps the ingredients in 6% of the crafts', () => {
    const s = genin();
    s.gear[ALEMBIC] = 2;
    s.bank[MINT] = BIG;
    s.bank['core:water'] = BIG;
    const crafts = 10_000;
    ok(s, craft(ANTIDOTE));
    advance(s, crafts * K.craft * 1000, content, plainRules);
    expect(s.counters['actions.craft']).toBe(crafts);
    const used = (BIG - (s.bank[MINT] ?? 0)) / 2;
    const kept = 1 - used / crafts;
    expect(kept).toBeGreaterThan(2 * K.gearFx.alembic - 0.015);
    expect(kept).toBeLessThan(2 * K.gearFx.alembic + 0.015);
    // The water was kept in exactly the same crafts.
    expect(BIG - (s.bank['core:water'] ?? 0)).toBe(used);
  });

  it('is sped up by the Provisions stations', () => {
    const s = genin();
    s.gear['core:stantsii_proviantu'] = 1;
    stocked(s, { 'core:rice': 20, 'core:salt': 10 });
    ok(s, craft('core:onihiri'));
    const interval = Math.round((K.craft * 1000) / (1 + K.gearFx.stations));
    advance(s, interval, content, plainRules);
    expect(s.counters['actions.craft']).toBe(1);
  });

  it('A5: stops by itself and names the missing item when the ingredients run out', () => {
    const s = genin();
    stocked(s, { [MINT]: 4, 'core:water': 5 });
    ok(s, craft(ANTIDOTE));
    advance(s, 60_000, content, plainRules);
    expect(s.counters['actions.craft']).toBe(2);
    expect(s.slots[0]?.action).toBeNull();
    expect(stops(s)).toContainEqual(
      expect.objectContaining({
        reason: 'requirements',
        kind: 'craft',
        id: ANTIDOTE,
        missing: MINT,
      }),
    );
    const w = genin();
    stocked(w, { [MINT]: 40, 'core:water': 1 });
    ok(w, craft(ANTIDOTE));
    advance(w, 60_000, content, plainRules);
    expect(stops(w)).toContainEqual(expect.objectContaining({ missing: 'core:water' }));
  });

  it('A5: refuses to start without the ingredients, with a reason', () => {
    const s = genin();
    refused(s, craft(ANTIDOTE), 'error.missingIngredient');
    stocked(s, { [MINT]: 2 });
    refused(s, craft(ANTIDOTE), 'error.missingIngredient');
    expect(s.slots[0]?.action).toBeNull();
    setLevel(s, 'alch', 1);
    const high = genin();
    stocked(high, { 'core:nettle': 2, 'core:oil': 1 });
    refused(high, craft(OINTMENT), 'error.requirementsNotMet');
  });
});

describe('A2: determinism and split-invariance', () => {
  const CHUNKS = [1, 7, 999, 3600];
  const TOTAL = 60_000;
  const scenario = (share: number) => {
    const s = genin(3);
    if (share < 1000) s.slots.push({ action: null, progress: 0, share: 0, data: null });
    stocked(s, { [MINT]: 4, 'core:water': 2 });
    ok(s, gather(MINT, 0));
    if (share < 1000) ok(s, craft(ANTIDOTE, 1));
    return s;
  };
  for (const share of [1000, 500]) {
    it(`share ${share}: gather (with a regrow) and a craft that runs out`, () => {
      const whole = scenario(share);
      advance(whole, TOTAL, content, plainRules);
      const expected = serialize(whole);
      // The run really covered a regrow and a stop for lack of ingredients.
      expect(whole.bank[MINT] ?? 0).toBeGreaterThan(0);
      if (share < 1000) expect(whole.slots[1]?.action).toBeNull();
      expect(serialize(scenario(share))).toBe(serialize(scenario(share)));
      for (const chunk of CHUNKS) {
        const s = scenario(share);
        for (let left = TOTAL; left > 0; left -= chunk)
          advance(s, Math.min(chunk, left), content, plainRules);
        expect(serialize(s)).toBe(expected);
      }
    });
  }

  it('covers a bush regrow in the one-slot run', () => {
    const s = scenario(1000);
    advance(s, TOTAL, content, plainRules);
    const herbs = s.bank[MINT] ?? 0;
    // Without any pause the 60 s run would hold 24 + 4 herbs.
    expect(herbs).toBeLessThan(4 + TOTAL / (K.gather * 1000) - 1);
  });
});

describe('A6: tonics', () => {
  const med = content.practices[0]?.id ?? '';
  const baseXp = (rate(1, content) * K.meditate) / 3600;

  it('gives +5% XP for exactly 40 completed actions of the skill, then returns to 1x', () => {
    const s = genin();
    s.bank[CLEAR_MIND] = 1;
    ok(s, { type: 'item.use', id: CLEAR_MIND });
    expect(s.bank[CLEAR_MIND]).toBeUndefined();
    expect(s.buffs[CLEAR_MIND]).toEqual({ skill: 'med', charges: 40 });
    const parts = getMod(s, 'xp.skill.med', content).parts;
    expect(parts).toEqual([
      expect.objectContaining({ source: { kind: 'item', id: CLEAR_MIND }, value: 0.05 }),
    ]);
    ok(s, start('meditate', med));
    const gains: number[] = [];
    for (let i = 0; i < 42; i++) {
      const before = s.skills.med.xp;
      advance(s, K.meditate * 1000, content, plainRules);
      gains.push(s.skills.med.xp - before);
    }
    for (let i = 0; i < 40; i++) expect(gains[i]).toBeCloseTo(baseXp * 1.05, 6);
    expect(gains[40]).toBeCloseTo(baseXp, 6);
    expect(gains[41]).toBeCloseTo(baseXp, 6);
    expect(s.buffs[CLEAR_MIND]).toBeUndefined();
    expect(getMod(s, 'xp.skill.med', content).parts).toEqual([]);
  });

  it('adds charges up to twice one tonic and refuses a tonic beyond the cap', () => {
    const s = genin();
    s.bank[CLEAR_MIND] = 3;
    ok(s, { type: 'item.use', id: CLEAR_MIND });
    ok(s, { type: 'item.use', id: CLEAR_MIND });
    expect(s.buffs[CLEAR_MIND]?.charges).toBe(80);
    refused(s, { type: 'item.use', id: CLEAR_MIND }, 'error.tonicFull');
    expect(s.bank[CLEAR_MIND]).toBe(1);
    // A part of the cap left: the tonic is drunk and the charges stop at the cap.
    s.buffs[CLEAR_MIND] = { skill: 'med', charges: 60 };
    ok(s, { type: 'item.use', id: CLEAR_MIND });
    expect(s.buffs[CLEAR_MIND]?.charges).toBe(80);
  });

  it('does not spend charges on actions of other skills', () => {
    const s = genin();
    s.bank[CLEAR_MIND] = 1;
    ok(s, { type: 'item.use', id: CLEAR_MIND });
    ok(s, start('practice', 'core:leaf_whirlwind'));
    advance(s, 30_000, content, plainRules);
    expect(s.counters['actions.practice']).toBeGreaterThan(5);
    expect(s.buffs[CLEAR_MIND]?.charges).toBe(40);
    expect(getMod(s, 'xp.skill.tai', content).parts).toEqual([]);
  });

  it('the elements tonic covers each of the five natures and spends a charge per action', () => {
    const s = genin();
    withNatures(s, 'katon', 'futon', 'raiton');
    const tonic = 'core:tonik_stykhii';
    s.bank[tonic] = 1;
    ok(s, { type: 'item.use', id: tonic });
    for (const nature of ['katon', 'futon', 'raiton', 'doton', 'suiton']) {
      const fromTonic = getMod(s, `xp.skill.${nature}`, content).parts.filter(
        (p) => typeof p.source !== 'string' && p.source.kind === 'item',
      );
      expect(fromTonic).toHaveLength(1);
    }
    expect(getMod(s, 'xp.skill.tai', content).parts).toHaveLength(0);
    refreshUnlocks(s, content, true);
    ok(s, start('practice', 'core:nature_transformation_burn_a_leaf'));
    advance(s, 20_000, content, plainRules);
    const done = s.counters['actions.practice'] ?? 0;
    expect(done).toBeGreaterThan(0);
    expect(s.buffs[tonic]?.charges).toBe(40 - done);
  });

  it('refuses items that cannot be used and tonics that are not in the bank', () => {
    const s = genin();
    refused(s, { type: 'item.use', id: CLEAR_MIND }, 'error.noItem');
    s.bank[MINT] = 1;
    refused(s, { type: 'item.use', id: MINT }, 'error.itemNotUsable');
  });
});

describe('A7: coating', () => {
  const POISON = 'core:nervova_otruta';
  const SENBON = 'core:senbon';
  const cmd = (poison: string, base: string): Command => ({ type: 'item.coat', poison, base });

  it('turns one poison and 15 senbon into 15 coated senbon, per the content data', () => {
    const coat = content.coat.find((c) => c.poison === POISON);
    const product = content.items.find((i) => i.id === coat?.product);
    expect(product?.madeFrom).toEqual([
      { item: SENBON, n: 15 },
      { item: POISON, n: 1 },
    ]);
    const s = genin();
    stocked(s, { [POISON]: 2, [SENBON]: 20 });
    ok(s, cmd(POISON, SENBON));
    expect(s.bank).toEqual({ [POISON]: 1, [SENBON]: 5, 'core:psenbon': 15 });
    const para = genin();
    stocked(para, { 'core:paralitychna_otruta': 1, [SENBON]: 15 });
    ok(para, cmd('core:paralitychna_otruta', SENBON));
    expect(para.bank).toEqual({ 'core:parsenbon': 15 });
  });

  it('refuses when an input is missing or the pair is not a coating, changing nothing', () => {
    const s = genin();
    stocked(s, { [POISON]: 1, [SENBON]: 14 });
    refused(s, cmd(POISON, SENBON), 'error.missingIngredient');
    stocked(s, { [SENBON]: 1 });
    refused(s, cmd(POISON, 'core:kunai'), 'error.invalidCoat');
    refused(s, cmd(MINT, SENBON), 'error.invalidCoat');
    expect(s.bank).toEqual({ [POISON]: 1, [SENBON]: 15 });
    const bare = genin();
    stocked(bare, { [SENBON]: 15 });
    refused(bare, cmd(POISON, SENBON), 'error.missingIngredient');
  });
});

describe('A8: shops', () => {
  it('buying deducts ryo and adds the items', () => {
    const s = genin();
    s.currencies.ryo = 500;
    ok(s, { type: 'shop.buy', item: 'core:rice', n: 10 });
    expect(s.currencies.ryo).toBe(500 - 10 * (K.goods.rice ?? 0));
    expect(s.bank['core:rice']).toBe(10);
    ok(s, { type: 'shop.buy', item: 'core:senbon', n: 15 });
    expect(s.bank['core:senbon']).toBe(15);
  });

  it('refuses without ryo, before genin, for goods not on sale and for bad amounts', () => {
    const s = genin();
    s.currencies.ryo = 5;
    refused(s, { type: 'shop.buy', item: 'core:rice', n: 2 }, 'error.notEnoughRyo');
    expect(s.currencies.ryo).toBe(5);
    refused(s, { type: 'shop.buy', item: MINT, n: 1 }, 'error.notForSale');
    refused(s, { type: 'shop.buy', item: 'core:rice', n: 0 }, 'error.invalidAmount');
    refused(s, { type: 'shop.buy', item: 'core:rice', n: 1.5 }, 'error.invalidAmount');
    const student = createState(1, content);
    student.currencies.ryo = 500;
    refused(student, { type: 'shop.buy', item: 'core:rice', n: 1 }, 'error.requirementsNotMet');
    expect(student.currencies.ryo).toBe(500);
  });

  it('sells trophies and craft products, and refuses the rest', () => {
    const s = genin();
    stocked(s, { 'core:pelt': 3, [OINTMENT]: 4, 'core:kunai': 2, [MINT]: 2 });
    ok(s, { type: 'shop.sell', item: 'core:pelt', n: 2 });
    expect(s.currencies.ryo).toBe(2 * K.sell.pelt);
    expect(s.bank['core:pelt']).toBe(1);
    const ointment = (2 * (K.shop.herbBase + 5 * K.shop.herbPerLevel) + (K.goods.oil ?? 0)) / 2;
    expect(sellPrice(OINTMENT, content)).toBe(Math.floor(ointment * K.shop.craftSellFactor));
    const before = s.currencies.ryo;
    ok(s, { type: 'shop.sell', item: OINTMENT, n: 4 });
    expect(s.currencies.ryo).toBe(before + 4 * (sellPrice(OINTMENT, content) ?? 0));
    refused(s, { type: 'shop.sell', item: 'core:kunai', n: 1 }, 'error.notSellable');
    refused(s, { type: 'shop.sell', item: MINT, n: 1 }, 'error.notSellable');
    refused(s, { type: 'shop.sell', item: 'core:pelt', n: 5 }, 'error.noItem');
    refused(s, { type: 'shop.sell', item: 'core:fang', n: 1 }, 'error.noItem');
    expect(s.bank['core:kunai']).toBe(2);
  });

  it('never pays more for a purchase-only product than its ingredients cost, bonus units included', () => {
    const herbs = new Set(content.herbs.map((h) => h.id));
    const bonus = (K.craftRules.masteryTiers.length - 1) * K.craftRules.bonusPerTier;
    let checked = 0;
    for (const r of content.recipes) {
      if (r.ingredients.some((i) => herbs.has(i.item))) continue;
      const cost = r.ingredients.reduce(
        (sum, i) => sum + (buyPrice(i.item, content) ?? 0) * i.n,
        0,
      );
      const price = sellPrice(r.output.item, content) ?? 0;
      expect(price, r.id).toBeGreaterThanOrEqual(1);
      expect(price * (r.output.n + bonus), r.id).toBeLessThan(cost);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('does not buy herbs', () => {
    for (const h of content.herbs) expect(sellPrice(h.id, content)).toBeNull();
  });
});

describe('A9: training gear', () => {
  it('needs the previous tier, the skill level and the price', () => {
    const s = genin();
    s.currencies.ryo = 10_000;
    refused(s, { type: 'gear.buy', line: 'core:ghost' }, 'error.unknownGear');
    ok(s, { type: 'gear.buy', line: SICKLE });
    expect(s.gear[SICKLE]).toBe(1);
    expect(s.currencies.ryo).toBe(10_000 - (K.gearTier[0] ?? 0));
    refused(s, { type: 'gear.buy', line: SICKLE }, 'error.requirementsNotMet');
    setLevel(s, 'herb', 30);
    ok(s, { type: 'gear.buy', line: SICKLE });
    expect(s.gear[SICKLE]).toBe(2);
    expect(s.currencies.ryo).toBe(10_000 - (K.gearTier[0] ?? 0) - (K.gearTier[1] ?? 0));
    refused(s, { type: 'gear.buy', line: SICKLE }, 'error.gearMaxed');
  });

  it('refuses without ryo and treats building requirements as met until buildings exist', () => {
    const s = genin();
    setLevel(s, 'tai', 50);
    s.currencies.ryo = 299;
    refused(s, { type: 'gear.buy', line: 'core:trenuvalni_manekeny' }, 'error.notEnoughRyo');
    s.currencies.ryo = 10_000;
    for (let i = 0; i < 3; i++) ok(s, { type: 'gear.buy', line: 'core:trenuvalni_manekeny' });
    // Tier III names the Forge, level 4; no building exists, and it still opens.
    expect(s.gear['core:trenuvalni_manekeny']).toBe(3);
    expect(
      content.gear.find((g) => g.id === 'core:trenuvalni_manekeny')?.tiers[2]?.building,
    ).toEqual({ id: 'core:forge', level: 4 });
  });

  it('each owned tier contributes its modifier, with the gear line as source', () => {
    const s = genin();
    s.gear['core:trenuvalni_manekeny'] = 2;
    s.gear[SICKLE] = 1;
    s.gear[ALEMBIC] = 2;
    s.gear['core:stantsii_proviantu'] = 2;
    s.gear['core:karty_i_kompas'] = 1;
    const mod = (key: string) => getMod(s, key, content);
    expect(mod('xp.skill.tai').total).toBeCloseTo(1 + 2 * K.gearFx.mannequin, 12);
    expect(mod('xp.skill.tai').parts[0]?.source).toEqual({
      kind: 'gear',
      id: 'core:trenuvalni_manekeny',
    });
    expect(mod('interval.skill.herb').total).toBeCloseTo(1 - K.gearFx.sickle, 12);
    expect(mod('craft.keep.alch').total).toBeCloseTo(1 + 2 * K.gearFx.alembic, 12);
    expect(mod('interval.skill.prov').total).toBeCloseTo(1 / (1 + 2 * K.gearFx.stations), 12);
    expect(mod('interval.explore').total).toBeCloseTo(1 - K.gearFx.maps, 12);
  });

  it('the mannequins raise Taijutsu XP', () => {
    const plain = genin();
    const geared = genin();
    geared.gear['core:trenuvalni_manekeny'] = 3;
    for (const s of [plain, geared]) {
      ok(s, start('practice', 'core:leaf_whirlwind'));
      advance(s, 60_000, content, plainRules);
    }
    expect(geared.skills.tai.xp / plain.skills.tai.xp).toBeCloseTo(1 + 3 * K.gearFx.mannequin, 6);
  });
});

describe('A11: a scripted run from genin with 500 ryo', () => {
  it('gathers, buys the missing goods and crafts 10 ointments and 5 clear-mind tonics', () => {
    const s = genin();
    s.currencies.ryo = 500;
    const buy = (item: string, n: number) => ok(s, { type: 'shop.buy', item, n });
    const run = (cmd: Command, ms: number) => {
      ok(s, cmd);
      advance(s, ms, content, plainRules);
    };
    // Herbs for everything, then the water, oil, rice and salt the herbs do not cover.
    run(gather(MINT), 15 * 60_000);
    buy('core:water', 60);
    buy('core:oil', 10);
    buy('core:rice', 60);
    buy('core:salt', 30);
    // Practice the two crafts up to their level 5 recipes.
    run(craft(ANTIDOTE), 90_000);
    run(craft('core:onihiri'), 90_000);
    expect(s.skills.alch.xp).toBeGreaterThanOrEqual(xpAt(5));
    expect(s.skills.prov.xp).toBeGreaterThanOrEqual(xpAt(5));
    run(gather(NETTLE), 120_000);
    run(craft(OINTMENT), 6 * K.craft * 1000);
    run(craft(CLEAR_MIND), 6 * K.craft * 1000);
    expect(s.bank[OINTMENT] ?? 0).toBeGreaterThanOrEqual(10);
    expect(s.bank[CLEAR_MIND] ?? 0).toBeGreaterThanOrEqual(5);
    expect(s.currencies.ryo).toBeGreaterThanOrEqual(0);
  });
});

describe('A12: saving', () => {
  it('round-trips buffs, gear, a bush and a crafting slot byte for byte', () => {
    const s = genin();
    refreshUnlocks(s, content, true);
    s.bank[CLEAR_MIND] = 1;
    stocked(s, { [MINT]: 50, 'core:water': 50 });
    s.gear[SICKLE] = 1;
    ok(s, { type: 'item.use', id: CLEAR_MIND });
    ok(s, gather(MINT));
    advance(s, 20_000, content, plainRules);
    const text = serialize(s, 5);
    const back = deserialize(text, content);
    expect(serialize(back, 5)).toBe(text);
    expect(back.buffs).toEqual(s.buffs);
    expect(back.gear).toEqual({ [SICKLE]: 1 });
    expect(back.bushes).toEqual(s.bushes);
    advance(s, 30_000, content, plainRules);
    advance(back, 30_000, content, plainRules);
    expect(serialize(back)).toBe(serialize(s));
  });

  it('migrates a version 4 save: no buffs and no gear', () => {
    expect(MIGRATIONS.length).toBe(STATE_VERSION - 1);
    const old = JSON.parse(serialize(genin(), 5));
    old.v = 4;
    old.state.v = 4;
    delete old.state.buffs;
    delete old.state.gear;
    const state = deserialize(JSON.stringify(old), content);
    expect(state.v).toBe(STATE_VERSION);
    expect(state.buffs).toEqual({});
    expect(state.gear).toEqual({});
  });

  it('drops unknown buffs and gear and clamps charges and tiers', () => {
    const raw = JSON.parse(serialize(genin()));
    raw.state.buffs = {
      [CLEAR_MIND]: { skill: 'tai', charges: 9999 },
      'core:ghost': { skill: 'tai', charges: 5 },
      [MINT]: { skill: 'med', charges: 5 },
      'core:tonik_kontsentratsii': { skill: 'cc', charges: 0 },
    };
    raw.state.gear = { [SICKLE]: 99, 'core:ghost': 1, [ALEMBIC]: -2 };
    raw.state.slots = [
      {
        action: { kind: 'gather', id: MINT },
        progress: 5,
        share: 1000,
        data: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
      },
      {
        action: { kind: 'craft', id: ANTIDOTE },
        progress: 0,
        share: 0,
        data: { fine: [1, 'two', null] },
      },
    ];
    raw.state.bushes = {
      [MINT]: { stock: 1e9, size: 1e9, carry: 5 },
      'core:ghost': { stock: 1, size: 2, carry: 0 },
      [NETTLE]: { stock: 0, size: 3, carry: 1e18 },
      'core:hogweed': { stock: 9, size: 3, carry: 4 },
    };
    const state = deserialize(JSON.stringify(raw), content);
    expect(state.buffs).toEqual({ [CLEAR_MIND]: { skill: 'med', charges: 80 } });
    expect(state.gear).toEqual({ [SICKLE]: 2 });
    expect(state.slots[0]?.data).toBeNull();
    expect(state.slots[1]?.data).toEqual({ fine: [1, 'two', null] });
    const room = (K.field.regrowMs + K.gather * 1000) * 1000;
    expect(state.bushes).toEqual({
      [NETTLE]: { stock: 0, size: 3, carry: room },
      'core:hogweed': { stock: 3, size: 3, carry: 0 },
    });
    ok(state, { type: 'action.stop', slot: 1 });
    ok(state, gather(MINT));
    const size = K.field.stockBase + 1;
    advance(state, K.gather * 1000 * size, content, plainRules);
    expect(state.bank[MINT]).toBe(size);
  });

  it('keeps mastery of herbs and recipes through a save', () => {
    const s = genin();
    s.mastery[MINT] = { xp: 100 };
    s.mastery[ANTIDOTE] = { xp: 50 };
    const back = deserialize(serialize(s), content);
    expect(back.mastery).toEqual(s.mastery);
  });
});
