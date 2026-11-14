import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  createState,
  gainXp,
  getMod,
  registerModifierProvider,
  type Modifier,
} from '../src/index.ts';

const mod = (m: Partial<Modifier> & Pick<Modifier, 'value' | 'group'>): Modifier => ({
  key: 'xp.skill.tai',
  op: 'add',
  source: 'test',
  ...m,
});

describe('A9: getMod', () => {
  const state = createState(1, content);

  it('returns 1 and no parts when nothing contributes', () => {
    expect(getMod(state, 'xp.skill.tai', content)).toEqual({ total: 1, parts: [] });
  });

  it('adds inside a group, multiplies across groups, and lists the parts with sources', () => {
    const parts = [
      mod({ value: 0.25, group: 'character', source: { kind: 'skill', id: 'katon' } }),
      mod({ value: 0.1, group: 'character', source: 'perk' }),
      mod({ value: 0.2, group: 'village', source: { kind: 'building', id: 'core:academy' } }),
      mod({ value: 0.5, group: 'items', source: { kind: 'gear', id: 'core:band' } }),
      mod({ key: 'xp.all', value: 9, group: 'items' }),
    ];
    const off = registerModifierProvider(() => parts);
    const result = getMod(state, 'xp.skill.tai', content);
    off();
    expect(result.total).toBeCloseTo((1 + 0.25 + 0.1) * (1 + 0.2) * (1 + 0.5), 12);
    expect(result.parts).toEqual(parts.slice(0, 4));
    expect(result.parts.map((p) => p.source)).toEqual([
      { kind: 'skill', id: 'katon' },
      'perk',
      { kind: 'building', id: 'core:academy' },
      { kind: 'gear', id: 'core:band' },
    ]);
  });

  it('treats mul entries as factors inside their group', () => {
    const off = registerModifierProvider(() => [
      mod({ value: 0.5, group: 'items' }),
      mod({ op: 'mul', value: 2, group: 'items' }),
    ]);
    const { total } = getMod(state, 'xp.skill.tai', content);
    off();
    expect(total).toBeCloseTo(1.5 * 2, 12);
  });

  it('merges several providers and stops after unregistering', () => {
    const offA = registerModifierProvider(() => [mod({ value: 0.1, group: 'character' })]);
    const offB = registerModifierProvider(() => [mod({ value: 0.1, group: 'character' })]);
    expect(getMod(state, 'xp.skill.tai', content).total).toBeCloseTo(1.2, 12);
    offA();
    offB();
    offB();
    expect(getMod(state, 'xp.skill.tai', content).total).toBe(1);
  });

  it('is applied to gained XP', () => {
    const s = createState(1, content);
    s.player.rank = 'genin';
    const off = registerModifierProvider(() => [
      mod({ value: 0.5, group: 'character' }),
      mod({ key: 'xp.all', value: 1, group: 'village' }),
    ]);
    gainXp(s, 'tai', 100, content);
    off();
    expect(s.skills.tai.xp).toBe(300);
  });
});
