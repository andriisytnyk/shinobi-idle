/** Structured modifiers: the key registry and the match between the numbers in the data and the Ukrainian texts. */
import { describe, expect, it } from 'vitest';
import {
  MODIFIER_KEYS,
  composeContent,
  corePack,
  type ContentPack,
  SKILL_IDS,
  content,
  isModifierKey,
  ukLocale,
  type Mod,
} from '../src/index.ts';

/**
 * The number a text states: `[sign, magnitude, isPercent]`. Texts without a sign that say
 * "на N% більше" ("N% more") are read as a plus. Returns null when the text has no figure that
 * this reader understands; the tests list those texts and treat each explicitly.
 */
function readFigure(text: string): { sign: 1 | -1; value: number } | null {
  const signed = /([+−-])\s*(\d+(?:,\d+)?)\s*(%?)/.exec(text);
  if (signed) {
    const n = Number(signed[2]?.replace(',', '.'));
    return { sign: signed[1] === '+' ? 1 : -1, value: signed[3] === '%' ? n / 100 : n };
  }
  const more = /на (\d+(?:,\d+)?)% більше/.exec(text);
  if (more) return { sign: 1, value: Number(more[1]?.replace(',', '.')) / 100 };
  return null;
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function expectMatches(label: string, text: string, mod: Mod): void {
  const figure = readFigure(text);
  expect(figure, `${label}: cannot read a figure from "${text}"`).not.toBeNull();
  if (!figure) return;
  expect(mod.op, label).toBe('add');
  expect(Math.sign(mod.value), `${label}: sign of ${mod.value} against "${text}"`).toBe(
    figure.sign,
  );
  expect(close(Math.abs(mod.value), figure.value), `${label}: ${mod.value} against "${text}"`).toBe(
    true,
  );
}

describe('modifier key registry', () => {
  it('describes every key in one line', () => {
    for (const [key, info] of Object.entries(MODIFIER_KEYS)) {
      expect(info.desc.length, key).toBeGreaterThan(8);
      expect(info.desc.includes('\n'), key).toBe(false);
    }
  });

  it('lists the families of every skill', () => {
    for (const skill of SKILL_IDS) {
      for (const family of ['xp.skill', 'mastery.xp.skill', 'interval.skill', 'speed.skill']) {
        expect(isModifierKey(`${family}.${skill}`), `${family}.${skill}`).toBe(true);
      }
    }
  });

  it('computes the valid keys from the composed skills', () => {
    expect(Object.hasOwn(content.modifierKeys, 'xp.skill.nope')).toBe(false);
    expect(Object.hasOwn(content.modifierKeys, 'xp.skill.tai')).toBe(true);
    expect(isModifierKey('toString')).toBe(false);
    expect(Object.keys(content.modifierKeys).sort()).toEqual(Object.keys(MODIFIER_KEYS).sort());
  });

  it('fails composition of a pack whose content carries an unknown key', () => {
    const pool = content.pools[0];
    if (!pool) throw new Error('no content');
    const bad = { key: 'made.up.key', op: 'add' as const, value: 1 };
    const pack: ContentPack = {
      ...corePack,
      data: {
        ...corePack.data,
        pools: content.pools.map((p) => (p === pool ? { ...p, mods: [bad] } : p)),
      },
    };
    expect(() => composeContent([pack])).toThrow(/pack "core".*unknown modifier key "made.up.key"/);
  });

  it('uses only registered keys in the content', () => {
    const keys = [
      ...content.pools.flatMap((p) => p.mods),
      ...content.practices.flatMap((p) => [...p.insightMods, ...p.enlightMods].flat()),
      ...content.obstacles.flatMap((o) => o.mods),
    ].map((m) => m.key);
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) expect(isModifierKey(key), key).toBe(true);
  });
});

describe('modifier data against the texts', () => {
  it('gives every 10, 25 and 50% checkpoint one modifier that matches its text, and leaves 95% text-only', () => {
    expect(content.pools).toHaveLength(52);
    for (const p of content.pools) {
      if (p.pct === 95) {
        expect(p.mods, p.id).toEqual([]);
        continue;
      }
      expect([10, 25, 50]).toContain(p.pct);
      expect(p.mods, p.id).toHaveLength(1);
      expectMatches(p.id, ukLocale[`pool.${p.id}.desc`] ?? '', p.mods[0] as Mod);
    }
  });

  it('gives every practice modifier a figure that matches its text', () => {
    expect(content.practices).toHaveLength(6);
    for (const p of content.practices) {
      expect(p.insightMods).toHaveLength(3);
      expect(p.enlightMods).toHaveLength(3);
      p.insightMods.forEach((mods, i) => {
        expect(mods).toHaveLength(1);
        expectMatches(
          `${p.id} insight ${i}`,
          ukLocale[`practice.${p.id}.insight.${i}`] ?? '',
          mods[0] as Mod,
        );
      });
      p.enlightMods.forEach((mods, i) => {
        expect(mods).toHaveLength(1);
        expectMatches(
          `${p.id} enlight ${i}`,
          ukLocale[`practice.${p.id}.enlight.${i}`] ?? '',
          mods[0] as Mod,
        );
      });
    }
  });

  it('reads every text in the data without a figure the reader cannot parse', () => {
    // The 95% texts ("удвічі більше", "+5% досвіду ...") are not parsed: they have no data.
    const unreadable: string[] = [];
    for (const p of content.pools) {
      if (p.pct < 95 && readFigure(ukLocale[`pool.${p.id}.desc`] ?? '') === null)
        unreadable.push(p.id);
    }
    expect(unreadable).toEqual([]);
  });

  it('gives every obstacle one bonus and one penalty that match the two halves of its text', () => {
    expect(content.obstacles).toHaveLength(12);
    for (const o of content.obstacles) {
      const [bonusText, penaltyText] = (ukLocale[`obstacle.${o.id}.desc`] ?? '').split(' / ');
      expect(o.mods.map((m) => m.side)).toEqual(['bonus', 'penalty']);
      expectMatches(`${o.id} bonus`, bonusText ?? '', o.mods[0] as Mod);
      expectMatches(`${o.id} penalty`, penaltyText ?? '', o.mods[1] as Mod);
    }
  });

  it('ties the modifiers of an unowned nature to that nature', () => {
    const tied = content.practices
      .flatMap((p) => [...p.insightMods, ...p.enlightMods].flat())
      .filter((m) => m.nature !== undefined);
    expect(tied.map((m) => m.nature).sort()).toEqual([
      'doton',
      'doton',
      'katon',
      'katon',
      'suiton',
      'suiton',
    ]);
  });

  it('asks Chakra Control 15 and 30 for walking on trees and water', () => {
    const reqs = Object.fromEntries(content.obstacles.map((o) => [o.id, o.req]));
    expect(reqs['core:bih_po_derevakh']).toEqual({ t: 'skill', skill: 'cc', level: 15 });
    expect(reqs['core:bih_po_vodi']).toEqual({ t: 'skill', skill: 'cc', level: 30 });
    expect(content.obstacles.filter((o) => o.req !== null)).toHaveLength(2);
  });
});
