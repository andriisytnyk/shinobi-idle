// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { dispatch, growSlots, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import SquadPanel from '../src/components/SquadPanel.svelte';
import ReportModal from '../src/components/ReportModal.svelte';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { t } from '../src/lib/i18n.ts';
import type { AnbuReport } from '../src/lib/persistence.ts';
import {
  defaultPerformer,
  fightersOf,
  noteFor,
  performersOf,
  reportSections,
  squadNotices,
  LIFE_WARNING_MS,
  type Performer,
} from '../src/lib/squad.ts';
import { squadUi } from '../src/lib/squad-ui.svelte.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toasts } from '../src/lib/toasts.svelte.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { player } from './helpers/missions.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const CLONE = 'core:shadow_clone';

let booted: BootedApp | null = null;
let mounted: ReturnType<typeof mount> | null = null;
let host: HTMLElement | null = null;
const q = (sel: string) => (host ?? booted?.target)?.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [
  ...((host ?? booted?.target)?.querySelectorAll<HTMLElement>(sel) ?? []),
];

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  host?.remove();
  host = null;
  booted?.destroy();
  booted = null;
  toasts.clear();
  squadUi.reset();
  settings.setExt('core:missions.onlyAvailable', false);
});

/** A genin who knows the clone technique. */
function cloner(): GameState {
  const state = player({
    natures: ['katon'],
    levels: { nin: 50, med: 40, herb: 20, alch: 20, cc: 30 },
    known: [CLONE],
    bank: { 'core:mint': 500, 'core:water': 500 },
    rankC: true,
  });
  growSlots(state, content);
  return state;
}

const drill = () => content.exercises.find((e) => e.level <= 20)?.id ?? '';
const start = (state: GameState, slot: number, kind: string, id: string) =>
  dispatch(state, { type: 'action.start', slot, kind, id }, content);

/** A performer for the tests of the pure parts and of the injected panel. */
const performer = (extra: Partial<Performer> & Pick<Performer, 'id'>): Performer => ({
  slot: extra.id,
  clone: extra.id > 0,
  n: extra.id,
  state: 'idle',
  action: null,
  ref: null,
  chakraShare: 0.5,
  ...extra,
});

/** Mounts the panel alone, with the performers it is told to show. */
function panel(performers: Performer[], compact = false): void {
  host = document.createElement('div');
  document.body.append(host);
  mounted = mount(SquadPanel, { target: host, props: { performers, compact } });
  flushSync();
}

