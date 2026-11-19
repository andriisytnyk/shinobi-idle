// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import {
  createState,
  syncVillage,
  updateQuests,
  villageRaids,
  type GameState,
} from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RaidPanel from '../src/components/RaidPanel.svelte';
import ReportModal from '../src/components/ReportModal.svelte';
import ToastHost from '../src/components/ToastHost.svelte';
import VillagePage from '../src/pages/VillagePage.svelte';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toasts } from '../src/lib/toasts.svelte.ts';

/* The findings of the review of the raid: links, the present state of the outcome, a small defence, progress, toasts that do not take clicks. */

const raid = content.raids[0]!;
const TICK = content.balance.K.tickMin * 60_000;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

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
  toasts.clear();
});

const village = () => {
  if (!game.state.village) throw new Error('no village');
  return game.state.village;
};
const panel = () => target.querySelector('[data-raid]');
const mountPanel = (props: { compact?: boolean; progress?: boolean } = {}): void => {
  app = mount(RaidPanel, { target, props });
  flushSync();
};

describe('the raid panel, after the review', () => {
  it('names the buildings a breach would hit as links', () => {
    mountPanel();
    const links = panel()?.querySelectorAll('[data-raid-damage] .entity-link') ?? [];
    expect(links).toHaveLength(raid.targets.length);
  });

  it('shows the present state of the buildings in the outcome: repairing, then repaired', () => {
    game.devAdvance((raid.lead + raid.hold + 2) * TICK);
    const part = raid.defence[0]!;
    if (part.t === 'building') village().levels[part.id] = 4;
    game.devAdvance(TICK);
    app = mount(VillagePage, { target, props: { focus: null } });
    flushSync();
    const hit = raid.packs - 4;
    expect(panel()?.querySelectorAll('[data-raid-repair="going"]')).toHaveLength(hit);
    expect(text(panel())).toContain('ремонт ще');
    game.devAdvance(raid.repair * TICK);
    flushSync();
    expect(panel()?.querySelectorAll('[data-raid-repair="going"]')).toHaveLength(0);
    expect(panel()?.querySelectorAll('[data-raid-repair="done"]')).toHaveLength(hit);
    expect(text(panel())).not.toContain('ремонті');
  });

  it('says a defence too small for one pack stops nobody and that the raid waits', () => {
    const part = raid.defence.find((p) => p.t === 'resource')!;
    village().res[part.id] = 1;
    village().shinobi[part.id] = 1;
    game.devAdvance(raid.lead * TICK);
    const info = villageRaids(game.state, content)[0]!;
    expect(info.defence.points).toBeGreaterThan(0);
    expect(info.defence.stops).toBe(0);
    mountPanel();
    expect(text(panel()?.querySelector('[data-raid-stops]'))).toContain('нікого не зупинить');
    // After the hold nothing breaks through: the raid waits for the player, as the text says.
    game.devAdvance((raid.hold + 2) * TICK);
    flushSync();
    expect(panel()?.getAttribute('data-phase')).toBe('active');
    expect(panel()?.querySelector('[data-raid-state="waiting"]')).not.toBeNull();
  });

  it('shows the progress of the raid on the fight page only while it is fought', () => {
    game.devAdvance(raid.lead * TICK);
    mountPanel({ compact: true, progress: true });
    expect(panel()).toBeNull();
    game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: raid.id });
    flushSync();
    expect(panel()?.getAttribute('data-phase')).toBe('active');
    expect(text(panel()?.querySelector('[data-raid-packs]'))).toContain(`0 з ${raid.packs}`);
    expect(panel()?.querySelector('[data-raid-defend]')).toBeNull();
  });
});

describe('the report of the time away', () => {
  it('tells of a raid that arrived and one that ended', () => {
    const report = {
      requestedMs: 3_600_000,
      simulatedMs: 3_600_000,
      capped: false,
      skills: [],
      mastery: [],
      techniques: [],
      stopped: [],
      raids: [
        { raid: raid.id, over: true, repelled: 0, byVillage: 4, breached: 2, ryo: 100, rep: 3 },
      ],
    };
    app = mount(ReportModal, { target, props: { report, onClose: () => {} } });
    flushSync();
    const row = document.body.querySelector('[data-report-raid]');
    expect(text(row)).toContain('Відбито груп: 4, прорвалося: 2');
    expect(text(row)).toContain('100');
  });
});

describe('toasts and clicks', () => {
  it('lets a click through an ordinary toast and keeps one that waits for an answer solid', () => {
    toasts.push({ key: 'toast.raidArrived', params: { raid: 'X' } });
    toasts.push({
      key: 'pwa.updateReady',
      params: {},
      persistent: true,
      action: { labelKey: 'pwa.update', run: () => {} },
    });
    app = mount(ToastHost, { target });
    flushSync();
    const ordinary = target.querySelector<HTMLElement>('[data-toast="toast.raidArrived"]');
    const solid = target.querySelector<HTMLElement>('[data-toast="pwa.updateReady"]');
    expect(ordinary?.style.pointerEvents).toBe('none');
    expect(solid?.style.pointerEvents).toBe('auto');
  });
});
