// @vitest-environment happy-dom
import { content, ukLocale } from '@shinobi/content';
import { createState, dispatch, xpAt, type GameState } from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import ReportModal from '../src/components/ReportModal.svelte';
import { buildReport } from '../src/lib/persistence.ts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { t } from '../src/lib/i18n.ts';
import { graduateRank, rankName } from '../src/lib/vocab.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { player } from './helpers/missions.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  settings.setExt('core:missions.onlyAvailable', false);
});

/** A student of the Academy with a name, so that no welcome modal covers the page. */
function student(): GameState {
  const state = createState(1, content);
  state.player.name = 'Тест';
  return state;
}

const RUINS = 'core:war_fort_ruins';
const SEARCH = 'core:search_war_fort_ruins';

describe("a fieldwork's own page", () => {
  const genin = (): GameState => {
    const state = createState(1, content);
    state.player.name = 'Тест';
    state.player.rank = 'genin';
    return state;
  };

  it('has the start of its Scouting tile once the point is found and the level is there', async () => {
    const state = genin();
    state.skills.scout = { xp: xpAt(10) };
    state.world.pois[RUINS] = true;
    booted = await bootApp([coreUi], state, `#/fieldwork/${SEARCH}`);
    const start = q('[data-fieldwork-start] [data-ui="start-split"] [data-start]');
    expect(start).not.toBeNull();
    start?.click();
    expect(game.state.slots[0]?.action).toEqual({ kind: 'fieldwork', id: SEARCH });
  });

  it('shows the same lock as the tile while the level is short', async () => {
    const state = genin();
    state.world.pois[RUINS] = true;
    booted = await bootApp([coreUi], state, `#/fieldwork/${SEARCH}`);
    const tile = q('[data-fieldwork-start] [data-ui="action-tile"]');
    expect(tile?.classList.contains('locked')).toBe(true);
    expect(tile?.querySelector('[data-ui="start-split"]')).toBeNull();
    expect(tile?.querySelector('[data-ui="req-row"][data-met="false"]')).not.toBeNull();
  });

  it('keeps the reveal rule: no start while the point is not found', async () => {
    booted = await bootApp([coreUi], genin(), `#/fieldwork/${SEARCH}`);
    expect(q('[data-fieldwork-start]')).toBeNull();
    expect(booted.target.innerHTML).not.toContain('war_fort_ruins');
  });
});

describe('the «choose a nature» link', () => {
  const natureLinks = () =>
    qa('a[href="#/nature"]').filter((a) => a.classList.contains('detail-link'));
  const genin = (natures: string[]): GameState => {
    const state = createState(1, content);
    state.player.name = 'Тест';
    state.player.rank = 'genin';
    state.player.natures = natures as never;
    return state;
  };

  it('is offered while the nature test is open', async () => {
    booted = await bootApp([coreUi], genin([]), '#/skills');
    expect(natureLinks().length).toBeGreaterThan(0);
  });

  it('is not offered for the others once a nature is chosen and no second one can be taken yet', async () => {
    booted = await bootApp([coreUi], genin(['katon']), '#/skills');
    expect(booted.target.textContent).not.toContain(t('req.natureLink'));
    expect(natureLinks()).toHaveLength(0);
  });
});

describe('a mission that asks for a nature the character lacks', () => {
  it('says that the nature is what is missing', async () => {
    const state = player({ natures: ['katon'], base: 20, rankC: true });
    booted = await bootApp([coreUi], state, '#/missions');
    // A blocked card whose missing part is a nature the character does not own says so.
    // The card keeps a long list behind «Вимоги»: open every such list.
    for (const b of [
      ...(booted?.target.querySelectorAll<HTMLButtonElement>(
        '[data-mission][data-state="blocked"] [data-req-open]',
      ) ?? []),
    ]) {
      b.click();
      flushSync();
      break;
    }
    const hint =
      document.querySelector(
        '[data-ui="modal"] [data-nature-impossible], [data-ui="modal"] [data-nature-lacking]',
      ) ??
      q(
        '[data-mission][data-state="blocked"] [data-nature-impossible], [data-mission][data-state="blocked"] [data-nature-lacking]',
      );
    expect(hint, 'a blocked card with the nature hint').not.toBeNull();
    // A nature that can still be taken says «потрібна ця природа»; one that cannot be taken now says it is unavailable.
    expect(hint?.textContent).toMatch(
      new RegExp(`^(${t('req.needNature')}|недоступно: потрібна природа .+)$`),
    );
    expect(hint?.closest('[data-ui="req-row"]')?.getAttribute('data-met')).toBe('false');
  });
});

