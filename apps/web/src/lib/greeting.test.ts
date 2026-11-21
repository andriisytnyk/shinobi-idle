import { beforeAll, describe, expect, it } from 'vitest';
import { setActiveContent } from './active.ts';
import { composeBoot } from './boot.ts';
import { greeting } from './greeting.ts';

beforeAll(() => setActiveContent(composeBoot().content));

describe('greeting', () => {
  it('greets by name', () => expect(greeting('Тест')).toBe('Вітаємо, Тест!'));
  it('greets without the name when it is empty or blank', () => {
    expect(greeting('')).toBe('Вітаємо!');
    expect(greeting('   ')).toBe('Вітаємо!');
  });
});
