/** Closure of the field and crafts data: products, ingredients, shops, coating, gear. */
import { describe, expect, it } from 'vitest';
import { content, ukLocale, type Req } from '../src/index.ts';

const K = content.balance.K;
const items = new Map(content.items.map((i) => [i.id, i]));
const itemName = (id: string) => ukLocale[`item.${id}.name`] ?? id;

describe('A10: recipe outputs', () => {
  it('every recipe output is an item with a structured effect', () => {
    for (const r of content.recipes) {
      const item = items.get(r.output.item);
      expect(item, `${r.id}: output item`).toBeDefined();
      expect(item?.fx, `${r.id}: effect`).toBeDefined();
    }
  });

  it('every effect is used by an item and every effect belongs to a recipe output or a product', () => {
    const outputs = new Set(content.recipes.map((r) => r.output.item));
    // The crate and the notes come from missions, not from a recipe.
    const fromMissions = new Set(['crate', 'bingoNote']);
    for (const i of content.items) {
      if (i.fx && !fromMissions.has(i.fx.kind)) expect(outputs.has(i.id), i.id).toBe(true);
    }
  });

  it('tonics follow the design: +5% for 40 actions, one per skill and one for the natures', () => {
    const tonics = content.items.flatMap((i) => (i.fx?.kind === 'tonic' ? [i.fx] : []));
    expect(tonics.map((t) => t.skill).sort()).toEqual(['allNatures', 'ath', 'cc', 'med']);
    for (const t of tonics) {
      expect(t.xpBonus).toBe(0.05);
      expect(t.charges).toBe(40);
    }
  });

  it('covers the effects the combat stage will use', () => {
    const kinds = new Set(content.items.map((i) => i.fx?.kind));
    for (const kind of [
      'heal',
      'restore',
      'cleanse',
      'dispel',
      'woundHeal',
      'bomb',
      'sleep',
      'tonic',
      'ration',
      'poison',
    ]) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
  });

  it('the dispel item answers the dispel tag it carries', () => {
    for (const i of content.items) {
      if (i.fx?.kind === 'dispel') expect(i.tags).toContain(i.fx.tag);
      if (i.fx?.kind === 'poison') expect(i.tags).toContain(i.fx.tag);
    }
  });
});

describe('A10: every ingredient is obtainable', () => {
  const herbs = new Set(content.herbs.map((h) => h.id));
  const shop = new Set(content.shop.map((s) => s.item));
  const paid = new Set(
    content.missions.flatMap((m) => m.pay.flatMap((p) => (p.kind === 'item' ? [p.item] : []))),
  );
  const dropped = new Set(
    [...content.enemies, ...content.bosses].flatMap((e) => e.drops.map((d) => d.item)),
  );
  const crafted = new Set(content.recipes.map((r) => r.output.item));
  const crate = new Set(content.items.filter((i) => i.extraSources.length > 0).map((i) => i.id));

  it('every recipe ingredient is a herb, a shop good, a mission payment, a drop or a product', () => {
    for (const r of content.recipes) {
      for (const i of r.ingredients) {
        const got =
          herbs.has(i.item) ||
          shop.has(i.item) ||
          paid.has(i.item) ||
          dropped.has(i.item) ||
          crafted.has(i.item) ||
          crate.has(i.item);
        expect(got, `${r.id}: ${itemName(i.item)} has no source`).toBe(true);
      }
    }
  });

  it('every ingredient a shop could be asked for is sold by it or grows in the field', () => {
    for (const r of content.recipes) {
      for (const i of r.ingredients) {
        expect(herbs.has(i.item) || shop.has(i.item), `${r.id}: ${itemName(i.item)}`).toBe(true);
      }
    }
  });
});

describe('A10: shops and prices', () => {
  it('every shop item has a price in the balance goods table', () => {
    for (const s of content.shop) {
      const key = items.get(s.item)?.buy;
      expect(key, `${s.item}: buy key`).toBeDefined();
      expect(K.goods[key ?? ''], `${s.item}: price`).toBeGreaterThan(0);
    }
  });

  it('every shop entry names Genin and a building; market goods come from the market table', () => {
    const flat = (r: Req): Req[] => (r.t === 'all' || r.t === 'any' ? r.of.flatMap(flat) : [r]);
    for (const s of content.shop) {
      const leaves = flat(s.req);
      expect(leaves).toContainEqual({ t: 'rank', rank: 'genin' });
      expect(leaves.some((l) => l.t === 'building')).toBe(true);
    }
    for (const m of content.market) expect(content.shop.some((s) => s.item === m.item)).toBe(true);
  });

  it('every item with a buy key is on sale, so no price is orphaned', () => {
    for (const i of content.items) {
      if (i.buy)
        expect(
          content.shop.some((s) => s.item === i.id),
          i.id,
        ).toBe(true);
    }
  });
});

describe('coating', () => {
  it('each entry pairs a poison item with a base and a product made from exactly those', () => {
    for (const c of content.coat) {
      expect(items.get(c.poison)?.fx?.kind, c.poison).toBe('poison');
      const product = items.get(c.product);
      expect(product?.madeFrom.map((m) => m.item).sort()).toEqual([c.base, c.poison].sort());
      expect(product?.tags).toContain(items.get(c.poison)?.tags[0]);
    }
  });
});

describe('herbs and gear', () => {
  it('rare herbs ask for Chakra Control', () => {
    const req = (id: string) => content.herbs.find((h) => h.id === id)?.req;
    expect(req('core:edelweiss')).toEqual({ t: 'skill', skill: 'cc', level: 15 });
    expect(req('core:lotus')).toEqual({ t: 'skill', skill: 'cc', level: 30 });
    expect(content.herbs.filter((h) => h.req)).toHaveLength(2);
  });

  it('every gear line has an effect whose per-tier size is in the balance', () => {
    for (const g of content.gear) {
      expect(K.gearFx[g.fx.perTier], g.id).toBeGreaterThan(0);
      expect(g.tiers.length, g.id).toBeLessThanOrEqual(K.gearTier.length);
    }
  });
});
