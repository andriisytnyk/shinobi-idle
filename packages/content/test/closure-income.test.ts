/**
 * Selling craft products is a modest side income, not a replacement for missions (D missions pay
 * 720 ryo per hour). The best full loop - gather the herbs, buy the rest, craft, sell - is computed
 * from the data and the balance formulas for a level-appropriate player.
 */
import { describe, expect, it } from 'vitest';
import { content } from '../src/index.ts';

const K = content.balance.K;
const herbs = new Map(content.herbs.map((h) => [h.id, h]));
const items = new Map(content.items.map((i) => [i.id, i]));

const buyPrice = (id: string): number | null => {
  const key = items.get(id)?.buy;
  return key === undefined ? null : (K.goods[key] ?? null);
};
const unitValue = (id: string): number => {
  const herb = herbs.get(id);
  return herb ? K.shop.herbBase + K.shop.herbPerLevel * herb.level : (buyPrice(id) ?? 0);
};
/** The sell rule: a share of the ingredient value per unit made, at least 1 ryo. */
const sellPrice = (recipe: (typeof content.recipes)[number]): number => {
  const value = recipe.ingredients.reduce((sum, i) => sum + unitValue(i.item) * i.n, 0);
  return Math.max(1, Math.floor((value / recipe.output.n) * K.shop.craftSellFactor));
};

/** Seconds to gather one herb at mastery level 1: its own cycle, the regrow pause shared over the bush. */
const gatherSecondsOf = (herb: { cycle?: number | undefined }): number =>
  (herb.cycle ?? K.gather) + K.field.regrowMs / 1000 / (K.field.stockBase + 1);

interface Loop {
  recipe: string;
  /** Ryo per hour of total time (gathering plus crafting). */
  perHour: number;
}

/** The most profitable recipe a player of skill level `level` can run as a full loop. */
function bestLoop(level: number, bonusUnits: number): Loop {
  let best: Loop = { recipe: '', perHour: -Infinity };
  for (const r of content.recipes) {
    if (r.level > level) continue;
    const mine = r.ingredients.filter((i) => herbs.has(i.item));
    if (mine.some((i) => (herbs.get(i.item)?.level ?? Infinity) > level)) continue;
    const bought = r.ingredients
      .filter((i) => !herbs.has(i.item))
      .reduce((sum, i) => sum + (buyPrice(i.item) ?? Infinity) * i.n, 0);
    const seconds =
      K.craft + mine.reduce((sum, i) => sum + i.n * gatherSecondsOf(herbs.get(i.item) ?? {}), 0);
    const profit = sellPrice(r) * (r.output.n + bonusUnits) - bought;
    const perHour = (profit / seconds) * 3600;
    if (perHour > best.perHour) best = { recipe: r.id, perHour };
  }
  return best;
}

describe('selling craft products is a modest side income', () => {
  for (const level of [10, 30, 50]) {
    it(`level ${level}: the best loop earns 400 to 900 ryo per hour`, () => {
      const loop = bestLoop(level, 0);
      expect(loop.perHour).toBeGreaterThanOrEqual(400);
      expect(loop.perHour).toBeLessThanOrEqual(900);
    });
  }

  it('stays under the D mission income even at the highest crafting mastery tier', () => {
    const missionPerHour = (K.ryoPerMin.D ?? 0) * 60;
    const bonus = (K.craftRules.masteryTiers.length - 1) * K.craftRules.bonusPerTier;
    for (const level of [10, 30, 50]) {
      expect(bestLoop(level, bonus).perHour).toBeLessThan(missionPerHour * 1.5);
    }
  });

  it('no loop made only of purchases is profitable, even with the most bonus units', () => {
    const bonus = (K.craftRules.masteryTiers.length - 1) * K.craftRules.bonusPerTier;
    let checked = 0;
    for (const r of content.recipes) {
      if (r.ingredients.some((i) => herbs.has(i.item))) continue;
      const cost = r.ingredients.reduce((sum, i) => sum + (buyPrice(i.item) ?? Infinity) * i.n, 0);
      expect(sellPrice(r) * (r.output.n + bonus), r.id).toBeLessThan(cost);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('herbs and goods are not sold: only trophies and craft products have a sell price', () => {
    const products = new Set(content.recipes.map((r) => r.output.item));
    for (const i of content.items) {
      if (herbs.has(i.id) || i.buy) expect(i.sell, i.id).toBeUndefined();
      if (i.sell) expect(products.has(i.id), i.id).toBe(false);
    }
  });
});
