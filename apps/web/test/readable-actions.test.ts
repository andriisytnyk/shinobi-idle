// @vitest-environment happy-dom
import { content, iconFor } from '@shinobi/content';
import {
  actionInfo,
  defaultRules,
  listSkillActions,
  SHARE_FULL,
  xpAt,
  type GameState,
} from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionEmblem from '../src/components/ActionEmblem.svelte';
import { actionRef } from '../src/lib/entities.ts';
import { hasKey } from '../src/lib/i18n.ts';
import { emblemTint, NEUTRAL_TINT } from '../src/lib/emblem.ts';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { game } from '../src/lib/store.ts';
import { practicePhases } from '../src/lib/timing.ts';
import { bootApp, genin, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;
afterEach(() => {
  booted?.destroy();
  booted = null;
});

const FIREBALL = 'core:great_fireball';

/** A genin who knows the Great Fireball and has the skill for it. */
function caster(): GameState {
  const state = genin();
  state.player.natures = ['katon'];
  state.skills.katon!.xp = xpAt(40);
  state.known[FIREBALL] = true;
  return state;
}

/** Puts an action straight into slot 0, as if it were running. */
function put(kind: string, id: string, share = SHARE_FULL): void {
  const slot = game.state.slots[0];
  if (!slot) throw new Error('no slot');
  slot.action = { kind, id };
  slot.progress = 0;
  slot.share = share;
}

/** Moves the running cycle of slot 0 to `fraction` and lets the app draw it. */
function setFraction(b: BootedApp, fraction: number): void {
  const info = actionInfo(game.state, game.state.slots[0]?.action ?? { kind: '', id: '' }, content);
  const slot = game.state.slots[0];
  if (!slot || !info) throw new Error('no running action');
  slot.progress = Math.floor(fraction * info.intervalMs * SHARE_FULL);
  b.advance(1);
}

const nowText = (b: BootedApp): string =>
  (b.target.querySelector('[data-ui="now-slot"]')?.textContent ?? '').replace(/\s+/g, ' ');

describe('the Now bar says what is happening', () => {
  it('has no progress bar element', async () => {
    booted = await bootApp([coreUi], caster());
    put('practice', FIREBALL);
    booted.advance(1);
    expect(booted.target.querySelector('footer [role="progressbar"]')).toBeNull();
    expect(booted.target.querySelector('footer [data-ui="action-progress"]')).toBeNull();
    expect(booted.target.querySelector('[data-ui="now-slot"] button.stop')).not.toBeNull();
    expect(
      booted.target.querySelector('[data-ui="now-slot"] [data-ui="action-emblem"]'),
    ).not.toBeNull();
  });

  it('names a phrase and an object link for each kind of action', async () => {
    booted = await bootApp([coreUi], caster());
    const herb = content.herbs[0]?.id ?? '';
    const recipe = content.recipes[0]?.id ?? '';
    const drill = content.exercises[0]?.id ?? '';
    const meditate = content.practices[0]?.id ?? '';
    const cell = content.cells[0]?.id ?? '';
    const cases: [string, string, string][] = [
      ['gather', herb, 'Збирає:'],
      ['craft', recipe, 'Варить:'],
      ['drill', drill, 'Тренує:'],
      ['meditate', meditate, 'Медитує:'],
      ['course', 'ath', 'Долає:'],
      ['explore', cell, 'Розвідує:'],
      ['walk', cell, 'Йде до:'],
    ];
    for (const [kind, id, phrase] of cases) {
      put(kind, id);
      booted.advance(1);
      expect(nowText(booted), kind).toContain(phrase);
      const ref = actionRef({ kind, id });
      expect(
        booted.target.querySelector(`[data-ui="now-slot"] a[href*="${ref.kind}/${ref.id}"]`),
        `${kind} links its object`,
      ).not.toBeNull();
    }
  });

  it('shows each phase of a practice: focus, the seals one by one, release', async () => {
    booted = await bootApp([coreUi], caster(), '#/skill/katon');
    // Half speed: every seal is on screen long enough to be named one by one.
    put('practice', FIREBALL, SHARE_FULL / 2);
    const phases = practicePhases(game.state, FIREBALL, content);
    if (!phases) throw new Error('no phases');
    expect(phases.count).toBe(6);

    setFraction(booted, phases.focusEnd / 2);
    expect(nowText(booted)).toContain('Зосереджується');

    const span = (phases.sealsEnd - phases.focusEnd) / phases.count;
    const glyphs = ['巳', '未', '申', '亥', '午', '寅'];
    const names = ['Змія', 'Баран', 'Мавпа', 'Кабан', 'Кінь', 'Тигр'];
    glyphs.forEach((glyph, i) => {
      setFraction(booted as BootedApp, phases.focusEnd + (i + 0.5) * span);
      const text = nowText(booted as BootedApp);
      expect(text).toContain('Складає печатки:');
      expect(text).toContain(glyph);
      expect(text).toContain(names[i]);
      const strip = (booted as BootedApp).target.querySelector(
        `[data-action="${FIREBALL}"] [data-seal-strip]`,
      );
      expect(strip?.getAttribute('data-mode')).toBe('steps');
      expect(strip?.getAttribute('data-seal')).toBe(String(i));
    });

    setFraction(booted, (phases.sealsEnd + 1) / 2);
    expect(nowText(booted)).toContain('Вивільняє');
    expect(nowText(booted)).not.toContain('Відновлює');
  });

  it('a technique without seals goes focus, then release', async () => {
    booted = await bootApp([coreUi], caster());
    const plain = content.techniques.find((t) => t.sealSeq.length === 0);
    if (!plain) throw new Error('no technique without seals');
    game.state.known[plain.id] = true;
    put('practice', plain.id);
    const phases = practicePhases(game.state, plain.id, content);
    if (!phases) throw new Error('no phases');
    expect(phases.focusEnd).toBe(phases.sealsEnd);
    setFraction(booted, 0.3);
    expect(nowText(booted)).toContain('Зосереджується');
    setFraction(booted, 0.999);
    expect(nowText(booted)).toContain('Вивільняє');
  });
});

describe('the running technique tile shows the seals alive', () => {
  it('lights the right seal at full speed in a sweep, one by one when slow enough', async () => {
    booted = await bootApp([coreUi], caster(), '#/skill/katon');
    put('practice', FIREBALL);
    const phases = practicePhases(game.state, FIREBALL, content);
    if (!phases) throw new Error('no phases');
    const mid = (phases.focusEnd + phases.sealsEnd) / 2;
    setFraction(booted, mid);
    const tile = booted.target.querySelector(`[data-ui="action-tile"][data-action="${FIREBALL}"]`);
    const strip = tile?.querySelector('[data-seal-strip]');
    // A cast of about a second and a half over six seals is 250 ms or less per seal: a sweep.
    const cycleMs =
      actionInfo(game.state, { kind: 'practice', id: FIREBALL }, content)?.intervalMs ?? 0;
    const sealMs = ((phases.sealsEnd - phases.focusEnd) / 6) * cycleMs;
    expect(strip?.getAttribute('data-mode')).toBe(sealMs < 250 ? 'sweep' : 'steps');
    expect(tile?.querySelectorAll('[data-seal-index]')).toHaveLength(6);

    put('practice', FIREBALL, SHARE_FULL / 2);
    const span = (phases.sealsEnd - phases.focusEnd) / 6;
    setFraction(booted, phases.focusEnd + 3.5 * span);
    const slow = booted.target.querySelector(
      `[data-ui="action-tile"][data-action="${FIREBALL}"] [data-seal-strip]`,
    );
    expect(slow?.getAttribute('data-mode')).toBe('steps');
    expect(slow?.getAttribute('data-seal')).toBe('3');
    expect(slow?.getAttribute('data-phase')).toBe('seal');
  });

  it('shows the strip still and compact on an idle tile, kanji only', async () => {
    booted = await bootApp([coreUi], caster(), '#/skill/katon');
    const strip = booted.target.querySelector(
      `[data-ui="action-tile"][data-action="${FIREBALL}"] [data-seal-strip]`,
    );
    expect(strip?.getAttribute('data-mode')).toBe('still');
    expect(strip?.querySelector('.name')).toBeNull();
    expect(strip?.textContent).toContain('巳');
  });
});

describe('emblems', () => {
  it('every action of the core pack has a pictogram of its own, never the fallback', () => {
    const state = caster();
    let seen = 0;
    for (const skill of content.skills) {
      for (const info of listSkillActions(state, skill.id, content, game.rules)) {
        const ref = actionRef(info);
        const kind = (info.kind === 'gather' ? 'item' : ref.kind) as 'item';
        const name = iconFor(kind, ref.id, content.icons);
        expect(name, `${kind}:${ref.id}`).toBeDefined();
        seen++;
      }
    }
    for (const o of content.obstacles) {
      expect(iconFor('obstacle', o.id, content.icons), o.id).toBeDefined();
      seen++;
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('puts an emblem on every tile of the skill pages, none of them the fallback', async () => {
    booted = await bootApp([coreUi], caster());
    for (const skill of ['tai', 'nin', 'katon', 'herb', 'alch', 'prov', 'cc', 'med']) {
      await booted.go(`#/skill/${skill}`);
      const tiles = booted.target.querySelectorAll('[data-ui="action-tile"]');
      expect(tiles.length, skill).toBeGreaterThan(0);
      for (const tile of tiles) {
        const emblem = tile.querySelector('[data-ui="action-emblem"]');
        expect(emblem, `${skill} ${tile.getAttribute('data-entity')}`).not.toBeNull();
        expect(emblem?.getAttribute('data-emblem-icon')).not.toBe('fallback');
      }
    }
  });

  it('uses one pictogram for at most two actions of a skill', () => {
    const state = caster();
    for (const skill of content.skills) {
      const counts = new Map<string, number>();
      for (const info of listSkillActions(state, skill.id, content, game.rules)) {
        const ref = actionRef(info);
        const name = iconFor(
          (info.kind === 'gather' ? 'item' : ref.kind) as 'item',
          ref.id,
          content.icons,
        );
        counts.set(name ?? '', (counts.get(name ?? '') ?? 0) + 1);
      }
      expect(
        [...counts].filter(([, n]) => n > 2),
        skill.id,
      ).toEqual([]);
    }
  });

  it('gives an action of another pack without an icon the fallback on the same medallion', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const app = mount(ActionEmblem, {
      target,
      props: { kind: 'recipe', id: 'mod:mystery', skill: 'alch' },
    });
    flushSync();
    const emblem = target.querySelector('[data-ui="action-emblem"]');
    expect(emblem?.getAttribute('data-emblem-icon')).toBe('fallback');
    expect(emblem?.querySelector('svg')).not.toBeNull();
    unmount(app);
    target.remove();
  });

  it('tints a technique by its nature and falls back to neutral for a nature without a token', () => {
    expect(emblemTint(content, { kind: 'technique', id: FIREBALL })).toContain('--nature-katon');
    const plain = content.techniques.find((t) => t.skill === 'tai');
    expect(emblemTint(content, { kind: 'technique', id: plain?.id })).toBe(NEUTRAL_TINT);
    const odd = {
      ...content,
      natures: content.natures.map((n) => (n.id === 'katon' ? { ...n, color: '' } : n)),
    };
    expect(emblemTint(odd, { kind: 'technique', id: FIREBALL })).toBe(NEUTRAL_TINT);
    expect(emblemTint(content, { kind: 'recipe', skill: 'alch' })).toContain('--group-craft');
    expect(emblemTint(content, { kind: 'recipe', skill: 'nope' })).toBe(NEUTRAL_TINT);
  });
});

describe('every action kind of the content has a name in the Now bar', () => {
  it('resolves each action to a localised name, never a raw id', async () => {
    booted = await bootApp([coreUi], caster());
    const ids = new Set<string>();
    // A fight starts by an enemy id in the interface; a zone id is only accepted by the core.
    for (const [name, list] of Object.entries(content)) {
      if (!Array.isArray(list) || name === 'zones') continue;
      for (const row of list) {
        const id = (row as { id?: unknown } | null)?.id;
        if (typeof id === 'string') ids.add(id);
      }
    }
    const kinds = new Set<string>();
    for (const [kind, rule] of Object.entries(defaultRules.actionKinds)) {
      for (const id of ids) {
        if (!rule.has(id, content)) continue;
        kinds.add(kind);
        const ref = actionRef({ kind, id });
        expect(hasKey(`${ref.kind}.${ref.id}.name`), `${kind} ${id}`).toBe(true);
      }
    }
    // The exam operations are among them: they ran into a raw id once.
    expect(kinds.has('operation')).toBe(true);
    expect(kinds.has('senseiTest')).toBe(true);
  });
});
