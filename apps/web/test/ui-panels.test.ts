// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { createRegistry } from '../src/lib/ext/registry.ts';
import type { UiPack } from '../src/lib/ext/types.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, genin, type BootedApp } from './helpers/boot-app.ts';
import Throwing from './helpers/Throwing.svelte';

/*
 * Skill panels (`addSkillPanel`) and point-of-interest renderers (`addPoiRenderer`) follow the
 * rules of every other registration: a pack that breaks a rule or throws in `setup` is rolled back,
 * the later of two packs wins with a warning, and a panel that fails while it draws is left out.
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const pack = (id: string, setup: NonNullable<UiPack['setup']>): UiPack => ({ id, setup });
const noWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

let booted: BootedApp | null = null;
afterEach(() => {
  booted?.destroy();
  booted = null;
  vi.restoreAllMocks();
});

describe('registration', () => {
  it('rolls back a skill panel and a renderer of a pack that throws later in its setup', () => {
    noWarn();
    const registry = createRegistry([
      coreUi,
      pack('bad', (ui) => {
        ui.addSkillPanel('newactivity', { hint: 'skillPage' });
        ui.addPoiRenderer('newkind', { icon: 'lucide:map-pin' });
        throw new Error('setup failed');
      }),
    ]);
    expect(registry.disabled.map((d) => d.packId)).toEqual(['bad']);
    expect(registry.skillPanel('newactivity')).toBeUndefined();
    expect(registry.poiRenderer('newkind')).toBeUndefined();
    // What the built-in game registered stays.
    expect(registry.skillPanel('map')).toBeDefined();
    expect(registry.poiRenderer('outpost')).toBeDefined();
  });

  it('rejects a panel without a mount or a hint, a renderer without an icon, and a duplicate in one pack', () => {
    noWarn();
    const failure = (setup: NonNullable<UiPack['setup']>): string => {
      const registry = createRegistry([coreUi, pack('p', setup)]);
      return registry.disabled.at(-1)?.message ?? '';
    };
    expect(failure((ui) => ui.addSkillPanel('x', {}))).toMatch(/needs a mount or a hint/);
    expect(failure((ui) => ui.addPoiRenderer('x', { icon: '' }))).toMatch(/needs an icon/);
    expect(
      failure((ui) => {
        ui.addSkillPanel('x', { hint: 'a' });
        ui.addSkillPanel('x', { hint: 'b' });
      }),
    ).toMatch(/duplicate skill-panel "p:x"/);
  });

  it('lets the later pack win for the same activity and kind, and says so', () => {
    const warn = noWarn();
    const registry = createRegistry([
      coreUi,
      pack('a', (ui) => {
        ui.addSkillPanel('tech', { hint: 'a-hint' });
        ui.addPoiRenderer('outpost', { icon: 'lucide:tent' });
      }),
      pack('b', (ui) => {
        ui.addSkillPanel('tech', { hint: 'b-hint' });
        ui.addPoiRenderer('outpost', { icon: 'lucide:mountain' });
      }),
    ]);
    expect(registry.skillPanel('tech')?.hint).toBe('b-hint');
    expect(registry.poiRenderer('outpost')?.icon).toBe('lucide:mountain');
    const said = warn.mock.calls.map((c) => String(c[0]));
    expect(said.some((m) => /skill panel for "tech" is set by "a" and by "b"/.test(m))).toBe(true);
    expect(said.some((m) => /poi renderer for "outpost" is set by "a" and by "b"/.test(m))).toBe(
      true,
    );
    // The order of the packs is the rule: swapped, the other one wins.
    const swapped = createRegistry([
      coreUi,
      pack('b', (ui) => ui.addSkillPanel('tech', { hint: 'b-hint' })),
      pack('a', (ui) => ui.addSkillPanel('tech', { hint: 'a-hint' })),
    ]);
    expect(swapped.skillPanel('tech')?.hint).toBe('a-hint');
  });
});

describe('a panel that fails while it draws', () => {
  it('leaves a throwing widget panel out of the skill page and says so once', async () => {
    const warn = noWarn();
    const bad = pack('bad', (ui) =>
      ui.addSkillPanel('tech', {
        mount: () => {
          throw new Error('widget boom');
        },
      }),
    );
    booted = await bootApp([coreUi, bad], genin(), '#/skill/tai');
    expect(booted.target.querySelector('.skill-page')).not.toBeNull();
    expect(booted.target.querySelector('[data-entity="skill:tai"] .tiles, .tiles')).not.toBeNull();
    expect(warn.mock.calls.some((c) => /"bad:skill-panel.tech"|bad/.test(String(c[0])))).toBe(true);
  });

  it('leaves a throwing Svelte panel out and keeps the page', async () => {
    const warn = noWarn();
    const bad = pack('bad', (ui) =>
      ui.addSkillPanel('tech', { mount: { svelte: Throwing }, place: 'after' }),
    );
    booted = await bootApp([coreUi, bad], genin(), '#/skill/tai');
    expect(booted.target.querySelector('.skill-page')).not.toBeNull();
    expect(booted.target.textContent).not.toContain('never drawn');
    expect(warn.mock.calls.some((c) => /bad/.test(String(c[0])))).toBe(true);
  });

  it('draws a point of interest generically when its renderer throws', async () => {
    noWarn();
    const bad = pack('bad', (ui) =>
      ui.addPoiRenderer('outpost', {
        icon: 'lucide:tent',
        mount: { svelte: Throwing },
      }),
    );
    const state = genin();
    const cell = game.content.cells.find((c) => c.pois.some((p) => p.kind === 'outpost'));
    if (!cell) throw new Error('no cell with an outpost');
    state.world.explores[cell.id] = game.content.balance.K.cellExplores[0] ?? 1;
    for (const p of cell.pois) state.world.pois[p.id] = true;
    booted = await bootApp([coreUi, bad], state, `#/cell/${cell.id}`);
    booted.target.querySelector<HTMLElement>('[data-hex-details]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(booted.target.querySelector('[data-poi-kind="outpost"]')).not.toBeNull();
    expect(booted.target.textContent).not.toContain('never drawn');
  });
});