describe('the squad panel', () => {
  it('is absent before the clone technique is known', async () => {
    const state = player({ natures: ['katon'], base: 5 });
    start(state, 0, 'drill', drill());
    booted = await bootApp([coreUi], state, '#/skill/tai');
    expect(q('[data-ui="squad"]')).toBeNull();
    expect(qa('[data-ui="now-slot"]').length).toBe(1);
  });

  it('shows one row per performer with its state, beside the Now bar that keeps its detail lines', async () => {
    const state = cloner();
    start(state, 0, 'drill', drill());
    start(state, 1, 'gather', 'core:mint');
    booted = await bootApp([coreUi], state, '#/skill/tai');
    const rows = qa('[data-ui="squad-row"]');
    expect(rows.map((r) => r.dataset.performer)).toEqual(['0', '1']);
    expect(rows.map((r) => r.dataset.state)).toEqual(['working', 'working']);
    expect(rows[0]?.querySelector('.name')?.textContent).toBe(t('squad.you'));
    expect(rows[1]?.querySelector('.name')?.textContent).toBe(t('squad.clone', { n: 1 }));
    expect(rows[1]?.querySelector('[data-squad-doing]')?.textContent).toContain('Збирає');
    // The header counts the clones: one of one, none free.
    expect(q('[data-squad-counts]')?.textContent).toBe(
      t('squad.counts', { n: 1, max: 1, free: 0 }),
    );
    // The character's chakra share is halved while the clone lives.
    expect(rows[0]?.querySelector('[data-squad-chakra] dd')?.textContent).toBe(
      t('squad.chakraValue', { pct: 50 }),
    );
    expect(qa('[data-ui="now-slot"]').length).toBe(2);
  });

  it('shows the performer that stands, fights, or waits, in its own colour state', () => {
    panel([
      performer({ id: 0, state: 'working', action: { kind: 'drill', id: 'x' }, chakraShare: 1 }),
      performer({ id: 1, state: 'idle' }),
      performer({ id: 2, state: 'fighting', action: { kind: 'fight', id: 'y' } }),
      performer({ id: 3, state: 'standing', action: { kind: 'stand', id: 'z' } }),
    ]);
    expect(qa('[data-ui="squad-row"]').map((r) => r.dataset.state)).toEqual([
      'working',
      'idle',
      'fighting',
      'standing',
    ]);
    expect(q('[data-squad-counts]')?.textContent).toBe(
      t('squad.counts', { n: 3, max: 3, free: 1 }),
    );
  });

  it('lights an idle clone and gives it «Дати справу», which picks it as the performer', () => {
    panel([performer({ id: 0, chakraShare: 0.5 }), performer({ id: 1, state: 'idle' })]);
    const idle = q('[data-ui="squad-row"][data-performer="1"]');
    expect(idle?.classList.contains('idle')).toBe(true);
    expect(q('[data-ui="squad-row"][data-performer="0"]')?.classList.contains('idle')).toBe(false);
    // Only a clone has the button: the character's row has none.
    expect(qa('[data-give]').length).toBe(1);
    q('[data-give]')?.click();
    flushSync();
    expect(squadUi.picked).toBe(1);
    expect(toasts.list.at(-1)?.key).toBe('squad.giveHint');
  });

  it('shows the life, the held knowledge and the fatigue when the clone model has them', () => {
    panel([
      performer({ id: 0, chakraShare: 0.5, fatigueMs: 12 * 60_000 }),
      performer({
        id: 1,
        state: 'working',
        action: { kind: 'drill', id: 'x' },
        lifeMs: 34 * 60_000,
        lifeMaxMs: 60 * 60_000,
        held: { xp: 1240 },
      }),
    ]);
    expect(q('[data-squad-life] dd')?.textContent).toContain('≈');
    expect(q('[data-squad-held] dd')?.textContent).toContain('1');
    expect(q('[data-squad-fatigue] dd')?.textContent).not.toBe('');
    expect(q('progress.life')?.getAttribute('max')).toBe(String(60 * 60_000));
  });

  it('is a strip of chips on a phone, and a tap on a chip opens the sheet with the rows', () => {
    panel(
      [
        performer({ id: 0, state: 'working', action: { kind: 'drill', id: 'x' } }),
        performer({ id: 1, state: 'idle' }),
      ],
      true,
    );
    expect(qa('[data-ui="squad-chip"]').map((c) => c.dataset.state)).toEqual(['working', 'idle']);
    expect(q('[data-ui="squad-sheet"]')).toBeNull();
    q('[data-ui="squad-chip"]')?.click();
    flushSync();
    expect(q('[data-ui="squad-sheet"]')?.getAttribute('role')).toBe('dialog');
    expect(qa('[data-ui="squad-row"]').length).toBe(2);
    q('[data-ui="squad-sheet"] .close')?.click();
    flushSync();
    expect(q('[data-ui="squad-sheet"]')).toBeNull();
  });
});

