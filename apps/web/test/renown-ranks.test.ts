import { content, ukLocale } from '@shinobi/content';
import { createState, currencyOf, updateQuests, type GameEvent } from '@shinobi/core';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { toastFor } from '../src/lib/toasts.svelte.ts';
import { game } from '../src/lib/store.ts';
import RankPage from '../src/pages/RankPage.svelte';

const RENOWN = currencyOf(content, 'renown') as string;
const page = (): string => render(RankPage, { props: {} }).body;
const rows = (body: string): Record<string, string> =>
  Object.fromEntries(
    [...body.matchAll(/data-renown-row="([^"]+)" data-state="([^"]+)"/g)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );

beforeEach(() => {
  const state = createState(1, content);
  state.player.rank = 'genin';
  game.replaceState(state);
});

describe('the rank page: Renown ranks', () => {
  it('shows the ladder with the next rank first and the ones after it closed', () => {
    const body = page();
    expect(rows(body)).toEqual({
      'core:renown_courier': 'next',
      'core:renown_teacher': 'ahead',
      'core:renown_merchants': 'ahead',
      'core:renown_gift': 'ahead',
      'core:renown_recommendation': 'ahead',
    });
    expect(body).toContain(ukLocale['renownRank.core:renown_courier.name']);
    // The next rank shows its reward; the ranks after it say only that the reward is closed.
    expect(body).toContain('data-renown-reward');
    expect((body.match(/data-renown-locked/g) ?? []).length).toBe(4);
    // The mission it opens is masked by the reveal rule while the player has not seen it.
    expect(body).not.toContain(ukLocale['mission.core:mail.desc'] as string);
  });

  it('marks a reached rank as held and moves on to the next one', () => {
    game.state.currencies[RENOWN] = 215;
    updateQuests(game.state, content);
    const body = page();
    expect(rows(body)['core:renown_courier']).toBe('held');
    expect(rows(body)['core:renown_teacher']).toBe('held');
    expect(rows(body)['core:renown_merchants']).toBe('next');
    expect(body).toContain(ukLocale['renownRank.core:renown_courier.desc'] as string);
    expect(body).toContain('5%');
  });

  it('shows the item of the next rank by the reveal rule: a name only once it is named or seen', () => {
    game.state.currencies[RENOWN] = 245;
    updateQuests(game.state, content);
    const body = page();
    expect(rows(body)['core:renown_gift']).toBe('next');
    expect(body).toContain('data-masked');
    expect(body).not.toContain(ukLocale['item.core:chai_badorosti.name'] as string);
  });
});

describe('the toast of a Renown rank', () => {
  it('names the rank and its reward', () => {
    const event: GameEvent = { type: 'renownRank', rank: 'core:renown_teacher', at: 0 };
    const spec = toastFor(event, content);
    expect(spec?.key).toBe('toast.renownRank');
    expect(spec?.params).toEqual({
      name: ukLocale['renownRank.core:renown_teacher.name'],
      reward: ukLocale['renownRank.core:renown_teacher.reward'],
    });
  });
});
