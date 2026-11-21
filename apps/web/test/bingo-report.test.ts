import { content, ukLocale } from '@shinobi/content';
import {
  analyzeFight,
  blankReport,
  createState,
  defaultRules,
  xpAt,
  type GameState,
} from '@shinobi/core';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import BattleReport from '../src/components/BattleReport.svelte';
import BingoBook from '../src/components/BingoBook.svelte';
import { clearMissingKeys, missingKeys } from '../src/lib/i18n.ts';
import { game } from '../src/lib/store.ts';

const html = <P extends Record<string, unknown>>(component: Component<P>, props: P): string =>
  render(component, { props }).body;

const WOLF = 'core:wolf';
const WOLF_NAME = ukLocale[`enemy.${WOLF}.name`] ?? WOLF;
const DUMMY_NAME = ukLocale['enemy.core:dummy.name'] ?? 'core:dummy';

function player(): GameState {
  const state = createState(3, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(12);
  }
  for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  return state;
}

beforeEach(() => {
  game.replaceState(player());
});

describe('F1: the Bingo book', () => {
  it('lists what the player has met, with the level and what each level reveals, and counts the rest unnamed', () => {
    const state = player();
    state.bingo['core:dummy'] = { seen: 3, wins: 3, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
    game.replaceState(state);
    const out = html(BingoBook, {});
    expect(out).toContain('data-ui="bingo-entry"');
    expect(out).toContain('data-entity="enemy:core:dummy"');
    expect(out).toContain(DUMMY_NAME);
    expect(out).toContain('Рівень 1');
    expect(out).toContain('Рівень 3');
    // The reveal rule: an enemy the player has not met is not named, and not even listed.
    expect(out).not.toContain(WOLF_NAME);
    expect(out).not.toContain(`enemy:${WOLF}`);
    expect(out).toContain('Ще невідомих записів');
  });

  it('shows traits with the answers the player has, and loot only as far as it is revealed', () => {
    const state = player();
    state.bingo[WOLF] = { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
    for (const cell of content.cells) state.world.explores[cell.id] = 9999;
    game.replaceState(state);
    const seen = html(BingoBook, {});
    expect(seen).toContain(`data-entity="enemy:${WOLF}"`);
    expect(seen).toContain('data-level="1"');
    expect(seen).toContain('Риси та відповіді на них');
    expect(seen).not.toContain('data-drop');
    expect(seen).not.toContain('Нагорода за голову');

    state.bingo[WOLF] = { seen: 9, wins: 99, losses: 0, timeouts: 0, bought: 3, bounty: 0 };
    game.replaceState(state);
    const studied = html(BingoBook, {});
    expect(studied).toContain('data-level="3"');
    expect(studied).toMatch(/шанс \d/);
  });

  it('studies an entry with Intel through the same command the core has', () => {
    const state = player();
    state.bingo['core:dummy'] = { seen: 1, wins: 0, losses: 0, timeouts: 0, bought: 0, bounty: 0 };
    state.bingo['core:dummy']!.wins = 1;
    const intel = content.currencies.find((c) => c.role === 'study')!.id;
    state.currencies[intel] = 1000;
    game.replaceState(state);
    expect(html(BingoBook, {})).toContain('Вивчити:');
    expect(game.dispatch({ type: 'bingo.study', enemy: 'core:dummy' }).ok).toBe(true);
    expect(html(BingoBook, {})).toContain('data-level="3"');
  });
});

describe('F1: the battle report', () => {
  it('is empty until a real fight is fought, and the forecast of the preparation does not fill it', () => {
    expect(html(BattleReport, {})).toContain('Справжніх боїв ще не було');
    const state = player();
    game.replaceState(state);
    analyzeFight(
      game.state,
      { kind: 'zone', id: 'core:zone_dummy' },
      { samples: 3, minSessions: 1, maxSessions: 1 },
      content,
      defaultRules,
    );
    expect(Object.keys(game.state.report)).toEqual([]);
    expect(html(BattleReport, {})).toContain('Справжніх боїв ще не було');
  });

  it('shows wins and defeats with their causes, techniques used, damage by source and combos', () => {
    const state = player();
    const r = blankReport();
    Object.assign(r, {
      fights: 5,
      wins: 3,
      losses: 2,
      winMs: 90_000,
      allMs: 150_000,
      damage: { 'core:great_fireball': 400, basic: 100 },
      uses: { 'core:great_fireball': 9 },
      basic: 4,
      combos: { steam: 2 },
      taken: 321,
      defeats: [{ at: 1, enemy: 'core:dummy', tMs: 61_000, chakra: 0, stamina: 12 }],
    });
    state.report['core:zone_dummy'] = r;
    game.replaceState(state);
    const out = html(BattleReport, {});
    expect(out).toContain('data-report-row');
    expect(out).toContain('Боїв: 5, перемог: 3, поразок: 2');
    expect(out).toContain('data-defeats');
    expect(out).toContain('Лишалося чакри 0%, витривалості 12%');
    expect(out).toContain('data-uses');
    expect(out).toContain('data-damage');
    expect(out).toContain('data-combos');
    expect(out).toContain('Отримано шкоди: 321');
  });

  it('lists pouch items apart from techniques, by their Ukrainian names, never by a fallback of the id', () => {
    const state = player();
    const r = blankReport();
    const heal = 'core:tsiliushcha_maz';
    Object.assign(r, {
      fights: 1,
      wins: 1,
      // A report saved before the split holds the item among the techniques.
      uses: { 'core:great_fireball': 3, [heal]: 2 },
      items: { [heal]: 2 },
    });
    state.report['core:zone_dummy'] = r;
    game.replaceState(state);
    state.bank[heal] = 1; // the player has had the item, so its name is shown
    clearMissingKeys();
    const out = html(BattleReport, {});
    expect(out).toContain('data-items');
    expect(out).toContain('Використані предмети');
    expect(out).toContain('Цілюща мазь');
    // The visible text (hrefs carry the id by design).
    const text = out.replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/Tsiliushcha/i);
    expect(text).not.toContain('core:');
    expect(missingKeys()).toEqual([]);
    const techniques = out.slice(out.indexOf('data-uses'), out.indexOf('data-items'));
    expect(techniques).not.toContain('Цілюща мазь');
  });
});
