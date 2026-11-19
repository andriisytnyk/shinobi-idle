// @vitest-environment happy-dom
import { createState, syncVillage, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RaidPanel from '../src/components/RaidPanel.svelte';
import { t } from '../src/lib/i18n.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toastFor } from '../src/lib/toasts.svelte.ts';

/*
 * A pack's own raid is announced in the pack's words: the panel and the toasts take the name from the raid's
 * data and locale, and no generic text of the interface names the raid of the core pack.
 */

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  const { composeBoot } = await import('../src/lib/boot.ts');
  const { testmodPack } = await import('@shinobi/core/testmod');
  const boot = composeBoot([testmodPack]);
  return {
    game: createGame({
      content: boot.content,
      rules: boot.rules,
      packs: boot.packs.map((p) => p.manifest),
      clock: { now: () => 0 },
    }),
  };
});

const content = game.content;
const raid = content.raids.find((r) => r.id === 'testmod:raid_probe')!;
const TICK = content.balance.K.tickMin * 60_000;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** Words that belong to the raid of the core pack and must never appear for another. */
const CORE_WORDS = [
  'Сірих',
  'Сірі',
  'найманц',
  'Найманц',
  'склад',
  "Бар'єр",
  'Охорон',
  'Сила шинобі',
];

function calledGenin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  syncVillage(state, content);
  state.flags['testmod.raid.call'] = true;
  return state;
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  settings.hints = false;
  game.replaceState(calledGenin());
  target = document.createElement('div');
  document.body.append(target);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
});

describe('a pack raid in the panel and the toasts', () => {
  it('names the raid of the pack, never the raid of the core', () => {
    game.devAdvance(1);
    app = mount(RaidPanel, { target, props: {} });
    flushSync();
    const panel = target.querySelector('[data-raid]');
    expect(panel?.getAttribute('data-raid')).toBe(raid.id);
    expect(panel?.getAttribute('data-phase')).toBe('warned');
    expect(text(panel)).toContain('Тестовий напад мода');
    for (const word of CORE_WORDS) expect(text(panel), word).not.toContain(word);

    game.devAdvance(raid.lead * TICK);
    flushSync();
    expect(panel?.getAttribute('data-phase')).toBe('active');
    expect(text(panel?.querySelector('[data-raid-state]'))).toContain('Тестовий напад мода');
    for (const word of CORE_WORDS) expect(text(panel), word).not.toContain(word);
  });

  it('tells the pack raid in the toasts in the pack words', () => {
    const named = [
      toastFor({ type: 'raidCalled', raid: raid.id, ticks: 1, at: 0 }, content),
      toastFor({ type: 'raidArrived', raid: raid.id, at: 0 }, content),
      toastFor(
        {
          type: 'raidOver',
          raid: raid.id,
          repelled: 1,
          byVillage: 1,
          breached: 0,
          damaged: [],
          ryo: 0,
          rep: 0,
          at: 0,
        },
        content,
      ),
    ];
    for (const spec of named) {
      const said = t(spec?.key ?? '', spec?.params ?? {});
      expect(said).toContain('Тестовий напад мода');
      for (const word of CORE_WORDS) expect(said, word).not.toContain(word);
    }
  });
});
