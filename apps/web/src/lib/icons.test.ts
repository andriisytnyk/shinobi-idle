import { mappedIconNames } from '@shinobi/content';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Icon from '../components/Icon.svelte';
import { render as renderGenerated } from '../../scripts/build-icons.ts';
import { GAME_ICONS, LUCIDE_ICONS } from './icons.generated.ts';
import { iconTint, resolveIcon } from './icons.ts';
import { SHELL_GAME_ICONS, UI_ICON_NAMES } from './ui-icons.ts';

describe('generated icon module', () => {
  it('contains exactly the used game-icons and Lucide icons', () => {
    const usedGame = [...new Set([...mappedIconNames(), ...SHELL_GAME_ICONS])].sort();
    expect(Object.keys(GAME_ICONS).sort()).toEqual(usedGame);
    expect(Object.keys(LUCIDE_ICONS).sort()).toEqual([...UI_ICON_NAMES].sort());
  });

  it('is up to date with what the build script would write', async () => {
    const { readFileSync } = await import('node:fs');
    const onDisk = readFileSync(new URL('./icons.generated.ts', import.meta.url), 'utf8');
    expect(onDisk).toBe(renderGenerated());
  });

  it('stays small', () => {
    const size = Buffer.byteLength(renderGenerated());
    expect(size).toBeLessThan(400 * 1024);
  });
});

describe('icon tint', () => {
  it('uses nature tokens for elemental techniques, statuses and natures', () => {
    expect(iconTint({ kind: 'technique', id: 'core:great_fireball' })).toBe('var(--nature-katon)');
    expect(iconTint({ kind: 'status', id: 'wet' })).toBe('var(--nature-suiton)');
    expect(iconTint({ kind: 'nature', id: 'doton' })).toBe('var(--nature-doton)');
  });

  it('uses the neutral text colour for Taijutsu and Ninjutsu techniques', () => {
    expect(iconTint({ kind: 'technique', id: 'core:lion_combo' })).toBe('var(--fg)');
    expect(iconTint({ kind: 'technique', id: 'core:shadow_clone' })).toBe('var(--fg)');
  });

  it('inherits the text colour for other entities', () => {
    expect(iconTint({ kind: 'item', id: 'core:mint' })).toBeUndefined();
  });
});

describe('Icon component', () => {
  it('renders an inline svg for an entity ref', () => {
    const { body } = render(Icon, { props: { entity: { kind: 'skill', id: 'katon' } } });
    expect(body).toMatch(/<svg[^>]*viewBox="0 0 512 512"/);
    expect(body).toContain('currentColor');
    expect(body).toContain(resolveIcon({ kind: 'skill', id: 'katon' }).body);
  });

  it('tints technique icons with the nature colour', () => {
    const { body } = render(Icon, {
      props: { entity: { kind: 'technique', id: 'core:great_fireball' } },
    });
    expect(body).toMatch(/color:\s*var\(--nature-katon\)/);
  });

  it('renders an inline svg for a raw name in either namespace', () => {
    const game = render(Icon, { props: { name: 'fist', size: 32 } }).body;
    expect(game).toMatch(/<svg[^>]*width="32"[^>]*viewBox="0 0 512 512"/);
    const ui = render(Icon, { props: { name: 'lucide:menu' } }).body;
    expect(ui).toMatch(/<svg[^>]*viewBox="0 0 24 24"/);
    expect(ui).toContain('<path');
  });

  it('falls back to a glyph for an unknown name instead of leaving a hole', () => {
    const { body } = render(Icon, { props: { name: 'no-such-icon' } });
    expect(body).toContain('<path');
  });
});
