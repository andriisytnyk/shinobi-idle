import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setActiveContent } from './active.ts';
import { composeBoot } from './boot.ts';
import {
  clearMissingKeys,
  clearUnfilledPlaceholders,
  unfilledPlaceholders,
  createTranslator,
  fallbackText,
  missingKeys,
  t,
} from './i18n.ts';

beforeAll(() => setActiveContent(composeBoot().content));

describe('t', () => {
  it('never shows a key for an unknown string: it shows a readable stand-in and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    clearMissingKeys();
    expect(t('no.such_key')).toBe('Such key');
    expect(t('skill.testmod:forge.name')).toBe('Forge');
    expect(t('skill.testmod:forge.name')).toBe('Forge');
    expect(missingKeys()).toEqual(['no.such_key', 'skill.testmod:forge.name']);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('reports a placeholder no parameter filled, once, and stays quiet when all are filled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    clearUnfilledPlaceholders();
    t('course.notEnoughRyo', { price: 'Рьо: 5' });
    expect(unfilledPlaceholders()).toEqual([]);
    expect(t('course.notEnoughRyo')).toContain('{price}');
    t('course.notEnoughRyo');
    expect(unfilledPlaceholders()).toEqual(['course.notEnoughRyo: {price}']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    clearUnfilledPlaceholders();
  });

  it('makes a stand-in from the id part of a key, without the field', () => {
    expect(fallbackText('item.mod:ember_pulse.name')).toBe('Ember pulse');
    expect(fallbackText('nav.skills')).toBe('Skills');
    expect(fallbackText('nature.katon.name')).toBe('Katon');
  });

  it('reads Ukrainian strings from the content locale', () => {
    expect(t('nav.skills')).toBe('Навички');
    expect(t('skill.tai.name')).toBe('Тайдзюцу');
  });

  it('interpolates parameters and leaves unknown ones visible', () => {
    const tr = createTranslator({ a: 'Рівень {n}', b: 'Привіт, {who}' });
    expect(tr('a', { n: 7 })).toBe('Рівень 7');
    expect(tr('b')).toBe('Привіт, {who}');
  });

  it('picks Ukrainian plural forms', () => {
    const tr = createTranslator({
      days: '{n} {n, plural, one {день} few {дні} many {днів} other {дня}}',
    });
    const cases: [number, string][] = [
      [1, '1 день'],
      [2, '2 дні'],
      [4, '4 дні'],
      [5, '5 днів'],
      [11, '11 днів'],
      [21, '21 день'],
      [22, '22 дні'],
      [25, '25 днів'],
      [0, '0 днів'],
      [1.5, '1.5 дня'],
    ];
    for (const [n, expected] of cases) expect(tr('days', { n })).toBe(expected);
  });

  it('supports exact matches and nested parameters in plural clauses', () => {
    const tr = createTranslator({
      items: '{n, plural, =0 {Порожньо} one {Один предмет у {where}} other {{n} шт. у {where}}}',
    });
    expect(tr('items', { n: 0, where: 'банку' })).toBe('Порожньо');
    expect(tr('items', { n: 1, where: 'банку' })).toBe('Один предмет у банку');
    expect(tr('items', { n: 3, where: 'банку' })).toBe('3 шт. у банку');
  });

  it('ships the example plural string', () => {
    expect(t('plural.example', { n: 3 })).toBe('3 дні');
  });
});
