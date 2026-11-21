// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, defaultRules, xpAt, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import FightHand from '../src/components/FightHand.svelte';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { buildScene, type HandView } from '../src/lib/fight-scene.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const LEAF = 'core:leaf_whirlwind';
const name = (id: string): string => ukLocale[`technique.${id}.name`] ?? id;

/** A genin who knows the rank D techniques and fights the wolves. */
function fighter(known: string[] | null = null): GameState {
  const state = createState(9, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(12);
  }
  if (known) for (const id of known) state.known[id] = true;
  else for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  for (const cell of content.cells) state.world.explores[cell.id] = 9999;
  state.flags['region.forest.unlocked'] = true;
  return state;
}

let booted: BootedApp | null = null;
let mounted: ReturnType<typeof mount> | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  if (mounted) unmount(mounted);
  mounted = null;
  host?.remove();
  host = null;
});

const view = (patch: Partial<HandView> & { id: string }): HandView => ({
  state: 'ready',
  leftMs: 0,
  cooldownMs: 8300,
  cost: 6.6,
  pool: 'stamina',
  ...patch,
});

function drawHand(hand: HandView[]): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  const timing = { fraction: 0.4, cycleMs: 1000, running: false, repeat: false };
  mounted = mount(FightHand, { target: host, props: { hand, timing } });
  flushSync();
  return host;
}

describe('F2: the scene reads the hand of the fight', () => {
  const sceneHand = () => buildScene(game.state, game.content, defaultRules)?.hand ?? [];

  it('shows ready, casting, cooldown, then the reasons it cannot be cast', () => {
    game.replaceState(fighter([LEAF]));
    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_wolf' }),
    ).toEqual({ ok: true });
    const states = new Set<string>();
    for (let i = 0; i < 300; i++) {
      game.devAdvance(100);
      for (const h of sceneHand()) {
        states.add(h.state);
        if (h.state === 'cooldown') {
          expect(h.leftMs).toBeGreaterThan(0);
          expect(h.leftMs).toBeLessThanOrEqual(h.cooldownMs);
        } else expect(h.leftMs).toBe(0);
      }
      if (states.has('casting') && states.has('cooldown') && states.has('ready')) break;
    }
    expect(states.has('casting')).toBe(true);
    expect(states.has('cooldown')).toBe(true);
    expect(states.has('ready')).toBe(true);
    expect(sceneHand().map((h) => h.id)).toEqual([LEAF]);

    // The pool the technique really uses, empty: the screen names that pool and the cost.
    const combat = game.state.combat!;
    const kit = combat.fight.kit.techniques[0]!;
    combat.fight.player.cd[LEAF] = 0;
    combat.fight.player.act = null;
    combat.fight.player.chakra = 0;
    combat.fight.player.stamina = 0;
    const poor = sceneHand().find((h) => h.id === LEAF)!;
    expect(poor.state).toBe(kit.pool);
    expect(poor.cost).toBe(kit.cost);
    // A technique that needs a stance, with none active.
    kit.requiresStance = true;
    expect(sceneHand().find((h) => h.id === LEAF)!.state).toBe('stance');
  });

  it('shows every technique of the hand in hand order', () => {
    game.replaceState(fighter());
    game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_wolf' });
    game.devAdvance(100);
    const scene = buildScene(game.state, game.content, defaultRules)!;
    expect(scene.hand.map((h) => h.id)).toEqual(
      game.state.combat!.fight.kit.techniques.map((t) => t.id),
    );
    expect(scene.hand.length).toBeGreaterThan(1);
  });
});

describe('F2: the technique strip', () => {
  it('prints the state of every chip, with a tooltip and a spoken label', () => {
    const el = drawHand([
      view({ id: LEAF, state: 'cooldown', leftMs: 2400 }),
      view({ id: 'core:great_fireball', state: 'chakra', pool: 'chakra', cost: 12 }),
      view({ id: 'core:dynamic_entry', state: 'stamina', cost: 6.6 }),
      view({ id: 'core:body_flicker', state: 'stance' }),
      view({ id: 'core:body_replacement', state: 'casting' }),
      view({ id: 'core:clone', state: 'ready' }),
    ]);
    const chips = [...el.querySelectorAll<HTMLElement>('[data-ui="fight-hand-chip"]')];
    expect(chips.map((c) => c.dataset.state)).toEqual([
      'cooldown',
      'chakra',
      'stamina',
      'stance',
      'casting',
      'ready',
    ]);
    const first = chips[0]!;
    expect(first.getAttribute('aria-label')).toBe(`${name(LEAF)}: перезарядка 2,4 с`);
    expect(first.getAttribute('title')).toBe(first.getAttribute('aria-label'));
    expect(first.querySelector('[data-hand-note]')?.textContent).toBe('2,4 с');
    expect(first.querySelector('.drain')).not.toBeNull();
    expect(chips[1]!.getAttribute('aria-label')).toContain('бракує чакри (12 чак.)');
    expect(chips[2]!.getAttribute('aria-label')).toContain('бракує витривалості (6,6 вит.)');
    expect(chips[2]!.querySelector('[data-hand-note]')?.textContent).toContain('6,6 вит.');
    expect(chips[3]!.getAttribute('aria-label')).toContain('потрібна стійка');
    expect(chips[4]!.querySelector('.time-bar')).not.toBeNull();
    expect(chips[5]!.querySelector('[data-hand-note]')?.textContent).toBe('');
    for (const c of chips) expect(c.querySelector('a.entity-link')).not.toBeNull();
    expect(el.querySelectorAll('[data-ui="action-emblem"]').length).toBe(chips.length);
  });

  it.each([375, 1440])(
    'sits under the player on a screen %i px wide, with no raw ids',
    async (w) => {
      (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
        width: w,
        height: 800,
      });
      booted = await bootApp([coreUi], fighter([LEAF]), '#/combat');
      game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_wolf' });
      booted.advance(2000);
      const side = booted.target.querySelector<HTMLElement>('[data-side="player"]')!;
      const kids = [...side.children];
      const fighterAt = kids.findIndex((k) => k.matches('[data-ui="fighter"]'));
      const handAt = kids.findIndex((k) => k.querySelector('[data-ui="fight-hand"]') !== null);
      expect(fighterAt).toBeGreaterThanOrEqual(0);
      expect(handAt).toBe(fighterAt + 1);
      const chip = side.querySelector<HTMLElement>('[data-ui="fight-hand-chip"]')!;
      expect(chip.getAttribute('aria-label')).toContain(name(LEAF));
      const strip = side
        .querySelector('[data-ui="fight-hand"]')!
        .outerHTML.replace(/(href|data-entity)="[^"]*"/g, '');
      expect(strip).not.toContain('core:');
    },
  );
});
