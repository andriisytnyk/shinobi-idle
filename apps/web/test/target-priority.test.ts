// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, xpAt, type GameState } from '@shinobi/core';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const PREPARE = '#/combat/prepare/zone/core:zone_wolf';

/** A genin with the skills and techniques to fight the pack of wolves. */
function fighter(): GameState {
  const state = createState(9, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(12);
  }
  for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  for (const cell of content.cells) state.world.explores[cell.id] = 9999;
  state.flags['region.forest.unlocked'] = true;
  return state;
}

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

describe('the target priority of the fight preparation', () => {
  it('offers the four settings, the leader-first one chosen, with its line', async () => {
    booted = await bootApp([coreUi], fighter(), PREPARE);
    const select = q('[data-ui="target-priority"] select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const options = [...(select?.querySelectorAll('option') ?? [])];
    expect(options.map((o) => o.value)).toEqual([
      'core:prio_auto',
      'core:prio_adds',
      'core:prio_leader',
      'core:prio_weakest',
    ]);
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Автоматично',
      'Спершу помічники',
      'Спершу ватажок',
      'Найслабший',
    ]);
    expect(select?.value).toBe('core:prio_leader');
    expect(q('[data-target-priority-line]')?.textContent).toContain(
      ukLocale['targetPriority.core:prio_leader.desc'],
    );
  });

  it('sets the priority of the loadout when one is picked and shows its line', async () => {
    booted = await bootApp([coreUi], fighter(), PREPARE);
    const select = q('[data-ui="target-priority"] select') as HTMLSelectElement;
    select.value = 'core:prio_leader';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(game.state.loadouts.targetPriority).toBe('core:prio_leader');
    expect(q('[data-target-priority-line]')?.textContent).toContain(
      ukLocale['targetPriority.core:prio_leader.desc'],
    );
  });

  it('treats a setting that is gone as the automatic one', async () => {
    const state = fighter();
    state.loadouts.targetPriority = 'core:prio_removed';
    booted = await bootApp([coreUi], state, PREPARE);
    expect((q('[data-ui="target-priority"] select') as HTMLSelectElement).value).toBe(
      'core:prio_leader',
    );
  });
});
