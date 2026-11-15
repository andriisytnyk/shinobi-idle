/** Closure of the combat preparation data: the AI tiers, the loadout and pouch numbers, the medic pouch, the operations' clear flags. */
import { describe, expect, it } from 'vitest';
import { BALANCE_OVERRIDE, withOverrides } from '../src/packs/core/balance-ext.ts';
import { AI_RULE_IDS, content, TRAIT_IDS } from '../src/index.ts';

const K = content.balance.K;

describe('the AI tiers', () => {
  it('has a genin and a chunin tier, each with numbers in the balance object', () => {
    expect(content.ai.tiers.map((t) => t.id).sort()).toEqual(['chunin', 'genin']);
    for (const tier of content.ai.tiers) {
      expect(
        tier.rules.every((r) => AI_RULE_IDS.includes(r)),
        tier.id,
      ).toBe(true);
      // The last resort is always there, so the AI always has a decision.
      expect(tier.rules[tier.rules.length - 1], tier.id).toBe('basic');
    }
  });

  it('starts at the lowest player tier; only the genin needs a reaction delay', () => {
    const genin = content.ai.tiers.find((t) => t.id === 'genin');
    const chunin = content.ai.tiers.find((t) => t.id === 'chunin');
    expect(genin?.minTier).toBe(0);
    expect(chunin?.minTier).toBe(2);
    expect(genin?.reaction).toBe(true);
    expect(chunin?.reaction).toBe(false);
    expect(K.ai.geninReactionMs).toBeGreaterThan(0);
  });

  it('names only real traits as visible', () => {
    for (const trait of content.ai.visibleTraits) expect(TRAIT_IDS).toContain(trait);
    expect(content.ai.visibleTraits).toEqual(['armor', 'pack']);
  });
});

describe('the preparation numbers', () => {
  it('gives the loadout 4 and 5 slots, 1 and 2 natures, 5 saved sets and a Mastery 25 signature', () => {
    expect(K.loadout).toMatchObject({
      slots: { genin: 4, chunin: 5 },
      natures: { genin: 1, chunin: 2 },
      saved: 5,
    });
    expect(K.signature.minMastery).toBe(25);
    expect(K.signatureHabituation).toBeLessThan(1);
  });

  it('gives the pouch 3 slots and one more with the vest, and the stack its cap', () => {
    expect(K.pouch).toMatchObject({ slots: 3, vest: 1 });
    expect(K.pouchStack).toBe(4);
  });

  it('keeps the Wound numbers of the balance tables', () => {
    expect(K.wound).toEqual({ stat: 0.05, max: 4, healMin: 10, healFloorMin: 2.5 });
    expect(K.woundHp).toBe(0.1);
  });

  it('has a medic pouch among the shop tools', () => {
    const medic = content.items.filter((i) => i.medic !== undefined);
    expect(medic.map((i) => i.id)).toEqual(['core:medpouch']);
    // It comes with the rank of Genin, not from a shop.
    expect(content.shop.some((s) => s.item === 'core:medpouch')).toBe(false);
    const exam = content.exams.find((e) => e.rank === 'genin');
    expect(exam?.rewards.items.some((i) => i.item === 'core:medpouch')).toBe(true);
  });

  it('gives each operation its own first-clear flag', () => {
    const flags = content.operations.map((o) => o.clearFlag);
    expect(new Set(flags).size).toBe(content.operations.length);
    for (const flag of flags) expect(flag).toMatch(/^op\.[a-z_]+\.cleared$/);
  });

  it('has the numbers every boss special needs, and no special without a hook or a marker', () => {
    for (const boss of content.bosses) expect(K.bossFx).toHaveProperty(boss.special.fx);
    expect(K.bossFx.wolfPack.count).toBe(4);
    expect(K.bossFx.illusion.fleeAtHp).toBe(0.3);
  });
});

describe('the balance overrides', () => {
  it('win over the imported value, and are the values the content carries', () => {
    expect(Object.keys(BALANCE_OVERRIDE)).toEqual(['zoneHpRegen']);
    for (const [key, value] of Object.entries(BALANCE_OVERRIDE)) {
      expect((K as unknown as Record<string, unknown>)[key], key).toBe(value);
    }
    // The documented value is lower: the override is what makes the difference.
    expect(withOverrides({ zoneHpRegen: 0.35 }, BALANCE_OVERRIDE).zoneHpRegen).toBe(0.8);
  });

  it('fail for a key that is not a parameter, so a typo cannot shadow nothing', () => {
    expect(() => withOverrides({ zoneHpRegen: 0.35 }, { zoneHpRegn: 1 })).toThrow(/zoneHpRegn/);
    for (const key of Object.keys(BALANCE_OVERRIDE)) expect(Object.hasOwn(K, key)).toBe(true);
  });
});
