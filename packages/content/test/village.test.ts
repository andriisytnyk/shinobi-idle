/** Village data: buildings with roles and effects, resources, starting levels, level-6 needs. */
import { describe, expect, it } from 'vitest';
import generatedUk from '../src/packs/core/locales/uk.json' with { type: 'json' };
import { content, ukLocale } from '../src/index.ts';

const K = content.balance.K;

describe('village content', () => {
  it('gives each of the 16 buildings a role, and producers their products', () => {
    expect(content.buildings).toHaveLength(16);
    const produces = Object.fromEntries(
      content.buildings.filter((b) => b.produces.length).map((b) => [b.id, b.produces]),
    );
    expect(produces).toEqual({
      'core:farms': ['food'],
      'core:hunt': ['food'],
      'core:mine': ['stone', 'iron'],
      'core:sawmill': ['wood'],
    });
    for (const b of content.buildings.filter((x) => x.role === 'producer')) {
      expect(b.produces.length, b.id).toBeGreaterThan(0);
    }
  });

  it('keeps every modifier of a building per level and in step with its text', () => {
    for (const b of content.buildings) {
      const text = (generatedUk as Record<string, string>)[`building.${b.id}.desc`] ?? '';
      const name = ukLocale[`building.${b.id}.name`] ?? '';
      expect(name, b.id).toBeTruthy();
      for (const e of b.effects) {
        expect(e.op).toBe('add');
        const percent = Math.round(Math.abs(e.value) * 100);
        expect(text.replace(/\s/g, ''), `${b.id}: ${e.key}`).toMatch(new RegExp(`${percent}%`));
      }
    }
  });

  it('names resources that exist: level-6 needs are shinobi resources of 30 each', () => {
    const shinobi = new Set(content.resources.filter((r) => r.kind === 'shinobi').map((r) => r.id));
    expect(shinobi.size).toBe(6);
    expect(content.resources.filter((r) => r.kind === 'workforce')).toHaveLength(1);
    expect(content.resources.filter((r) => r.kind === 'power')).toHaveLength(1);
    const six = content.buildings.filter((b) => b.tier6);
    expect(six).toHaveLength(6);
    for (const b of six) {
      for (const [res, n] of Object.entries(b.tier6 ?? {})) {
        expect(shinobi.has(res), `${b.id}: ${res}`).toBe(true);
        expect(n).toBe(K.shinobiT6);
      }
    }
    for (const r of content.resources) {
      expect(ukLocale[`resource.${r.id}.name`], r.id).toBeTruthy();
      expect(ukLocale[`resource.${r.id}.desc`], r.id).toBeTruthy();
    }
  });

  it('starts the Tower, Bureau, Store, Sawmill, Mine, Farms and Market at level 1', () => {
    const ids = new Set(content.buildings.map((b) => b.id));
    for (const id of Object.keys(K.village.start)) expect(ids.has(id), id).toBe(true);
    expect(Object.values(K.village.start).every((n) => n === 1)).toBe(true);
    expect(Object.keys(K.village.start).sort()).toEqual(
      ['tower', 'bureau', 'store', 'sawmill', 'mine', 'farms', 'market']
        .map((s) => `core:${s}`)
        .sort(),
    );
  });
});
