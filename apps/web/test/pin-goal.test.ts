// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, listSkillActions, type GameState } from '@shinobi/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

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

function fresh(): GameState {
  const state = createState(1, game.content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  return state;
}

const PIN = ukLocale['meta.pin'];
const UNPIN = ukLocale['meta.unpin'];
const pinOf = (root: ParentNode, ref: string): HTMLButtonElement | null =>
  root.querySelector(`button[data-ui="pin-goal"][data-entity="${ref}"][aria-label]`);
const goalPanel = (): Element | null => document.querySelector('[data-ui="goal-panel"]');
const flush = () => flushSync();

/** The first skill whose page lists an action of this kind, with that action's id. */
function skillWith(kind: string): { skill: string; id: string } {
  const state = fresh();
  for (const skill of content.skills) {
    const info = listSkillActions(state, skill.id, content, game.rules).find(
      (a) => a.kind === kind,
    );
    if (info) return { skill: skill.id, id: info.id };
  }
  throw new Error(`no skill lists a ${kind} action`);
}

/** Pins through the control on the page, checks the goal and the goal panel, then unpins. */
async function pinAndUnpin(hash: string, ref: string, shownInPanel: string): Promise<void> {
  booted = await bootApp([coreUi], fresh(), hash);
  const root = booted.target;
  const pin = pinOf(root, ref);
  expect(pin, `a pin for ${ref} on ${hash}`).not.toBeNull();
  expect(pin?.getAttribute('aria-label')).toBe(PIN);
  pin?.click();
  flush();
  const [kind, ...rest] = ref.split(':');
  expect(game.state.goal).toEqual({ kind, id: rest.join(':') });
  expect(pinOf(root, ref)?.getAttribute('aria-label')).toBe(UNPIN);
  expect(pinOf(root, ref)?.dataset.pinned).toBe('true');
  const panel = goalPanel();
  expect(panel?.querySelector('[data-goal]'), 'the goal panel shows a tree').not.toBeNull();
  expect(panel?.querySelector(`[data-entity="${shownInPanel}"]`), shownInPanel).not.toBeNull();
  pinOf(root, ref)?.click();
  flush();
  expect(game.state.goal).toBeNull();
  expect(pinOf(root, ref)?.getAttribute('aria-label')).toBe(PIN);
}

describe('the pin on a tile', () => {
  it('pins and unpins a technique from the skill page; the goal panel shows its tree', async () => {
    const { skill, id } = skillWith('practice');
    const tech = content.techniques.find((t) => t.id === id);
    await pinAndUnpin(`#/skill/${skill}`, `technique:${id}`, `skill:${tech?.skill}`);
  });

  it('pins a herb from the Herbalism page', async () => {
    const { skill, id } = skillWith('gather');
    await pinAndUnpin(`#/skill/${skill}`, `item:${id}`, `item:${id}`);
  });

  it('pins a recipe from the crafting page', async () => {
    const { skill, id } = skillWith('craft');
    const recipe = content.recipes.find((r) => r.id === id);
    await pinAndUnpin(`#/skill/${skill}`, `recipe:${id}`, `skill:${recipe?.skill}`);
  });

  it('pins an exercise tile', async () => {
    const { skill, id } = skillWith('drill');
    const exercise = content.exercises.find((e) => e.id === id);
    await pinAndUnpin(`#/skill/${skill}`, `exercise:${id}`, `skill:${exercise?.skill ?? skill}`);
  });

  it('pins an obstacle of the course', async () => {
    const obstacle = content.obstacles[0];
    if (!obstacle) throw new Error('no obstacle');
    const { skill } = skillWith('course');
    await pinAndUnpin(`#/skill/${skill}`, `obstacle:${obstacle.id}`, `skill:${skill}`);
  });

  it('pins a meditation practice', async () => {
    const practice = content.practices[0];
    if (!practice) throw new Error('no practice');
    // The practice cards live on the Meditation skill page.
    let found: string | null = null;
    for (const skill of content.skills) {
      if (skill.activity === 'meditate') found = skill.id;
    }
    const skill = found ?? skillWith('meditate').skill;
    booted = await bootApp([coreUi], fresh(), `#/skill/${skill}`);
    const pin = pinOf(booted.target, `practice:${practice.id}`);
    expect(pin).not.toBeNull();
    pin?.click();
    flush();
    expect(game.state.goal).toEqual({ kind: 'practice', id: practice.id });
    expect(goalPanel()?.querySelector('[data-goal]')).not.toBeNull();
  });

  it('pins the entity a blocked mission waits for, from the mission card', async () => {
    booted = await bootApp([coreUi], fresh(), '#/missions');
    const cards = [
      ...booted.target.querySelectorAll('[data-ui="mission-card"][data-state="blocked"]'),
    ];
    const withPin = cards.find((c) => c.querySelector('button[data-ui="pin-goal"]'));
    expect(withPin, 'a blocked mission card with a pin').toBeDefined();
    const pin = withPin?.querySelector<HTMLButtonElement>('button[data-ui="pin-goal"][aria-label]');
    expect(pin?.getAttribute('aria-label')).toBe(PIN);
    pin?.click();
    flush();
    expect(game.state.goal).not.toBeNull();
    expect(pin?.dataset.pinned).toBe('true');
  });

  it('pinning another entity replaces the goal; the first pin shows unpinned again', async () => {
    const { skill } = skillWith('practice');
    booted = await bootApp([coreUi], fresh(), `#/skill/${skill}`);
    const pins = [
      ...booted.target.querySelectorAll<HTMLButtonElement>(
        'li[data-ui="action-tile"] button[data-ui="pin-goal"][aria-label]',
      ),
    ];
    expect(pins.length).toBeGreaterThan(1);
    pins[0]?.click();
    flush();
    pins[1]?.click();
    flush();
    expect(game.state.goal?.id).toBe(pins[1]?.dataset.entity?.split(/:(.+)/)[1]);
    expect(pins[0]?.dataset.pinned).toBe('false');
    expect(pins[1]?.dataset.pinned).toBe('true');
  });

  it('is a button that the keyboard reaches, with a visible focus ring', async () => {
    const { skill } = skillWith('practice');
    booted = await bootApp([coreUi], fresh(), `#/skill/${skill}`);
    const pin = booted.target.querySelector<HTMLButtonElement>(
      'li[data-ui="action-tile"] button[data-ui="pin-goal"]',
    );
    expect(pin?.tagName).toBe('BUTTON');
    expect(pin?.tabIndex).toBe(0);
    expect(pin?.hasAttribute('disabled')).toBe(false);
    // The ring is the global :focus-visible rule; the pin neither removes it nor hides itself on focus.
    const css = readFileSync(join(import.meta.dirname, '../src/components/PinGoal.svelte'), 'utf8');
    expect(css).not.toMatch(/outline:\s*(none|0)/);
    expect(css).toMatch(/\.pin:focus-visible/);
    const app = readFileSync(join(import.meta.dirname, '../src/app.css'), 'utf8');
    expect(app).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  it('gives a locked tile one pin control: the corner button, not a second caption link', async () => {
    booted = await bootApp([coreUi], fresh(), '#/skill/herb');
    const tile = [...booted.target.querySelectorAll('li[data-ui="action-tile"]')].find((li) =>
      li.querySelector('.req, .ct-locked, [data-ui="req-row"]'),
    );
    expect(tile, 'a locked tile with a requirement tree').toBeDefined();
    const pins = tile!.querySelectorAll<HTMLButtonElement>('button[data-ui="pin-goal"]');
    expect(pins.length).toBe(1);
    expect(pins[0]!.getAttribute('aria-label')).toBe(PIN);
    pins[0]!.click();
    flush();
    expect(game.state.goal).not.toBeNull();
  });

  it('is on the technique page next to the header and under the requirements', async () => {
    const tech = content.techniques.find((t) => t.src === 'N');
    booted = await bootApp([coreUi], fresh(), `#/technique/${tech?.id}`);
    const header = booted.target.querySelector('header[data-ui="entity-header"]');
    expect(header?.querySelector('button[data-ui="pin-goal"]')?.textContent).toContain(PIN);
    const section = [...booted.target.querySelectorAll('[data-ui="entity-section"]')].find((s) =>
      s.querySelector('button[data-ui="pin-goal"]'),
    );
    expect(section).toBeDefined();
  });
});

describe('the hints name controls that exist', () => {
  const hints = Object.entries(ukLocale).filter(([k]) => /^hint\.[A-Za-z]+$/.test(k));
  const uiValues = new Set(
    Object.entries(ukLocale)
      .filter(([k]) => !k.startsWith('hint.'))
      .map(([, v]) => v),
  );

  it('every «quoted» control or page name of a hint is a text of the interface', () => {
    expect(hints.length).toBeGreaterThan(10);
    const missing: string[] = [];
    for (const [key, text] of hints) {
      for (const m of text.matchAll(/«([^»]+)»/g)) {
        const name = m[1] ?? '';
        if (!uiValues.has(name)) missing.push(`${key}: «${name}»`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the pin hint is about the pin, and a tile has a control of the name it gives the pin', async () => {
    const text = ukLocale['hint.goalPanel'] ?? '';
    expect(text).toContain('булавку');
    expect(text).toContain('«Мета»');
    const { skill } = skillWith('practice');
    booted = await bootApp([coreUi], fresh(), `#/skill/${skill}`);
    const tile = booted.target.querySelector('li[data-ui="action-tile"]');
    expect(tile?.querySelector(`button[aria-label="${PIN}"]`)).not.toBeNull();
    expect(document.querySelector('[data-ui="goal-panel"]')?.getAttribute('aria-label')).toBe(
      'Мета',
    );
  });
});

describe('the Now bar on a phone', () => {
  const longest = [...content.techniques]
    .map((t) => ({ id: t.id, name: ukLocale[`technique.${t.id}.name`] ?? '' }))
    .sort((a, b) => b.name.length - a.name.length)[0];

  function running(slots: number): GameState {
    const state = fresh();
    const id = longest?.id ?? '';
    state.known[id] = true;
    state.slots = [];
    for (let i = 0; i < slots; i++) {
      state.slots.push({ action: { kind: 'practice', id }, progress: 0, share: 1, data: null });
    }
    return state;
  }

  for (const slots of [1, 2]) {
    it(`shows the whole name of the longest technique with ${slots} slot(s), the phrase and an icon stop button`, async () => {
      window.innerWidth = 375;
      booted = await bootApp([coreUi], running(slots), '#/');
      if (slots > 1) {
        booted.target.querySelector<HTMLButtonElement>('.now .more')?.click();
        flush();
      }
      const rows = booted.target.querySelectorAll('[data-ui="now-slot"]');
      expect(rows).toHaveLength(slots);
      for (const row of rows) {
        const name = row.querySelector('.name');
        expect(name?.textContent?.trim()).toBe(longest?.name);
        // The name sits on the first line and the live phrase on its own element, never inside it.
        expect(name?.closest('.line')).not.toBeNull();
        const phrase = row.querySelector('.phrase');
        expect(phrase).not.toBeNull();
        expect(name?.contains(phrase ?? null)).toBe(false);
        const stop = row.querySelector<HTMLButtonElement>('button.stop');
        expect(stop?.getAttribute('aria-label')).toBe(ukLocale['now.stop']);
        expect(stop?.querySelector('svg')).not.toBeNull();
        expect(row.getAttribute('data-ui')).toBe('now-slot');
      }
    });
  }

  it('lets the name wrap on a phone instead of cutting it with an ellipsis', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../src/components/NowBar.svelte'),
      'utf8',
    );
    const phone = source.slice(source.indexOf('@media (max-width: 768px)'));
    const rule = /\.name \{([^}]*)\}/.exec(phone)?.[1] ?? '';
    expect(rule).toContain('white-space: normal');
    expect(rule).not.toContain('ellipsis');
    expect(phone).not.toMatch(/\.name \{[^}]*max-width/);
    expect(phone).toContain('.stop-label');
    // The one-line layout of a wide screen is kept.
    expect(source).toMatch(/\.what \{[^}]*white-space: nowrap/);
    expect(source).toContain('<Slot name="now.bar"');
  });
});
