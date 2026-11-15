import { content, localeKey, ukLocale } from '@shinobi/content';
import { advance, createState, xpAt, type GameState } from '@shinobi/core';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { hrefFor } from '../src/lib/route.ts';
import { game } from '../src/lib/store.ts';
import SkillPage from '../src/pages/SkillPage.svelte';
import { coreContext } from './helpers/core-registry.ts';

const html = <P extends Record<string, unknown>>(component: Component<P>, props: P): string =>
  render(component, { props, context: coreContext() }).body;

const count = (body: string, text: string) => body.split(text).length - 1;

function fresh(rank: 'student' | 'genin' = 'student'): GameState {
  const state = createState(1, content);
  state.player.rank = rank;
  return state;
}

beforeEach(() => {
  game.replaceState(fresh());
});

describe('Athletics page: the course', () => {
  it('shows six slots with two linked obstacles each, their texts and a build button', () => {
    const body = html(SkillPage, { id: 'ath' });
    expect(body).toContain('data-course');
    expect(count(body, 'data-slot=')).toBe(6);
    expect(count(body, 'data-obstacle=')).toBe(12);
    for (const o of content.obstacles) {
      const name = ukLocale[localeKey('obstacle', o.id, 'name')] ?? '';
      expect(body).toContain(`href="${hrefFor({ kind: 'obstacle', id: o.id })}"`);
      expect(body).toContain(name);
      const [bonus, penalty] = (ukLocale[localeKey('obstacle', o.id, 'desc')] ?? '').split(' / ');
      expect(body).toContain(bonus);
      expect(body).toContain(penalty);
    }
    expect(body).toContain('Збудувати');
    expect(body).toContain('Безкоштовно');
    expect(body).toContain('Стовп: 0 з 5');
  });

  it('shows the requirement tree of a locked slot and the course start disabled while empty', () => {
    const body = html(SkillPage, { id: 'ath' });
    expect(body).toContain('data-req');
    expect(body).toContain('data-course-empty');
    expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Пройти смугу/);
  });

  it('marks a built obstacle, offers a replacement for its twin and enables the course', () => {
    const state = fresh('genin');
    state.course['1'] = 'core:strybky_po_dakhakh';
    game.replaceState(state);
    const body = html(SkillPage, { id: 'ath' });
    expect(body).toContain('Збудовано');
    expect(body).toContain('Замінити');
    expect(body).not.toContain('data-course-empty');
    expect(body).not.toMatch(/<button[^>]*disabled[^>]*>\s*Пройти смугу/);
  });

  it('lights the pillar line from five built obstacles', () => {
    const state = fresh('genin');
    state.skills.ath!.xp = xpAt(40);
    for (const [slot, id] of [
      ['1', 'core:strybky_po_dakhakh'],
      ['2', 'core:obtiazhuvachi'],
      ['3', 'core:koloda_nad_prirvoiu'],
      ['4', 'core:lazinnia_po_skeli'],
      ['5', 'core:perehony_z_supernykom'],
    ] as const) {
      state.course[slot] = id;
    }
    game.replaceState(state);
    const body = html(SkillPage, { id: 'ath' });
    expect(body).toContain('data-pillar="true"');
    expect(body).toContain('+5% досвіду Атлетики');
  });

  it('builds the free obstacle and runs the course through the game', () => {
    expect(
      game.dispatch({ type: 'athletics.build', slot: 1, obstacle: 'core:strybky_po_dakhakh' }).ok,
    ).toBe(true);
    expect(game.dispatch({ type: 'action.start', slot: 0, kind: 'course', id: 'ath' }).ok).toBe(
      true,
    );
    advance(game.state, 10_000, content, game.rules);
    expect(game.state.skills.ath!.xp).toBeGreaterThan(0);
  });
});

describe('Meditation page', () => {
  it('shows each practice with its counts, six modifiers, costs, gates and buy buttons', () => {
    const state = fresh('genin');
    state.meditation['core:tykha_kimnata'] = { insight: 3, enlight: 1, bought: {} };
    game.replaceState(state);
    const body = html(SkillPage, { id: 'med' });
    expect(count(body, 'data-practice=')).toBe(6);
    expect(count(body, 'data-mod=')).toBe(36);
    expect(body).toContain('Прозріння: 3');
    expect(body).toContain('Просвітлення: 1');
    expect(body).toContain('Наступний рівень коштує 1');
    expect(body).toContain('Майстерність практики: 40');
    expect(body).toContain('Купити');
    expect(body).toContain(ukLocale[localeKey('practice', 'core:tykha_kimnata', 'insight.0')]);
  });

  it('shows a bought modifier of an unowned nature as locked with the reason', () => {
    const state = fresh('genin');
    state.meditation['core:bilia_vohnyshcha'] = {
      insight: 0,
      enlight: 0,
      bought: { 'insight.0': 2 },
    };
    game.replaceState(state);
    const locked = html(SkillPage, { id: 'med' });
    expect(count(locked, 'data-locked')).toBe(6); // two modifiers each of Katon, Suiton, Doton
    expect(locked).toContain('Не діє, поки немає природи чакри');
    state.player.natures.push('katon');
    game.replaceState(state);
    const open = html(SkillPage, { id: 'med' });
    expect(count(open, 'data-locked')).toBe(4);
    expect(open).toContain('Діє');
  });
});

describe('pool checkpoints on a skill page', () => {
  it('show which checkpoints are active, with the structured effect', () => {
    const state = fresh('genin');
    const capacity = content.balance.K.poolCapPerItem * (content.herbs.length || 1);
    state.pools.herb!.xp = capacity;
    game.replaceState(state);
    const body = html(SkillPage, { id: 'herb' });
    expect(count(body, 'data-active="true"')).toBeGreaterThan(0);
    expect(count(body, 'data-active="false"')).toBe(0); // the text-only 95% has no effect to show
  });
});