describe('the performer', () => {
  it('is the first idle clone, else the character; a pick overrides, a gone pick does not', () => {
    const you = performer({ id: 0, state: 'working' });
    const busy = performer({ id: 1, state: 'working' });
    const idle = performer({ id: 2, state: 'idle' });
    expect(defaultPerformer([you, busy], null).id).toBe(0);
    expect(defaultPerformer([you, busy, idle], null).id).toBe(2);
    expect(defaultPerformer([you, busy, idle], 1).id).toBe(1);
    expect(defaultPerformer([you, busy], 5).id).toBe(0);
  });

  it('says what the menu entry would do', () => {
    const act = { kind: 'gather', id: 'core:mint' };
    expect(
      noteFor(performer({ id: 0, state: 'working', action: act }), 'gather', 'core:mint'),
    ).toBe('same');
    expect(noteFor(performer({ id: 0, state: 'working', action: act }), 'gather', 'x')).toBe(
      'replaces',
    );
    expect(noteFor(performer({ id: 1 }), 'gather', 'x')).toBe('free');
  });
});

describe('the split start button', () => {
  const tile = () => q('[data-herb="core:mint"]');
  const main = () => tile()?.querySelector<HTMLButtonElement>('[data-ui="start-split"] .main');
  const chevron = () =>
    tile()?.querySelector<HTMLButtonElement>('[data-ui="start-split"] .chevron');

  it('is a plain «Почати» until the clone technique is known', async () => {
    booted = await bootApp([coreUi], player({ natures: ['katon'], base: 20 }), '#/skill/herb');
    expect(main()?.textContent?.trim()).toBe(t('tile.start'));
    expect(chevron()).toBeNull();
  });

  it('names the performer on the button and starts the action with it', async () => {
    booted = await bootApp([coreUi], cloner(), '#/skill/herb');
    expect(main()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `${t('tile.start')} · ${t('squad.you')}`,
    );
    main()?.click();
    flushSync();
    expect(game.state.slots[0]?.action).toEqual({ kind: 'gather', id: 'core:mint' });
    // It runs now: the button stops it, and the tile carries the mark of who runs it.
    expect(main()?.textContent).toContain(t('tile.stop'));
    expect(tile()?.querySelector('[data-ui="performer-mark"]')?.textContent).toBe(t('squad.you'));
  });

  it('lists every performer with what it does, and a pick from the menu starts with it', async () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    booted = await bootApp([coreUi], state, '#/skill/herb');
    chevron()?.click();
    flushSync();
    expect(chevron()?.getAttribute('aria-expanded')).toBe('true');
    const items = qa('[data-ui="performer-menu"] [role="menuitem"]');
    expect(items.map((i) => i.dataset.performer ?? 'new')).toEqual(['0', '1', 'new']);
    expect(items[0]?.dataset.note).toBe('free');
    expect(items[1]?.dataset.note).toBe('replaces');
    expect(items[1]?.textContent).toContain(t('squad.menu.replaces', { what: '' }).split(':')[0]);
    // The clone is picked: its work is replaced by the herb.
    items[1]?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toEqual({ kind: 'gather', id: 'core:mint' });
    expect(qa('[data-ui="performer-menu"]').length).toBe(0);
  });

  it('closes the menu on Escape and offers «Новий клон для цієї дії», which makes a clone that does it', async () => {
    booted = await bootApp([coreUi], cloner(), '#/skill/herb');
    chevron()?.click();
    flushSync();
    q('[data-ui="performer-menu"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    flushSync();
    expect(q('[data-ui="performer-menu"]')).toBeNull();
    chevron()?.click();
    flushSync();
    const fresh = q('[data-new-clone]') as HTMLButtonElement | null;
    expect(fresh?.textContent).toContain(t('squad.menu.newClone'));
    expect(fresh?.disabled).toBe(false);
    fresh?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toEqual({ kind: 'gather', id: 'core:mint' });
    expect(game.state.slots[0]?.action).toBeNull();
    // The clone runs it, so the button now stops it, and it names the clone.
    expect(main()?.textContent).toContain(t('squad.clone', { n: 1 }));
    expect(tile()?.querySelector('[data-ui="performer-mark"]')?.textContent).toBe(
      t('squad.mark.clone', { n: 1 }),
    );
  });

  it('turns «Новий клон» off when every clone is busy', async () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    booted = await bootApp([coreUi], state, '#/skill/herb');
    chevron()?.click();
    flushSync();
    expect((q('[data-new-clone]') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('follows the performer picked in the squad', async () => {
    const state = cloner();
    start(state, 1, 'drill', drill());
    booted = await bootApp([coreUi], state, '#/skill/herb');
    squadUi.pick(1);
    flushSync();
    expect(main()?.textContent).toContain(t('squad.clone', { n: 1 }));
    main()?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toEqual({ kind: 'gather', id: 'core:mint' });
    // Starting by a pick uses it up: the next start names the default again.
    expect(squadUi.picked).toBeNull();
  });
});

describe('the dispel preview', () => {
  async function withClone(): Promise<void> {
    const state = cloner();
    start(state, 0, 'drill', drill());
    start(state, 1, 'gather', 'core:mint');
    booted = await bootApp([coreUi], state, '#/skill/tai');
  }

  it('asks first, says what the clone holds, and dispels only on confirm', async () => {
    await withClone();
    q('[data-ui="squad-row"][data-performer="1"] [data-squad-stop]')?.click();
    flushSync();
    const preview = q('[data-ui="dispel-preview"]');
    expect(preview).not.toBeNull();
    // Today a clone holds nothing: its work is the character's already.
    expect(preview?.querySelector('[data-dispel-empty]')?.textContent).toBe(
      t('squad.dispel.nothing'),
    );
    expect(game.state.slots[1]?.action).not.toBeNull();
    q('[data-dispel-cancel]')?.click();
    flushSync();
    expect(q('[data-ui="dispel-preview"]')).toBeNull();
    expect(game.state.slots[1]?.action).not.toBeNull();

    q('[data-ui="squad-row"][data-performer="1"] [data-squad-stop]')?.click();
    flushSync();
    q('[data-dispel-confirm]')?.click();
    flushSync();
    expect(game.state.slots[1]?.action).toBeNull();
    expect(game.state.slots[0]?.action).not.toBeNull();
    expect(q('[data-ui="dispel-preview"]')).toBeNull();
    // The summary is a toast.
    expect(toasts.list.at(-1)?.key).toBe('squad.notice.dispelled');
  });

  it('is what a stop from a tile asks for, when the clone runs the tile', async () => {
    const state = cloner();
    start(state, 1, 'gather', 'core:mint');
    booted = await bootApp([coreUi], state, '#/skill/herb');
    const main = q('[data-herb="core:mint"] [data-ui="start-split"] .main') as HTMLElement | null;
    main?.click();
    flushSync();
    expect(q('[data-ui="dispel-preview"]')).not.toBeNull();
    expect(game.state.slots[1]?.action).not.toBeNull();
  });
});

describe('the map figures', () => {
  it('draws a numbered figure for a clone; a tap picks it and a second tap lets it go', async () => {
    const state = cloner();
    start(state, 1, 'gather', 'core:mint');
    booted = await bootApp([coreUi], state, '#/world');
    const figure = q('[data-ui="map-token"][data-performer="1"]');
    expect(figure).not.toBeNull();
    expect(figure?.querySelector('.num')?.textContent).toBe('1');
    expect(figure?.getAttribute('role')).toBe('button');
    expect(figure?.getAttribute('aria-label')).toContain(t('squad.state.working'));
    figure?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(squadUi.picked).toBe(1);
    expect(q('[data-ui="map-token"][data-performer="1"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    // The panel row shows the pick too.
    expect(q('[data-ui="squad-row"][data-performer="1"]')?.classList.contains('picked')).toBe(true);
    q('[data-ui="map-token"][data-performer="1"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    flushSync();
    expect(squadUi.picked).toBeNull();
  });

  it('has no figures before there is a clone', async () => {
    booted = await bootApp([coreUi], player({ natures: ['katon'], base: 5 }), '#/world');
    expect(qa('[data-ui="map-token"][data-performer]').length).toBe(0);
  });
});

describe('the notices', () => {
  const busy = (id: number, lifeMs?: number) =>
    performer({ id, state: 'working', action: { kind: 'drill', id: 'x' }, lifeMs });

  it('says a clone is free when a busy one turns idle, and only then', () => {
    const warned = new Set<number>();
    expect(squadNotices([busy(0), busy(1)], [busy(0), performer({ id: 1 })], warned)).toEqual([
      { key: 'squad.notice.free', n: 1 },
    ]);
    expect(
      squadNotices([busy(0), performer({ id: 1 })], [busy(0), performer({ id: 1 })], warned),
    ).toEqual([]);
  });

  it('warns once when a clone has five minutes left, and again after its life grows', () => {
    const warned = new Set<number>();
    const before = [busy(0), busy(1, LIFE_WARNING_MS + 60_000)];
    const low = [busy(0), busy(1, LIFE_WARNING_MS - 1000)];
    expect(squadNotices(before, low, warned)).toEqual([{ key: 'squad.notice.left', n: 1, min: 5 }]);
    expect(squadNotices(low, [busy(0), busy(1, 60_000)], warned)).toEqual([]);
    expect(squadNotices(low, before, warned)).toEqual([]);
    expect(squadNotices(before, low, warned).length).toBe(1);
  });

  it('has the texts the notices use', () => {
    expect(t('squad.notice.free', { n: 2 })).toBe('Клон 2 вільний.');
    expect(t('squad.notice.left', { n: 1, min: 5 })).toBe('Клону 1 лишилося 5 хв.');
  });
});

describe('the offline report', () => {
  const report: AnbuReport = {
    requestedMs: 3_600_000,
    simulatedMs: 3_600_000,
    capped: false,
    skills: [],
    mastery: [],
    techniques: [],
    raids: [],
    stopped: [
      { type: 'actionStopped', slot: 0, kind: 'gather', id: 'core:mint', reason: 'finished' },
      { type: 'actionStopped', slot: 1, kind: 'gather', id: 'core:water', reason: 'requirements' },
    ] as AnbuReport['stopped'],
  };

  it('groups the stops by performer', () => {
    const state = cloner();
    const sections = reportSections(report.stopped, state, content);
    expect(sections.map((s) => [s.n, s.clone, s.stopped.length])).toEqual([
      [0, false, 1],
      [1, true, 1],
    ]);
  });

  it('has a section per performer in the report', async () => {
    booted = await bootApp([coreUi], cloner(), '#/skill/tai');
    host = document.createElement('div');
    document.body.append(host);
    mounted = mount(ReportModal, { target: host, props: { report, onClose: () => {} } });
    flushSync();
    const sections = qa('[data-ui="report-performer"]');
    expect(sections.map((s) => s.querySelector('h4')?.textContent)).toEqual([
      t('squad.you'),
      t('squad.clone', { n: 1 }),
    ]);
  });
});

describe('the fight switcher', () => {
  it('picks the performers that fight', () => {
    const list = [
      performer({ id: 0, state: 'fighting', action: { kind: 'fight', id: 'a' } }),
      performer({ id: 1, state: 'working' }),
      performer({ id: 2, state: 'fighting', action: { kind: 'fight', id: 'b' } }),
    ];
    expect(fightersOf(list).map((p) => p.id)).toEqual([0, 2]);
  });
});

describe('the view model', () => {
  it('reads the character and the running clones, and no idle clone in today’s model', () => {
    const state = cloner();
    start(state, 0, 'drill', drill());
    expect(performersOf(state, content).map((p) => p.id)).toEqual([0]);
    start(state, 1, 'gather', 'core:mint');
    const list = performersOf(state, content);
    expect(list.map((p) => [p.id, p.slot, p.clone, p.state])).toEqual([
      [0, 0, false, 'working'],
      [1, 1, true, 'working'],
    ]);
    expect(list[0]?.chakraShare).toBe(0.5);
  });
});
