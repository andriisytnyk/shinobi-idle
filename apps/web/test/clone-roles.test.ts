// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, defaultRules, xpAt, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AllyRow from '../src/components/AllyRow.svelte';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { buildScene, type FighterView } from '../src/lib/fight-scene.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const CLONE = 'core:shadow_clone';
const PREPARE = '#/combat/prepare/zone/core:zone_wolf';
const ROLE = (id: string) => ukLocale[`cloneRole.${id}.name`] ?? id;

/** A genin with the skills and techniques to fight the pack of wolves, who may know the clone technique. */
function fighter(withClone: boolean): GameState {
  const state = createState(9, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(12);
  }
  for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  state.known['core:body_replacement'] = true;
  if (withClone) state.known[CLONE] = true;
  for (const cell of content.cells) state.world.explores[cell.id] = 9999;
  state.flags['region.forest.unlocked'] = true;
  return state;
}

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

describe('the role picker of the fight preparation', () => {
  it('is not shown to a character who knows no combat clone technique', async () => {
    booted = await bootApp([coreUi], fighter(false), PREPARE);
    expect(q('[data-ui="prep-hand"]')).not.toBeNull();
    expect(q('[data-ui="clone-roles"]')).toBeNull();
  });

  it('offers the four roles with a name and a line each, the default chosen', async () => {
    booted = await bootApp([coreUi], fighter(true), PREPARE);
    const picker = q('[data-ui="clone-roles"]');
    expect(picker).not.toBeNull();
    const roles = qa('[data-clone-role]');
    expect(roles.map((r) => r.dataset.cloneRole)).toEqual([
      'core:role_mirror',
      'core:role_assault',
      'core:role_support',
      'core:role_distract',
    ]);
    for (const r of roles) {
      const id = r.dataset.cloneRole ?? '';
      expect(r.textContent).toContain(ROLE(id));
      expect(r.textContent).toContain(ukLocale[`cloneRole.${id}.desc`]);
    }
    // The accessible name is the role's name; the line is its description.
    for (const input of qa('[data-clone-role] input')) {
      const id = input.closest('[data-clone-role]')?.getAttribute('data-clone-role') ?? '';
      const ref = (attr: string) =>
        document.getElementById(input.getAttribute(attr) ?? '')?.textContent ?? '';
      expect(ref('aria-labelledby')).toBe(ROLE(id));
      expect(ref('aria-describedby')).toBe(ukLocale[`cloneRole.${id}.desc`]);
    }
    const checked = qa('[data-clone-role] input').filter((i) => (i as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]?.closest('[data-clone-role]')?.getAttribute('data-clone-role')).toBe(
      'core:role_mirror',
    );
  });

  it('sets the role of the clones when one is picked, and shows it chosen', async () => {
    booted = await bootApp([coreUi], fighter(true), PREPARE);
    const assault = q('[data-clone-role="core:role_assault"] input') as HTMLInputElement;
    assault.checked = true;
    assault.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(game.state.loadouts.cloneRole).toBe('core:role_assault');
    expect(q('[data-clone-role="core:role_assault"]')?.classList.contains('on')).toBe(true);
    expect(q('[data-clone-role="core:role_mirror"]')?.classList.contains('on')).toBe(false);
  });

  it('treats a role that is gone as the default', async () => {
    const state = fighter(true);
    state.loadouts.cloneRole = 'core:role_removed';
    booted = await bootApp([coreUi], state, PREPARE);
    expect(q('[data-clone-role="core:role_mirror"]')?.classList.contains('on')).toBe(true);
  });
});

describe('the role on the fight screen', () => {
  const html = (role: string | null): string => {
    const target = document.createElement('div');
    document.body.append(target);
    const app = mount(AllyRow, {
      target,
      props: {
        f: {
          key: 'ally#1',
          side: 'player',
          entry: null,
          ally: 1,
          nth: 1,
          alive: true,
          hp: 5,
          maxHp: 10,
          chakra: 0,
          maxChakra: 0,
          phase: 'wait',
          action: null,
          heldBy: null,
          timing: { fraction: 0, cycleMs: 0, running: false, repeat: false },
        } as unknown as FighterView,
        role,
      },
    });
    flushSync();
    const text = target.textContent ?? '';
    void unmount(app);
    target.remove();
    return text;
  };

  it('is written after the name of each clone', () => {
    expect(html('core:role_assault')).toContain(`Клон №1 · ${ROLE('core:role_assault')}`);
    expect(html('core:role_distract')).toContain(`Клон №1 · ${ROLE('core:role_distract')}`);
  });

  it('leaves the plain name when the fight names no role', () => {
    const out = html(null);
    expect(out).toContain('Клон №1');
    expect(out).not.toContain('·');
  });

  it('is the role the fight was begun with, whatever is chosen after', () => {
    const state = fighter(true);
    state.loadouts.cloneRole = 'core:role_assault';
    game.replaceState(state);
    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_wolf' }),
    ).toEqual({ ok: true });
    for (let i = 0; i < 1500 && !game.state.combat?.fight.allies?.length; i++) {
      game.devAdvance(100);
    }
    const scene = buildScene(game.state, game.content, defaultRules);
    expect(scene?.allies.length).toBeGreaterThan(0);
    expect(scene?.cloneRole).toBe('core:role_assault');
    game.dispatch({ type: 'loadout.cloneRole', role: 'core:role_support' });
    expect(buildScene(game.state, game.content, defaultRules)?.cloneRole).toBe('core:role_assault');
  });
});
