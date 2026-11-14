import { describe, expect, it } from 'vitest';
import { hrefFor, parseHash } from './route.ts';

describe('router', () => {
  it('parses entity routes', () => {
    expect(parseHash('#/skill/tai')).toEqual({ page: 'entity', ref: { kind: 'skill', id: 'tai' } });
    expect(parseHash('#/technique/core:great_fireball')).toEqual({
      page: 'entity',
      ref: { kind: 'technique', id: 'core:great_fireball' },
    });
  });

  it('parses home, lists and tabs', () => {
    expect(parseHash('')).toEqual({ page: 'home' });
    expect(parseHash('#/')).toEqual({ page: 'home' });
    expect(parseHash('#/skills')).toEqual({ page: 'skills' });
    expect(parseHash('#/missions')).toEqual({ page: 'tab', tab: 'missions' });
  });

  it('reports unknown routes', () => {
    expect(parseHash('#/nope/1').page).toBe('notFound');
    expect(parseHash('#/skill').page).toBe('notFound');
  });

  it('builds hashes that parse back', () => {
    const ref = { kind: 'item', id: 'core:mint' } as const;
    expect(hrefFor(ref)).toBe('#/item/core:mint');
    expect(parseHash(hrefFor(ref))).toEqual({ page: 'entity', ref });
  });
});
