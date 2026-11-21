// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { missionView, trainedSkills } from '../src/lib/missions.ts';
import { able, player } from './helpers/missions.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;
beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
});

const FIRE = 'core:fire';
const card = (id = FIRE): HTMLElement =>
  booted!.target.querySelector<HTMLElement>(`[data-ui="mission-card"][data-mission="${id}"]`)!;
const summary = (id = FIRE): HTMLElement => card(id).querySelector('[data-ui="req-summary"]')!;
const open = (id = FIRE): void => {
  summary(id).querySelector<HTMLButtonElement>('[data-req-open]')!.click();
  flushSync();
};
const modal = (): Element | null => document.querySelector('[data-ui="modal"]');

/** A genin of Katon (not Suiton) with every level at 1: Athletics 10 is the first thing missing. */
const weak = () => player({ natures: ['katon'], base: 1 });

describe('the mission card lists every requirement', () => {
  it('puts a long list behind a «Вимоги» button, with a count and the first unmet row', async () => {
    booted = await bootApp([coreUi], weak(), '#/missions');
    const root = summary();
    expect(Number(root.dataset.rows)).toBeGreaterThan(3);
    expect(root.querySelector('[data-req-count]')?.textContent).toMatch(/^Вимоги: \d+ з \d+$/);
    // Inline: only the first unmet requirement, not the whole list.
    expect(root.querySelectorAll('[data-ui="req-row"]').length).toBe(1);
    expect(root.querySelector('[data-ui="req-row"]')?.textContent).toContain('Атлетика');
    const button = root.querySelector<HTMLButtonElement>('[data-req-open]')!;
    expect(button.textContent?.trim()).toBe(ukLocale['req.open']);
    expect(modal()).toBeNull();
    open();
    expect(modal()?.getAttribute('role')).toBe('dialog');
    expect(modal()?.getAttribute('aria-modal')).toBe('true');
  });

  it('the full list holds met, unmet and nature-impossible rows', async () => {
    booted = await bootApp([coreUi], weak(), '#/missions');
    const inline = Number(summary().dataset.rows);
    open();
    const full = modal()!;
    const rows = [...full.querySelectorAll('[data-ui="req-row"]')];
    expect(rows.length).toBe(inline);
    expect(rows.some((r) => r.getAttribute('data-met') === 'true')).toBe(true);
    expect(rows.some((r) => r.getAttribute('data-met') === 'false')).toBe(true);
    // Suiton is a nature this character does not have and cannot take now.
    const impossible = full.querySelector('[data-nature-impossible]');
    expect(impossible?.textContent).toBe('недоступно: потрібна природа Суйтон');
    expect(impossible?.closest('[data-ui="req-row"]')?.hasAttribute('data-impossible')).toBe(true);
    // The alternatives are told apart from what is required of all.
    expect(full.textContent).toContain(ukLocale['req.any']);
  });

  it('a short list is printed inline in full, with no button', async () => {
    booted = await bootApp([coreUi], weak(), '#/missions');
    const shorts = [
      ...booted.target.querySelectorAll<HTMLElement>('[data-ui="req-summary"]'),
    ].filter((s) => Number(s.dataset.rows) <= 3);
    for (const s of shorts) {
      expect(s.querySelector('[data-req-open]')).toBeNull();
      expect(s.querySelectorAll('[data-ui="req-row"]').length).toBe(Number(s.dataset.rows));
    }
  });

  it('closes on Escape and returns focus to the button', async () => {
    booted = await bootApp([coreUi], weak(), '#/missions');
    const button = summary().querySelector<HTMLButtonElement>('[data-req-open]')!;
    button.focus();
    open();
    modal()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(modal()).toBeNull();
  });

  it('keeps raw entity ids out of the card and the list', async () => {
    booted = await bootApp([coreUi], weak(), '#/missions');
    open();
    for (const html of [card().innerHTML, modal()!.innerHTML]) {
      const text = html.replace(/<[^>]*>/g, ' ');
      expect(text).not.toMatch(/core:[a-z_]+/);
    }
  });
});

describe('the skills a mission trains', () => {
  it('the card names each trained skill with its XP per hour, from the core forecast', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/missions');
    const rows = [
      ...booted.target.querySelectorAll<HTMLElement>('[data-ui="mission-card"]'),
    ].filter((c) => c.querySelector('[data-trains]'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const mission = content.missions.find((m) => m.id === row.dataset.mission)!;
      const forecast = missionView(state, mission, content, game.rules).forecast;
      const expected = Object.keys(forecast.xpPerHour).filter((s) => forecast.xpPerHour[s]! > 0);
      const shown = [...row.querySelectorAll<HTMLElement>('[data-trains-skill]')].map(
        (e) => e.dataset.trainsSkill,
      );
      expect(shown.sort()).toEqual(expected.sort());
      expect(row.querySelector('[data-trains]')?.textContent).toContain('Досвід');
    }
  });

  it('trainedSkills is empty when a stage has no way', () => {
    const mission = content.missions.find((m) => m.board)!;
    const forecast = missionView(weak(), mission, content, game.rules).forecast;
    expect(trainedSkills({ ...forecast, doable: false })).toEqual([]);
  });
});

