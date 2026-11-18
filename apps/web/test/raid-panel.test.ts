// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { createState, syncVillage, updateQuests, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import VillagePage from '../src/pages/VillagePage.svelte';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toastFor as toastForIn } from '../src/lib/toasts.svelte.ts';

const toastFor = (event: Parameters<typeof toastForIn>[0]) => toastForIn(event, content);
const raid = content.raids[0]!;
const TICK = content.balance.K.tickMin * 60_000;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A genin whose outskirts chain has reached the raid. */
function calledGenin(): GameState {
  const state = createState(1, content);
  state.player.rank = 'genin';
  state.player.name = 'Тест';
  syncVillage(state, content);
  state.quests['core:outskirts'] = { step: 3, base: 0, done: false };
  updateQuests(state, content);
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

const mountVillage = (): void => {
  app = mount(VillagePage, { target, props: { focus: null } });
  flushSync();
};
const panel = () => target.querySelector('[data-raid]');
const village = () => {
  if (!game.state.village) throw new Error('no village');
  return game.state.village;
};

describe('the raid on the village page', () => {
  it('shows nothing before the story calls the raid', () => {
    const fresh = createState(1, content);
    fresh.player.rank = 'genin';
    syncVillage(fresh, content);
    game.replaceState(fresh);
    mountVillage();
    expect(panel()).toBeNull();
  });

  it('announces the raid coming, with the time left and what the village would stop', () => {
    mountVillage();
    expect(panel()?.getAttribute('data-phase')).toBe('warned');
    expect(text(panel())).toContain("Напад «Сірих пов'язок»");
    expect(text(panel()?.querySelector('[data-raid-state]'))).toContain('До нападу');
    // The defence is listed part by part, and with none the village says it stops nobody.
    expect(panel()?.querySelectorAll('[data-raid-part]')).toHaveLength(raid.defence.length);
    expect(text(panel()?.querySelector('[data-raid-stops]'))).toContain('Захисту немає');
    // Nothing to fight yet.
    expect(panel()?.querySelector('[data-raid-defend]')).toBeNull();
  });

  it('shows the defence the village has and how many packs it stops', () => {
    const part = raid.defence[0]!;
    if (part.t === 'building') village().levels[part.id] = 3;
    mountVillage();
    expect(text(panel()?.querySelector(`[data-raid-part="${part.id}"]`))).toContain('рівень 3');
    expect(text(panel()?.querySelector('[data-raid-stops]'))).toContain(
      `Село саме зупинить груп: 3 з ${raid.packs}`,
    );
  });

  it('at the gates offers the fight, which starts the raid fight in the first slot', () => {
    game.devAdvance(raid.lead * TICK);
    mountVillage();
    expect(panel()?.getAttribute('data-phase')).toBe('active');
    const button = target.querySelector<HTMLButtonElement>('[data-raid-defend]');
    expect(button).not.toBeNull();
    expect(text(panel()?.querySelector('[data-raid-packs]'))).toContain(`0 з ${raid.packs}`);
    button?.click();
    flushSync();
    expect(game.state.slots[0]?.action).toEqual({ kind: 'fight', id: raid.id });
    expect(panel()?.querySelector('[data-raid-fight]')).not.toBeNull();
    expect(panel()?.querySelector('[data-raid-defend]')).toBeNull();
  });

  it('says that the raid waits when nobody can stop it, and reads the outcome when it is over', () => {
    game.devAdvance((raid.lead + raid.hold + 2) * TICK);
    mountVillage();
    expect(panel()?.querySelector('[data-raid-state="waiting"]')).not.toBeNull();
    const part = raid.defence[0]!;
    if (part.t === 'building') village().levels[part.id] = 4;
    game.devAdvance(TICK);
    flushSync();
    expect(panel()?.getAttribute('data-phase')).toBe('over');
    expect(text(panel()?.querySelector('[data-raid-by-village]'))).toContain('4');
    expect(text(panel()?.querySelector('[data-raid-breached]'))).toContain(`${raid.packs - 4}`);
    expect(text(panel()?.querySelector('[data-raid-paid]'))).toContain('Нагорода');
    // Two packs got through: the buildings that stop are named, and the card of one of them says so.
    expect(panel()?.querySelectorAll('[data-raid-damaged] li')).toHaveLength(raid.packs - 4);
    const hit = raid.targets[0]!;
    expect(text(target.querySelector(`[data-building="${hit}"] [data-damaged]`))).toContain(
      'Пошкоджено',
    );
  });

  it('has a toast for the call, the arrival, the end and the repair', () => {
    expect(toastFor({ type: 'raidCalled', raid: raid.id, ticks: 6, at: 0 })?.key).toBe(
      'toast.raidCalled',
    );
    expect(toastFor({ type: 'raidArrived', raid: raid.id, at: 0 })?.key).toBe('toast.raidArrived');
    expect(
      toastFor({
        type: 'raidOver',
        raid: raid.id,
        repelled: 4,
        byVillage: 1,
        breached: 1,
        damaged: [],
        ryo: 0,
        rep: 0,
        at: 0,
      }),
    ).toEqual({
      key: 'toast.raidOver',
      params: { raid: "Напад «Сірих пов'язок»", done: 5, breached: 1 },
    });
    expect(toastFor({ type: 'buildingRepaired', building: 'core:farms', at: 0 })?.ref).toEqual({
      kind: 'building',
      id: 'core:farms',
    });
  });
});
