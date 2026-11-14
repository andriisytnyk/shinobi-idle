import { describe, expect, it } from 'vitest';
import { createTranslator, t } from './i18n.ts';

describe('t', () => {
  it('returns the key for unknown strings', () => {
    expect(t('no.such.key')).toBe('no.such.key');
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