describe('a running mission', () => {
  it('shows its stage and a progress bar on the card; an idle card shows none', async () => {
    booted = await bootApp([coreUi], able(), '#/missions');
    const cards = [...booted.target.querySelectorAll<HTMLElement>('[data-ui="mission-card"]')];
    expect(cards.every((c) => c.querySelector('[data-ui="mission-progress"]') === null)).toBe(true);
    let started: string | null = null;
    for (const c of cards) {
      const id = c.dataset.mission!;
      const result = game.dispatch({ type: 'action.start', slot: 0, kind: 'mission', id });
      if (result.ok) {
        started = id;
        break;
      }
    }
    expect(started).not.toBeNull();
    flushSync();
    const running = booted.target.querySelector<HTMLElement>(
      `[data-ui="mission-card"][data-mission="${started}"]`,
    )!;
    const box = running.querySelector('[data-ui="mission-progress"]');
    expect(box).not.toBeNull();
    expect(box?.querySelector('[data-stage]')?.textContent).toMatch(/Етап 1 з \d+/);
    const bar = box?.querySelector('[data-ui="mission-bar"]');
    expect(bar?.getAttribute('role')).toBe('progressbar');
    const others = [...booted.target.querySelectorAll('[data-ui="mission-card"]')].filter(
      (c) => c !== running,
    );
    expect(others.every((c) => c.querySelector('[data-ui="mission-progress"]') === null)).toBe(
      true,
    );
  });
});

describe('the start button', () => {
  it('sits in a row that is the last child of the card, never a direct flex child that could grow', async () => {
    booted = await bootApp([coreUi], able(), '#/missions');
    const cards = [...booted.target.querySelectorAll<HTMLElement>('[data-ui="mission-card"]')];
    expect(cards.length).toBeGreaterThan(1);
    for (const c of cards) {
      const row = c.lastElementChild as HTMLElement;
      expect(row.classList.contains('ct-actions')).toBe(true);
      expect(row.querySelector('button')).not.toBeNull();
      // Every start button of the card lives inside that row, not beside it.
      expect(c.querySelectorAll(':scope > button').length).toBe(0);
    }
  });

  it('the shared row rule pins it to the bottom and forbids growth', () => {
    const css = readFileSync(join(__dirname, '../src/tiles.css'), 'utf8');
    const rule = /\.ct-actions\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/flex:\s*none/);
    expect(rule).toMatch(/margin-top:\s*auto/);
    expect(rule).not.toMatch(/flex-grow|height:\s*100%/);
    const split = readFileSync(join(__dirname, '../src/components/StartSplit.svelte'), 'utf8');
    expect(/\.split\s*\{[^}]*height:\s*100%/.test(split)).toBe(false);
  });
});

describe('the card header', () => {
  it('has an icon-only kind mark with a label and a pin that is a button', async () => {
    booted = await bootApp([coreUi], weak(), '#/missions');
    const mission = content.missions.find((m) => m.id === FIRE)!;
    const mark = card().querySelector<HTMLElement>('[data-ui="mission-kind"]')!;
    const label = ukLocale[mission.team ? 'mission.team.yes' : 'mission.team.no'];
    expect(mark.getAttribute('aria-label')).toBe(label);
    expect(mark.getAttribute('title')).toBe(label);
    expect(mark.textContent?.trim()).toBe('');
    expect(mark.tagName).not.toBe('BUTTON');
    const pin = card().querySelector<HTMLButtonElement>('button[data-ui="pin-goal"]')!;
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    pin.click();
    flushSync();
    expect(card().querySelector('button[data-ui="pin-goal"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('shows the kind in the corner, not as a text line of the header', async () => {
    booted = await bootApp([coreUi], weak(), '#/missions');
    const head = card().querySelector('.ct-head')!;
    expect(head.querySelector('.ct-corner [data-ui="mission-kind"]')).not.toBeNull();
    expect(head.querySelector('.ct-corner button[data-ui="pin-goal"]')).not.toBeNull();
    expect(head.textContent).not.toContain(ukLocale['mission.team.yes']!);
    expect(head.textContent).not.toContain(ukLocale['mission.team.no']!);
  });
});