describe('the fight screen', () => {
  const YARD = content.zones.find((z) => z.region === 'academy')!;
  const fighter = (): GameState => {
    const state = createState(11, content);
    state.player.name = 'Тест';
    state.player.rank = 'genin';
    for (const skill of Object.keys(state.skills)) state.skills[skill as 'tai']!.xp = xpAt(14);
    for (const x of content.techniques) if (x.rank === 'D') state.known[x.id] = true;
    for (const cell of content.cells) state.world.explores[cell.id] = 9999;
    state.flags['region.forest.unlocked'] = true;
    state.bingo['core:wolf'] = {
      seen: 1,
      wins: 1,
      losses: 0,
      timeouts: 0,
      bought: 0,
      bounty: 0,
    };
    return state;
  };
  const fight = (state: GameState, zone: string): void => {
    const r = dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: zone }, content);
    expect(r.ok).toBe(true);
  };

  it('is headed «Тренувальний бій» only for the training fight', async () => {
    const state = fighter();
    fight(state, YARD.id);
    booted = await bootApp([coreUi], state, '#/combat');
    expect(q('h1')?.textContent).toBe(
      ukLocale['combat.titleTraining'] ?? t('combat.titleTraining'),
    );
  });

  it('names the enemy in the heading of a zone fight', async () => {
    const state = fighter();
    fight(state, 'core:zone_wolf');
    booted = await bootApp([coreUi], state, '#/combat');
    expect(q('h1')?.textContent).toBe(t('enemy.core:wolf.name'));
  });

  it('shows the preparation of another target while a fight runs, with a way back to the fight', async () => {
    const state = fighter();
    fight(state, YARD.id);
    booted = await bootApp([coreUi], state, '#/combat/prepare/zone/core:zone_wolf');
    expect(q('[data-ui="prep-verdict"]')).not.toBeNull();
    expect(q('[data-prepare-running]')).not.toBeNull();
    expect(q('[data-prepare-running-link]')?.getAttribute('href')).toBe('#/combat');
  });
});

describe('the offline report', () => {
  it('lists the items and the currency that reached the Bank while away', async () => {
    booted = await bootApp([coreUi], student(), '');
    const report = buildReport({
      requestedMs: 4 * 3_600_000,
      simulatedMs: 4 * 3_600_000,
      capped: false,
      skillXp: {},
      levelsGained: {},
      masteryLevelsGained: {},
      techniquesLearned: [],
      actionsStopped: [],
      itemsGained: { 'core:mint': 7 },
      currencyGained: { ryo: 120 },
      reports: {},
    });
    // Loot alone is worth a report.
    expect(report).not.toBeNull();
    const host = document.createElement('div');
    document.body.append(host);
    const app = mount(ReportModal, { target: host, props: { report: report!, onClose: () => {} } });
    flushSync();
    // The report is a normal dark dialog, not a paper scroll.
    expect(document.body.querySelector('[data-ui="modal"]')).not.toBeNull();
    expect(document.body.querySelector('.paper')).toBeNull();
    const item = document.body.querySelector('[data-report-item="core:mint"]');
    expect(item?.textContent).toContain('7');
    expect(item?.textContent).toContain(ukLocale['item.core:mint.name']);
    expect(document.body.querySelector('[data-report-currency="ryo"]')?.textContent).toContain(
      '120',
    );
    unmount(app);
    host.remove();
  });
});

describe('a locked technique tile on the skill page', () => {
  it('lists the rank that is not met, not only the level that is', async () => {
    const state = student();
    state.skills.tai!.xp = xpAt(14);
    booted = await bootApp([coreUi], state, '#/skill/tai');
    const tile = q('[data-action="core:dynamic_entry"]');
    expect(tile, 'the tile of the technique').not.toBeNull();
    expect(tile?.classList.contains('locked')).toBe(true);
    const rows = [...(tile?.querySelectorAll<HTMLElement>('[data-ui="req-row"]') ?? [])];
    const unmet = rows.filter((r) => r.dataset.met === 'false');
    const rankText = t('req.rank', { rank: rankName(graduateRank(content) ?? '') });
    expect(unmet.some((r) => r.textContent?.includes(rankText))).toBe(true);
    // The met level is still there, marked as met.
    expect(rows.some((r) => r.dataset.met === 'true')).toBe(true);
  });
});
