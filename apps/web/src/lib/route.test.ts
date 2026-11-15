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
    expect(parseHash('#/credits')).toEqual({ page: 'credits' });
    expect(parseHash('#/world')).toEqual({ page: 'world' });
    expect(parseHash('#/poi/core:poi_x')).toEqual({
      page: 'entity',
      ref: { kind: 'poi', id: 'core:poi_x' },
    });
    expect(parseHash('#/settings')).toEqual({ page: 'settings' });
    expect(parseHash('#/exercise/core:x')).toEqual({
      page: 'entity',
      ref: { kind: 'exercise', id: 'core:x' },
    });
  });

  it('reports unknown routes', () => {
    expect(parseHash('#/nope/1').page).toBe('notFound');
    expect(parseHash('#/skill').page).toBe('notFound');
  });

  it('does not throw on malformed percent escapes', () => {
    expect(parseHash('#/skill/%E0%A4%A').page).toBe('notFound');
    expect(parseHash('#/technique/%').page).toBe('notFound');
  });

  it('builds hashes that parse back', () => {
    const ref = { kind: 'item', id: 'core:mint' } as const;
    expect(hrefFor(ref)).toBe('#/item/core:mint');
    expect(parseHash(hrefFor(ref))).toEqual({ page: 'entity', ref });
  });
});
