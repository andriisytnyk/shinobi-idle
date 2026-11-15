// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import {
  MISSION_KIND,
  dispatch,
  missionBoard,
  missionForecast,
  missionStartSlot,
  missionStatus,
  type GameEvent,
  type GameState,
  type MissionDoneEvent,
} from '@shinobi/core';
import { flushSync } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { entityName } from '../src/lib/entities.ts';
import { t } from '../src/lib/i18n.ts';
import { missionToast } from '../src/lib/mission-toasts.ts';
import { missionView, rankGroups, stageViews } from '../src/lib/missions.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toasts } from '../src/lib/toasts.svelte.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { able, player } from './helpers/missions.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];
const rules = () => game.rules;

/** What `dispatch` would answer to starting a mission now, from core, with the board's blocker. */
function statusOf(state: GameState, id: string) {
  const mission = content.missions.find((m) => m.id === id)!;
  const view = missionView(state, mission, content, rules());
  return missionStatus(state, id, missionStartSlot(state), content, rules(), view.blocker);
}

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  toasts.clear();
  settings.setExt('core:missions.onlyAvailable', false);
  settings.setExt('core:missions.sort', 'rank');
});

const cardIds = () => qa('[data-ui="mission-card"]').map((c) => c.dataset.mission);

describe('the board', () => {
  it('lists every mission the core board returns for a genin, grouped by rank from the content', async () => {
    const state = player();
    booted = await bootApp([coreUi], state, '#/missions');
    const board = missionBoard(state, content, rules());
    expect([...cardIds()].sort()).toEqual(board.map((e) => e.id).sort());
    // Groups come in the order of the content's mission ranks, none of them hidden.
    expect(qa('section[data-rank]').map((s) => s.dataset.rank)).toEqual(
      rankGroups(content).map((g) => g.rank),
    );
    for (const group of qa('section[data-rank]')) {
      const expected = board.filter((e) => e.rank === group.dataset.rank).map((e) => e.id);
      expect(
        [...group.querySelectorAll<HTMLElement>('[data-ui="mission-card"]')].map(
          (c) => c.dataset.mission,
        ),
      ).toEqual(expected);
    }
  });

  it('shows a closed rank with the tree of what opens it, and an open one without', async () => {
    booted = await bootApp([coreUi], player(), '#/missions');
    const closed = q('section[data-rank="C"]');
    expect(closed?.dataset.open).toBe('false');
    const gate = closed?.querySelector('[data-rank-gate]');
    expect(gate?.querySelector('[data-ui="req-row"]')).not.toBeNull();
    expect(gate?.textContent).toContain(t('req.flag.missions.c.unlocked'));
    expect(q('section[data-rank="D"]')?.dataset.open).toBe('true');
    expect(q('section[data-rank="D"] [data-rank-gate]')).toBeNull();
    booted.destroy();

    const state = player({ rankC: true });
    booted = await bootApp([coreUi], state, '#/missions');
    expect(q('section[data-rank="C"]')?.dataset.open).toBe('true');
    expect(q('section[data-rank="C"] [data-rank-gate]')).toBeNull();
    expect([...cardIds()].sort()).toEqual(
      missionBoard(state, content, rules())
        .map((e) => e.id)
        .sort(),
    );
  });

  it('puts the village missions in a group of their own with the resource each gives', async () => {
    booted = await bootApp([coreUi], player(), '#/missions');
    const village = qa('section[data-rank="V"] [data-ui="mission-card"]');
    expect(village.length).toBeGreaterThan(0);
    for (const card of village) {
      const mission = content.missions.find((m) => m.id === card.dataset.mission);
      expect(card.querySelector('[data-reward="resource"]')?.textContent).toContain(
        t(`resource.${mission?.resource}.name`),
      );
    }
  });

  it('shows numbers that equal the forecast of the core', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/missions');
    for (const mission of content.missions.filter((m) => m.board)) {
      const forecast = missionForecast(state, mission, content, rules());
      const card = q(`[data-mission="${mission.id}"]`);
      expect(Number(card?.querySelector('[data-duration]')?.getAttribute('data-ms'))).toBe(
        forecast.expectedMs,
      );
      expect(Number(card?.querySelector('[data-chance]')?.getAttribute('data-value'))).toBeCloseTo(
        forecast.cleanChance,
        10,
      );
      expect(
        Number(card?.querySelector('[data-ryo-hour]')?.getAttribute('data-value')),
      ).toBeCloseTo(forecast.ryoPerHour, 6);
      // Exactly what core lists as the rewards: currencies, items, the village resource.
      const currencies = [...(card?.querySelectorAll('[data-reward="currency"]') ?? [])].map((e) =>
        e.getAttribute('data-entity'),
      );
      expect(currencies).toEqual(forecast.rewards.currencies.map((c) => `currency:${c.currency}`));
      expect(
        [...(card?.querySelectorAll('[data-reward="item"]') ?? [])].map((e) =>
          e.getAttribute('data-entity'),
        ),
      ).toEqual(forecast.rewards.items.map((i) => `item:${i.item}`));
      expect(card?.querySelector('[data-reward="resource"]') !== null).toBe(
        forecast.resource !== null,
      );
    }
  });

  it('filters to the missions that can be started and keeps the choice as a setting', async () => {
    const state = player();
    booted = await bootApp([coreUi], state, '#/missions');
    const all = cardIds().length;
    const box = q('[data-only-available]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const shown = cardIds();
    expect(shown.length).toBeLessThan(all);
    for (const id of shown) {
      const status = statusOf(state, id ?? '');
      expect(status.runningAt >= 0 || status.startable, id).toBe(true);
    }
    expect(settings.ext('core:missions.onlyAvailable')).toBe(true);
  });

  it('sorts a group by duration when asked', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/missions');
    const select = q('[data-sort]') as HTMLSelectElement;
    select.value = 'duration';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const times = qa('section[data-rank="D"] [data-ui="mission-card"] [data-duration]').map((e) =>
      Number(e.getAttribute('data-ms')),
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('starting a mission', () => {
  it('from a card: dispatches the command and the Now bar shows stage 1', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/missions');
    q('[data-mission="core:thief"] [data-start]')?.click();
    flushSync();
    expect(game.state.slots[0]?.action).toEqual({ kind: MISSION_KIND, id: 'core:thief' });
    const bar = q('[data-ui="now-slot"][data-slot-index="0"]');
    expect(bar?.getAttribute('data-entity')).toBe('mission:core:thief');
    expect(bar?.querySelector('[data-now-stage]')?.textContent?.trim()).toBe(
      t('mission.now.stage', { n: 1, total: 2 }),
    );
    // The card turns into a stop button.
    expect(q('[data-mission="core:thief"]')?.dataset.state).toBe('running');
  });

  it('from the page: the same, and the stop button stops it', async () => {
    booted = await bootApp([coreUi], able(), '#/mission/core:cat');
    q('[data-start]')?.click();
    flushSync();
    expect(game.state.slots[0]?.action?.id).toBe('core:cat');
    expect(q('[data-now-mission="core:cat"] [data-now-stage]')?.textContent).toContain('1');
    expect(q('[data-now-who="self"]')).not.toBeNull();
    q('[data-start]')?.click();
    flushSync();
    expect(game.state.slots[0]?.action).toBeNull();
  });

  it('shows the stage, the failures and a link to the combat page for a combat stage', async () => {
    booted = await bootApp([coreUi], able(), '#/missions');
    game.dispatch({ type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:thief' });
    // The first stage is a skill roll; move on to the fight.
    for (let i = 0; i < 400 && (game.state.slots[0]?.data as { s?: number })?.s !== 1; i++) {
      booted.advance(10_000);
    }
    const now = q('[data-now-mission="core:thief"]');
    expect(now?.querySelector('[data-now-stage]')?.textContent?.trim()).toBe(
      t('mission.now.stage', { n: 2, total: 2 }),
    );
    expect(now?.querySelector('[data-now-combat]')?.getAttribute('href')).toBe('#/combat');
    expect(now?.querySelector('a[href="#/enemy/core:thief"]')).not.toBeNull();
  });
});

/** Both ways a refusal can be seen: the helper that the board uses, and the real `dispatch`. */
function agree(state: GameState): Set<string> {
  const reasons = new Set<string>();
  for (const mission of content.missions.filter((m) => m.board)) {
    const shown = statusOf(state, mission.id);
    if (shown.runningAt >= 0) continue;
    const result = dispatch(
      structuredClone(state),
      { type: 'action.start', slot: shown.slot, kind: MISSION_KIND, id: mission.id },
      content,
      rules(),
    );
    if (shown.startable) {
      expect(result.ok, `${mission.id} startable`).toBe(true);
    } else {
      expect(result.ok, `${mission.id} blocked`).toBe(false);
      if (!result.ok) expect(shown.refusal?.reason, mission.id).toBe(result.reason);
      reasons.add(shown.refusal?.reason ?? '');
    }
  }
  return reasons;
}

describe('a blocked mission shows the reason dispatch gives', () => {
  it('for unmet requirements and a missing item', () => {
    expect(agree(player())).toContain('error.requirementsNotMet');
    // Able to do everything but short of the antidotes the well needs.
    const state = able({ bank: { 'core:antidote': 0 } });
    expect(agree(state)).toContain('error.missingIngredient');
  });

  it('for a fight held by another slot, and for a mission running in another slot', () => {
    const state = able();
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' }, content);
    // Slot 1 is the free one now: a mission with a combat stage is refused there.
    const reasons = agree(state);
    expect(reasons).toContain('error.fightBusy');
    // A mission with no fight is refused for nothing.
    const quiet = content.missions.find(
      (m) => m.board && !m.team && !m.stages.some((s) => s.t === 'combat'),
    );
    expect(quiet && statusOf(state, quiet.id).startable).toBe(true);
    // The same mission in two slots: the second is refused, and the board says it is running.
    const twice = able();
    twice.slots.push({ action: null, progress: 0, share: 0, data: null });
    dispatch(twice, { type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:cat' }, content);
    const refused = dispatch(
      twice,
      { type: 'action.start', slot: 1, kind: MISSION_KIND, id: 'core:cat' },
      content,
    );
    expect(refused).toEqual({ ok: false, reason: 'error.missionRunning' });
    expect(statusOf(twice, 'core:cat')).toMatchObject({ runningAt: 0, startable: false });
    expect(statusOf(twice, 'core:cat').refusal).toMatchObject({
      reason: 'error.missionRunning',
      by: { slot: 0, kind: MISSION_KIND, id: 'core:cat' },
    });
  });

  it('on a card and on the page, with the first reason as a link', async () => {
    const state = player();
    booted = await bootApp([coreUi], state, '#/missions');
    for (const mission of content.missions.filter((m) => m.board)) {
      const shown = statusOf(state, mission.id);
      const card = q(`[data-mission="${mission.id}"]`);
      if (!shown.startable && shown.runningAt < 0) {
        expect(card?.querySelector('[data-why]')?.getAttribute('data-why'), mission.id).toBe(
          shown.refusal?.reason,
        );
        expect((card?.querySelector('[data-start]') as HTMLButtonElement).disabled).toBe(true);
        if (shown.refusal?.blocker) {
          // The first unmet row names something to go and do, as a link.
          expect(card?.querySelector('[data-ui="req-row"] a, [data-ui="req-row"]')).not.toBeNull();
        }
        if (shown.refusal?.reason === 'error.missionNeedsTeam') {
          // No team yet: the sentence says so and points at the nature test.
          expect(card?.querySelector('[data-needs-team] a')?.getAttribute('href')).toBe('#/nature');
        }
      } else {
        expect(card?.querySelector('[data-why]')).toBeNull();
      }
    }
    // The page says the same, in place.
    // With no team a team mission says so, with the way to get one; with a team it names the unmet requirement.
    await booted.go('#/mission/core:fire');
    expect(q('[data-why]')?.getAttribute('data-why')).toBe('error.missionNeedsTeam');
    expect(q('[data-needs-team] a')?.getAttribute('href')).toBe('#/nature');
    expect(q('[data-start]')).not.toBeNull();
    booted.destroy();
    booted = await bootApp([coreUi], player({ natures: ['katon'] }), '#/mission/core:fire');
    expect(q('[data-why]')?.getAttribute('data-why')).toBe('error.requirementsNotMet');
    expect(q('[data-ui="req-row"]')).not.toBeNull();
  });

  it('names the action that holds the fight, as a link, and says it must be stopped first', async () => {
    const state = able();
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:thief' },
      content,
    );
    booted = await bootApp([coreUi], state, '#/mission/core:caravan');
    const by = q('[data-by]');
    expect(q('[data-why]')?.getAttribute('data-why')).toBe('error.fightBusy');
    expect(by?.textContent).toContain(t('error.fightBusy'));
    expect(by?.querySelector('a')?.getAttribute('href')).toBe('#/mission/core:thief');
    expect(t('error.fightBusy')).toContain('місією з боєм');
  });
});

describe('the mission page', () => {
  /** The row of stage `index` that is used, as the page says it. */
  const used = (index: number) =>
    qa(`[data-ui="mission-stage"][data-stage="${index}"] [data-alt][data-used="true"]`);

  it('marks the normal path when the player has it', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/mission/core:fire');
    const [row] = used(1);
    expect(used(1)).toHaveLength(1);
    expect(row?.dataset.slow).toBe('false');
    expect(row?.querySelector('[data-entity="skill:suiton"]')).not.toBeNull();
    expect(q('[data-stage="1"] [data-who]')?.getAttribute('data-who')).toBe('self');
  });

  it('marks the slow fallback, and says it is slow', async () => {
    const state = player({ levels: { ath: 30 } });
    booted = await bootApp([coreUi], state, '#/mission/core:fire');
    const [row] = used(1);
    expect(used(1)).toHaveLength(1);
    expect(row?.dataset.slow).toBe('true');
    expect(row?.querySelector('[data-entity="skill:ath"]')).not.toBeNull();
    expect(row?.querySelector('[data-tag="slow"]')).not.toBeNull();
    // The normal way is listed too, unused.
    expect(
      q('[data-stage="1"] [data-alt][data-used="false"] [data-entity="skill:suiton"]'),
    ).not.toBeNull();
  });

  it('names the teammate who does the stage, with the reason', async () => {
    const state = player({ natures: ['katon'], levels: { katon: 30 } });
    state.team = { rival: 'suiton', aya: 'doton' };
    booted = await bootApp([coreUi], state, '#/mission/core:fire');
    const who = q('[data-stage="1"] [data-who]');
    expect(who?.getAttribute('data-who')).not.toBe('self');
    expect(who?.textContent).toContain(t(`teammate.${who?.getAttribute('data-who')}.name`));
    expect(who?.querySelector('[data-who-reason]')?.textContent).toBeTruthy();
  });

  it('marks the Intel way with its price when nothing else will do the stage', async () => {
    const state = player({ intel: 3 });
    booted = await bootApp([coreUi], state, '#/mission/core:caravan');
    const [row] = used(0);
    expect(used(0)).toHaveLength(1);
    expect(row?.dataset.intel).toBe('true');
    expect(row?.textContent).toContain(t('mission.stage.intel', { n: 1 }));
    expect(row?.textContent).toContain(t('mission.stage.intelHave', { have: 3 }));
  });

  it('shows the consumables with what the player has', async () => {
    booted = await bootApp([coreUi], able({ bank: { 'core:antidote': 2 } }), '#/mission/core:well');
    const takes = q('[data-takes]');
    expect(takes?.querySelector('a[href="#/item/core:antidote"]')).not.toBeNull();
    expect(takes?.textContent).toContain(t('mission.stage.haveNeed', { have: 2, need: 5 }));
  });

  it('shows the totals of the forecast and the length of each stage', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/mission/core:dig');
    const mission = content.missions.find((m) => m.id === 'core:dig')!;
    const forecast = missionForecast(state, mission, content, rules());
    expect(Number(q('[data-total="time"]')?.dataset.ms)).toBe(forecast.nominalMs);
    expect(Number(q('[data-expected]')?.dataset.ms)).toBe(forecast.expectedMs);
    expect(Number(q('[data-total="chance"]')?.dataset.value)).toBeCloseTo(forecast.cleanChance, 10);
    expect(Number(q('[data-total="money"]')?.dataset.value)).toBeCloseTo(forecast.ryoPerHour, 6);
    expect(Number(q('[data-total="renown"]')?.dataset.value)).toBeCloseTo(forecast.repPerHour, 6);
    for (const stage of forecast.stages) {
      expect(
        Number(q(`[data-stage="${stage.index}"] [data-stage-time]`)?.dataset.ms),
        `stage ${stage.index}`,
      ).toBe(stage.ms);
    }
    // The stage views the page is built from agree with the forecast.
    const views = stageViews(state, mission, forecast, content, rules());
    expect(views.map((v) => v.forecast.ms)).toEqual(forecast.stages.map((s) => s.ms));
  });

  it('shows what each stage gives: XP by skill and the technique whose Mastery grows', async () => {
    booted = await bootApp([coreUi], able(), '#/mission/core:cat');
    expect(q('[data-stage="0"] [data-stage-xp] a[href="#/skill/scout"]')).not.toBeNull();
    const fire = content.missions.find((m) => m.id === 'core:fire')!;
    const views = stageViews(
      able(),
      fire,
      missionForecast(able(), fire, content, rules()),
      content,
      rules(),
    );
    expect(views.some((v) => v.forecast.xp.mastery !== null)).toBe(true);
  });

  it('shows the ration control: arm it, and it shortens the stages', async () => {
    const state = able({ bank: { 'core:sushenyi_paiok': 2 } });
    booted = await bootApp([coreUi], state, '#/mission/core:dig');
    const before = Number(q('[data-stage="0"] [data-stage-time]')?.dataset.ms);
    expect(q('[data-ration-armed]')).toBeNull();
    expect(q('[data-consumed-note]')?.textContent).toContain('Intel');
    q('[data-ration-arm]')?.click();
    flushSync();
    expect(q('[data-ration-armed]')).not.toBeNull();
    expect(game.state.buffs['core:sushenyi_paiok']?.charges).toBe(1);
    expect(game.state.bank['core:sushenyi_paiok']).toBe(1);
    // The forecast follows the command at once.
    const after = Number(q('[data-stage="0"] [data-stage-time]')?.dataset.ms);
    expect(after).toBeLessThan(before);
    // Nothing to arm without a ration in the bank: the reason is given in place.
    booted.destroy();
    booted = await bootApp([coreUi], able(), '#/mission/core:dig');
    expect((q('[data-ration-arm]') as HTMLButtonElement).disabled).toBe(true);
    expect(q('[data-why="error.noItem"]')).not.toBeNull();
  });

  it('pins the mission itself as the goal, and the goal panel shows what it needs', async () => {
    // A mission that can be started has nothing to pin.
    booted = await bootApp([coreUi], able(), '#/mission/core:cat');
    expect(q('[data-pin]')).toBeNull();
    booted.destroy();
    booted = await bootApp([coreUi], player({ rankC: true }), '#/mission/core:mail');
    const pin = q('[data-pin]') as HTMLButtonElement;
    expect(pin).not.toBeNull();
    pin.click();
    flushSync();
    expect(game.state.goal).toEqual({ kind: 'mission', id: 'core:mail' });
    expect(pin.disabled).toBe(true);
  });

  it('falls back to the generic page for a mission that does not exist', async () => {
    booted = await bootApp([coreUi], player(), '#/mission/core:nothing');
    expect(q('[data-ui="entity-page"]')?.getAttribute('data-entity')).toBe('mission:core:nothing');
  });
});

describe('every name is a link', () => {
  /** Names of the entities whose names must not appear as bare text. */
  const names = (): string[] => {
    const out = new Set<string>();
    const add = (kind: Parameters<typeof entityName>[0]['kind'], ids: string[]) => {
      for (const id of ids) {
        const name = entityName({ kind, id });
        if (name !== id && name.length >= 4) out.add(name);
      }
    };
    add(
      'skill',
      content.skills.map((s) => s.id),
    );
    add(
      'technique',
      content.techniques.map((x) => x.id),
    );
    add(
      'item',
      content.items.map((x) => x.id),
    );
    add(
      'enemy',
      content.enemies.map((x) => x.id),
    );
    add(
      'building',
      content.buildings.map((x) => x.id),
    );
    return [...out];
  };

  /** Text nodes that hold an entity name outside a link or an element that carries `data-entity`. */
  function bare(root: HTMLElement): string[] {
    const found: string[] = [];
    const all = names();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = node.textContent ?? '';
      if (!el || text.trim() === '') continue;
      // Authored prose (a description, a stage's label) is content, not a name in the interface.
      if (el.closest('a, [data-entity], [data-desc], [data-stage-label], script, style')) continue;
      for (const name of all) if (text.includes(name)) found.push(`${name} in "${text.trim()}"`);
    }
    return found;
  }

  it('on the board, for a player who can do everything and one who cannot', async () => {
    for (const state of [player(), able()]) {
      booted = await bootApp([coreUi], state, '#/missions');
      expect(bare(booted.target.querySelector('[data-ui="page"]') as HTMLElement)).toEqual([]);
      booted.destroy();
      booted = null;
    }
  });

  it('on every mission page', async () => {
    const state = able({ bank: { 'core:sushenyi_paiok': 1 } });
    booted = await bootApp([coreUi], state, '#/missions');
    for (const mission of content.missions.filter((m) => m.board)) {
      await booted.go(`#/mission/${mission.id}`);
      const page = booted.target.querySelector('[data-ui="page"]') as HTMLElement;
      expect(page.querySelector('[data-ui="mission-stage"]'), mission.id).not.toBeNull();
      expect(bare(page), mission.id).toEqual([]);
    }
    await booted.go('#/mission/core:fire');
    booted.destroy();
    booted = await bootApp([coreUi], player(), '#/mission/core:fire');
    expect(bare(booted.target.querySelector('[data-ui="page"]') as HTMLElement)).toEqual([]);
  });
});

describe('toasts', () => {
  const at = { at: 0 };
  const stage = (mission: string, index: number, ok: boolean): GameEvent => ({
    type: 'missionStage',
    mission,
    stage: index,
    ok,
    ...at,
  });
  const stop = (
    reason: Extract<GameEvent, { type: 'actionStopped' }>['reason'],
    extra: { missing?: string; cause?: string } = {},
  ): GameEvent => ({
    type: 'actionStopped',
    slot: 0,
    kind: MISSION_KIND,
    id: 'core:well',
    reason,
    ...extra,
    ...at,
  });
  const well = { kind: 'mission', id: 'core:well' };

  it('says what a stage did, naming the mission first: done, a failed roll, a lost fight', () => {
    expect(missionToast(stage('core:well', 0, true), content)).toMatchObject({
      key: 'toast.mission.stageDone',
      params: { n: 1, total: 3 },
      subject: well,
    });
    expect(missionToast(stage('core:well', 0, false), content)?.key).toBe(
      'toast.mission.rollFailed',
    );
    // A failed attempt at a combat stage is a lost fight with a Wound.
    expect(missionToast(stage('core:well', 2, false), content)?.key).toBe(
      'toast.mission.fightLost',
    );
  });

  /** A completion event as core emits it; the fields not named are empty. */
  const done = (over: Partial<MissionDoneEvent> = {}): MissionDoneEvent => ({
    type: 'missionDone',
    mission: 'core:well',
    ryo: 0,
    rep: 0,
    currencies: [],
    items: [],
    resource: null,
    ...at,
    ...over,
  });

  it('is built from the completion event alone: money, Intel, items, a scroll part, the resource', () => {
    const event = done({
      ryo: 480,
      rep: 8,
      currencies: [
        { currency: 'ryo', n: 480 },
        { currency: 'rep', n: 8 },
        { currency: 'intel', n: 2 },
      ],
      items: [
        { id: 'core:spice', n: 2 },
        { id: 'core:scrollpart_wave_of_inspiration', n: 1 },
      ],
      resource: { slug: 'zroshennia', units: 5, added: 5, lost: 0, waiting: 0 },
    });
    const toast = missionToast(event, content);
    expect(toast?.key).toBe('toast.mission.doneRep');
    expect(toast?.params).toEqual({ rep: 8 });
    expect(toast?.subject).toEqual(well);
    expect(toast?.gains).toEqual({
      ryo: 480,
      currencies: { intel: 2 },
      items: [
        { id: 'core:spice', n: 2 },
        { id: 'core:scrollpart_wave_of_inspiration', n: 1 },
      ],
      resource: { slug: 'zroshennia', units: 5, added: 5, lost: 0, waiting: 0 },
    });
    // Nothing else is read: no earlier event changes what the toast says.
    expect(missionToast(done({ ryo: 40 }), content)?.key).toBe('toast.mission.done');
    expect(missionToast(done({ ryo: 40 }), content)?.gains?.items).toEqual([]);
  });

  it('shows Intel, the village resource, a lost share and a scroll part in the mounted toast', async () => {
    booted = await bootApp([coreUi], able(), '#/missions');
    const push = (event: MissionDoneEvent) => {
      toasts.clear();
      const spec = missionToast(event, content);
      expect(spec).not.toBeNull();
      if (spec) toasts.push(spec);
      flushSync();
      return q('[data-toast^="toast.mission.done"]');
    };
    const rich = push(
      done({
        ryo: 120,
        currencies: [
          { currency: 'ryo', n: 120 },
          { currency: 'intel', n: 3 },
        ],
        items: [{ id: 'core:scrollpart_wave_of_inspiration', n: 1 }],
        resource: { slug: 'zroshennia', units: 5, added: 3, lost: 2, waiting: 0 },
      }),
    );
    expect(rich?.querySelector('[data-currency="intel"]')?.textContent).toContain('3');
    expect(
      rich?.querySelector('[data-reward="item"] a')?.getAttribute('href'),
      'the scroll part is a link',
    ).toBe('#/item/core:scrollpart_wave_of_inspiration');
    expect(rich?.querySelector('[data-resource="added"]')?.textContent).toBe(
      t('toast.mission.resourceAdded', { name: t('resource.zroshennia.name'), n: 3 }),
    );
    // A share a full store could not take is said so.
    expect(rich?.querySelector('[data-resource="lost"]')?.textContent).toBe(
      t('toast.mission.resourceLost', { name: t('resource.zroshennia.name'), n: 2 }),
    );
    expect(rich?.querySelector('[data-resource="waiting"]')).toBeNull();
    const waiting = push(
      done({ resource: { slug: 'zroshennia', units: 5, added: 0, lost: 0, waiting: 5 } }),
    );
    expect(waiting?.querySelector('[data-resource="waiting"]')).not.toBeNull();
    expect(waiting?.querySelector('[data-resource="added"]')).toBeNull();
  });

  it('gives each cause of a stop a sentence of its own, naming the mission, silent for the player', () => {
    expect(missionToast(stop('manual'), content)).toBeNull();
    expect(missionToast(stop('replaced'), content)).toMatchObject({
      key: 'toast.mission.stopped.replaced',
      subject: well,
    });
    expect(
      missionToast(stop('requirements', { cause: 'error.missionTooHard' }), content),
    ).toMatchObject({ key: 'toast.mission.stopped.tooHard', subject: well });
    const lacking = missionToast(stop('requirements', { missing: 'core:antidote' }), content);
    expect(lacking?.key).toBe('toast.mission.stopped.item');
    expect(lacking?.subject).toEqual(well);
    expect(lacking?.ref).toEqual({ kind: 'item', id: 'core:antidote' });
    expect(missionToast(stop('requirements'), content)).toMatchObject({
      key: 'toast.mission.stopped.requirements',
      subject: well,
    });
    expect(missionToast(stop('missing'), content)?.key).toBe('toast.mission.stopped.missing');
    expect(
      missionToast({ ...stop('finished'), kind: 'practice' } as GameEvent, content),
    ).toBeUndefined();
  });

  it('puts the mission first as a link and the item after the colon, both in the nominative', async () => {
    booted = await bootApp([coreUi], able(), '#/missions');
    const spec = missionToast(stop('requirements', { missing: 'core:antidote' }), content);
    expect(spec).not.toBeNull();
    if (spec) toasts.push(spec);
    flushSync();
    const toast = q('[data-toast="toast.mission.stopped.item"]');
    const links = [...(toast?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#/mission/core:well', '#/item/core:antidote']);
    expect(toast?.textContent).toContain(entityName({ kind: 'mission', id: 'core:well' }));
    expect(toast?.textContent).toContain(entityName({ kind: 'item', id: 'core:antidote' }));
    // The text between the names does not decline them.
    expect(t('toast.mission.stopped.item')).toBe('— місію зупинено: у тебе закінчився предмет:');
  });

  it('addresses the player as «ти» in every stop cause and failure sentence', () => {
    for (const key of [
      'toast.mission.rollFailed',
      'toast.mission.fightLost',
      'toast.mission.stopped.tooHard',
      'toast.mission.stopped.requirements',
      'toast.mission.stopped.item',
    ]) {
      expect(t(key), key).toMatch(/ти |Ти |тобі|тебе/u);
    }
  });

  it('shows the toasts of a mission that runs, with what the bank really gained', async () => {
    booted = await bootApp([coreUi], able(), '#/missions');
    toasts.clear();
    const before = game.state.bank['core:note'] ?? 0;
    game.dispatch({ type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:thief' });
    for (
      let i = 0;
      i < 200 && !toasts.list.some((x) => x.key.startsWith('toast.mission.done'));
      i++
    ) {
      booted.advance(20_000);
    }
    const shown = toasts.list.find((x) => x.key.startsWith('toast.mission.done'));
    expect(shown?.subject).toEqual({ kind: 'mission', id: 'core:thief' });
    expect(shown?.gains?.ryo).toBeGreaterThan(0);
    // Whatever the toast lists is what reached the bank (at least one run's worth: more runs may follow).
    const listed = shown?.gains?.items.find((x) => x.id === 'core:note');
    expect(listed).toEqual({ id: 'core:note', n: 1 });
    expect((game.state.bank['core:note'] ?? 0) - before).toBeGreaterThanOrEqual(1);
    expect(toasts.list.map((x) => x.key)).toContain('toast.mission.stageDone');
    toasts.clear();
    // Another action in the slot replaces the mission, and the player is told.
    game.dispatch({ type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' });
    flushSync();
    expect(toasts.list.map((x) => x.key)).toContain('toast.mission.stopped.replaced');
  });

  it('shows a failed roll as a toast', async () => {
    booted = await bootApp([coreUi], able(), '#/missions');
    toasts.clear();
    game.dispatch({ type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:cat' });
    for (
      let i = 0;
      i < 400 && !toasts.list.some((x) => x.key === 'toast.mission.rollFailed');
      i++
    ) {
      // Restart the run so that a new roll is drawn after every pass.
      booted.advance(20_000);
      if (game.state.slots[0]?.action === null) {
        game.dispatch({ type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:cat' });
      }
    }
    expect(toasts.list.map((x) => x.key)).toContain('toast.mission.rollFailed');
    expect(game.state.slots[0]?.action).not.toBeNull();
  });

  it('stops with the requirements sentence when what a stage needs is gone, as a mounted toast', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/missions');
    toasts.clear();
    game.dispatch({ type: 'action.start', slot: 0, kind: MISSION_KIND, id: 'core:sealed' });
    expect(game.state.slots[0]?.action?.id).toBe('core:sealed');
    // The sealing technique is forgotten while the first stage runs.
    delete game.state.known['core:enclosing'];
    for (let i = 0; i < 20 && game.state.slots[0]?.action !== null; i++) booted.advance(60_000);
    expect(game.state.slots[0]?.action).toBeNull();
    const toast = q('[data-toast="toast.mission.stopped.requirements"]');
    expect(toast).not.toBeNull();
    expect(toast?.querySelector('a')?.getAttribute('href')).toBe('#/mission/core:sealed');
    expect(toast?.textContent).toContain('ти більше не виконуєш її вимог');
  });
});
