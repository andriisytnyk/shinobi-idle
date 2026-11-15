import { content, localeKey, NATURE_IDS, ukLocale } from '@shinobi/content';
import {
  createState,
  dispatch,
  natureConsequences,
  updateQuests,
  type GameState,
} from '@shinobi/core';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import GraduationModal from '../src/components/GraduationModal.svelte';
import NatureCard from '../src/components/NatureCard.svelte';
import NatureOffer from '../src/components/NatureOffer.svelte';
import { nextStep } from '../src/lib/next-step.ts';
import { hrefFor, parseHash, type EntityRef } from '../src/lib/route.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import NaturePage from '../src/pages/NaturePage.svelte';

const html = <P extends Record<string, unknown>>(component: Component<P>, props: P): string =>
  render(component, { props }).body;

const anchor = (ref: EntityRef) =>
  new RegExp(`<a[^>]*href="${hrefFor(ref).replace(/[#/]/g, (c) => `\\${c}`)}"[^>]*>`);

function genin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  return state;
}

beforeEach(() => {
  game.replaceState(genin());
  settings.hints = true;
  settings.resetHints();
});

describe('the nature route', () => {
  it('is #/nature', () => {
    expect(parseHash('#/nature')).toEqual({ page: 'nature' });
  });
});

describe('S4-3: the nature screen', () => {
  it('shows five cards with a colour token, the character line and a choose button', () => {
    const body = html(NaturePage, {});
    for (const nature of NATURE_IDS) {
      expect(body).toContain(`data-nature="${nature}"`);
      expect(body).toMatch(new RegExp(`--nature-color:\\s*var\\(--nature-${nature}\\)`));
      expect(body).toContain(ukLocale[`nature.character.${nature}`]);
      expect(body).toContain(`data-pick="${nature}"`);
    }
    expect(body).toContain('data-random');
    expect(body).toContain('data-hint="nature"');
    expect(body).toContain('data-nature-stage="test"');
    // Before the test there is no team and no set summary yet.
    expect(body).not.toContain('data-team');
    expect(body).not.toContain('data-summary');
  });

  it('lists every consequence as an entity link', () => {
    for (const nature of NATURE_IDS) {
      const cons = natureConsequences(nature, game.state, content);
      const body = html(NatureCard, { nature, cons, action: 'choose' as const, onPick: () => {} });
      for (const id of cons.missions) expect(body, id).toMatch(anchor({ kind: 'mission', id }));
      for (const id of cons.buildings) expect(body, id).toMatch(anchor({ kind: 'building', id }));
      for (const id of cons.cells) expect(body, id).toMatch(anchor({ kind: 'cell', id }));
      for (const id of cons.traits) expect(body, id).toMatch(anchor({ kind: 'trait', id }));
      for (const id of cons.combos) expect(body, id).toMatch(anchor({ kind: 'combo', id }));
      for (const id of [cons.strongAgainst, cons.weakAgainst, cons.rival, cons.aya]) {
        expect(body, id).toMatch(anchor({ kind: 'skill', id }));
      }
    }
    // Names appear only inside links: no bare mission name in the page text.
    const suiton = natureConsequences('suiton', game.state, content);
    const body = html(NatureCard, {
      nature: 'suiton' as const,
      cons: suiton,
      action: null,
      onPick: () => {},
    });
    const name = ukLocale[localeKey('mission', 'core:v_water', 'name')] ?? '';
    expect(name).not.toBe('');
    expect(body.split(name).length - 1).toBe(body.split(`>${name}</a>`).length - 1);
  });

  it('uses no action button on a nature the player cannot choose now', () => {
    const state = genin();
    dispatch(state, { type: 'nature.choose', nature: 'katon' }, content);
    game.replaceState(state);
    const body = html(NaturePage, {});
    expect(body).not.toContain('data-pick=');
    expect(body).not.toContain('data-random');
    expect(body).toContain('data-owned-nature="katon"');
    expect(body).toContain('data-team');
    expect(body).toContain('data-summary');
    expect(body).toContain('data-nature-stage="second"');
  });

  it('offers the second nature at Chakra Control 20, with the combined summary', () => {
    const state = genin();
    dispatch(state, { type: 'nature.choose', nature: 'katon' }, content);
    state.skills.cc!.xp = 100_000;
    game.replaceState(state);
    const body = html(NaturePage, {});
    expect(body).toContain('data-pick="futon"');
    expect(body).not.toContain('data-pick="katon"');
    expect(body).toContain('data-together');
    expect(body).toContain('data-random');
  });

  it('is locked for a student', () => {
    game.replaceState(createState(1, content));
    const body = html(NaturePage, {});
    expect(body).toContain('data-nature-stage="locked"');
    expect(body).not.toContain('data-pick=');
  });
});

describe('S4-3: leading the new genin to the test', () => {
  it('the mission board quest points at the nature screen', () => {
    const state = genin();
    // The Academy chain is finished by the exam that makes the player a genin.
    state.quests['core:graduation'] = { step: 5, base: 0, done: true };
    updateQuests(state, content);
    game.replaceState(state);
    const step = nextStep(game.state, content);
    expect(step?.quest.id).toBe('core:mission_board');
    expect(step?.target).toBe('#/nature');
  });

  it('the graduation modal offers the test until a nature is chosen', () => {
    let body = html(GraduationModal, { onClose: () => {} });
    expect(body).toContain('data-nature-test');
    expect(body).toContain('data-nature-go');
    const state = genin();
    dispatch(state, { type: 'nature.choose', nature: 'doton' }, content);
    game.replaceState(state);
    body = html(GraduationModal, { onClose: () => {} });
    expect(body).not.toContain('data-nature-go');
  });

  it('the offer card appears for the test and for an extra nature, and not otherwise', () => {
    expect(html(NatureOffer, {})).toContain('data-nature-offer="test"');
    const state = genin();
    dispatch(state, { type: 'nature.choose', nature: 'doton' }, content);
    game.replaceState(state);
    expect(html(NatureOffer, {})).not.toContain('data-nature-offer');
    state.skills.cc!.xp = 100_000;
    game.replaceState(state);
    expect(html(NatureOffer, {})).toContain('data-nature-offer="second"');
  });
});
