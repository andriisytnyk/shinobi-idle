// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import {
  MS_PER_HOUR,
  createState,
  missionForecast,
  syncVillage,
  type GameState,
} from '@shinobi/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import QuestObjective from '../src/components/QuestObjective.svelte';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { combineParts, stageViews } from '../src/lib/missions.ts';
import { objectiveTarget } from '../src/lib/next-step.ts';
import { tabOf } from '../src/lib/nav.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import { toasts } from '../src/lib/toasts.svelte.ts';
import { bootApp, type BootedApp } from './helpers/boot-app.ts';
import { coreRegistry } from './helpers/core-registry.ts';
import { able, player } from './helpers/missions.ts';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

let booted: BootedApp | null = null;
const q = (sel: string) => booted?.target.querySelector<HTMLElement>(sel) ?? null;
const qa = (sel: string) => [...(booted?.target.querySelectorAll<HTMLElement>(sel) ?? [])];
const rules = () => game.rules;
const board = content.missions.filter((m) => m.board);

beforeAll(async () => {
  await game.start();
});
afterAll(() => game.stop());
afterEach(() => {
  booted?.destroy();
  booted = null;
  toasts.clear();
});

describe('the XP of a fight is not split by a guessed skill', () => {
  it('shows a combat stage as one total, with the skills it goes to, and no per-skill number', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/mission/core:dig');
    const dig = content.missions.find((m) => m.id === 'core:dig')!;
    const forecast = missionForecast(state, dig, content, rules());
    const stage = forecast.stages[2]!;
    const fight = q('[data-stage="2"] [data-stage-fight-xp]');
    expect(Number(fight?.dataset.value)).toBeCloseTo(stage.xp.fight?.total ?? -1, 9);
    // The style share is said to depend on the techniques used: no skill is named for it.
    const style = q('[data-stage="2"] [data-stage-style-xp]');
    expect(Number(style?.dataset.value)).toBeGreaterThan(0);
    expect(style?.querySelector('a')).toBeNull();
    expect(stage.xp.lines.find((l) => !l.certain)?.skill).toBeNull();
    // The skills that are always paid are listed with their own amount, each as core computed it.
    const sure = qa('[data-stage="2"] [data-stage-xp-skill]');
    expect(sure.map((e) => e.dataset.stageXpSkill)).toEqual(stage.xp.fight?.skills);
    for (const row of sure) {
      const line = stage.xp.lines.find((l) => l.skill === row.dataset.stageXpSkill);
      expect(Number(row.dataset.value)).toBeCloseTo(line?.amount ?? -1, 9);
      expect(row.querySelector(`a[href="#/skill/${row.dataset.stageXpSkill}"]`)).not.toBeNull();
    }
    // Per hour: the skills core is sure of, and the fights' whole XP as a line of its own.
    const perHour = qa('[data-total="xp"] [data-xp-skill]').map((e) => e.dataset.xpSkill);
    expect(perHour.sort()).toEqual(
      Object.entries(forecast.xpPerHour)
        .filter(([, v]) => v > 0)
        .map(([k]) => k)
        .sort(),
    );
    expect(Number(q('[data-total="fight-xp"]')?.dataset.value)).toBeCloseTo(
      forecast.fightXpPerHour,
      6,
    );
  });

  it('keeps per-skill XP equal to the forecast where nothing is guessed', async () => {
    const state = able();
    booted = await bootApp([coreUi], state, '#/mission/core:fire');
    const fire = content.missions.find((m) => m.id === 'core:fire')!;
    const forecast = missionForecast(state, fire, content, rules());
    expect(q('[data-total="fight-xp"]')).toBeNull();
    for (const [skill, value] of Object.entries(forecast.xpPerHour)) {
      if (value > 0) {
        expect(Number(q(`[data-xp-skill="${skill}"]`)?.dataset.value), skill).toBeCloseTo(value, 6);
      }
    }
  });
});

describe('the per-hour breakdown explains the figure', () => {
  /** The chain the open breakdown shows: base, modifiers, per mission, runs per hour. */
  function chain(total: 'ryo' | 'rep') {
    (
      q(`[data-total="${total === 'ryo' ? 'money' : 'renown'}"] button`) as HTMLButtonElement
    ).click();
    flushSync();
    const lines = qa(`[data-total="${total === 'ryo' ? 'money' : 'renown'}"] [data-line]`);
    const base = Number(lines.find((l) => l.dataset.line === 'base')?.dataset.raw);
    const parts = lines
      .filter((l) => l.dataset.line === 'part')
      .map((l) => ({
        op: l.dataset.op as 'add' | 'mul',
        group: l.dataset.group as 'character' | 'village' | 'items',
        value: Number(l.dataset.raw),
        key: '',
        source: '',
      }));
    const note = (key: string) => Number(lines.find((l) => l.dataset.key === key)?.dataset.raw);
    return { base, parts, perMission: note('perMission'), runs: note('runs') };
  }

  it('multiplies out: base, each modifier, the runs per hour, and the figure shown', async () => {
    const state = able();
    syncVillage(state, content);
    if (state.village) state.village.levels['core:bureau'] = 5;
    booted = await bootApp([coreUi], state, '#/mission/core:caravan');
    const mission = content.missions.find((m) => m.id === 'core:caravan')!;
    const forecast = missionForecast(state, mission, content, rules());
    for (const key of ['ryo', 'rep'] as const) {
      const c = chain(key);
      const shown = Number(
        q(`[data-total="${key === 'ryo' ? 'money' : 'renown'}"]`)?.dataset.value,
      );
      expect(c.base, key).toBe(mission[key]);
      if (key === 'ryo') expect(c.parts.length).toBeGreaterThan(0);
      // One mission: the base through the modifiers, rounded as the core rounds.
      expect(Math.round(c.base * combineParts(c.parts)), key).toBe(c.perMission);
      expect(c.perMission).toBe(forecast[key]);
      // The runs in an hour at the expected length, and the figure per hour.
      expect(c.runs * forecast.expectedMs).toBeCloseTo(MS_PER_HOUR, 6);
      expect(c.perMission * c.runs, key).toBeCloseTo(shown, 6);
      expect(shown).toBeCloseTo(key === 'ryo' ? forecast.ryoPerHour : forecast.repPerHour, 6);
    }
  });
});

describe('an alternative is met only when the forecast can use it', () => {
  const suiton = content.techniques.filter((t) => t.skill === 'suiton');
  const low = suiton.find((t) => t.level < 20);
  /** Suiton 25 and exactly these Suiton techniques known (a level alone teaches some, so they are cleared first). */
  const withSuiton = (known: string[]): GameState => {
    const state = player({ levels: { suiton: 25 }, natures: ['katon'], team: false });
    for (const t of suiton) delete state.known[t.id];
    for (const id of known) state.known[id] = true;
    return state;
  };
  const states = (): [string, GameState][] => [
    ['student-like genin', player()],
    ['everything, no team', able({ team: false })],
    ['everything, with team', able()],
    ['slow Athletics', player({ levels: { ath: 30 } })],
    ['intel', player({ intel: 3 })],
    ['suiton level, no technique', withSuiton([])],
    ['suiton level, only a low technique', withSuiton(low ? [low.id] : [])],
    [
      'suiton level and a technique',
      withSuiton(suiton.filter((t) => t.level >= 20).map((t) => t.id)),
    ],
    ['teammate', player({ natures: ['katon'], levels: { katon: 30 } })],
  ];

  it('holds for every stage of every mission in nine prepared states', () => {
    let alternatives = 0;
    for (const [name, state] of states()) {
      for (const mission of board) {
        const forecast = missionForecast(state, mission, content, rules());
        for (const view of stageViews(state, mission, forecast, content, rules())) {
          const ways = view.ways.ways.filter((w) => w.kind !== 'free');
          if (ways.length === 0) continue;
          const path = view.forecast.path;
          const where = `${name}: ${mission.id} stage ${view.index}`;
          alternatives += ways.length;
          // A way exists exactly when one of the ways is met (a teammate's and Intel included).
          expect(
            ways.some((w) => w.met),
            where,
          ).toBe(path !== null);
          const used = ways.filter((w) => w.used);
          expect(used, where).toHaveLength(path === null ? 0 : 1);
          if (path !== null) {
            // The way marked as used is a met one, and the forecast's path is that way.
            expect(used[0]?.met, where).toBe(true);
            expect(
              [used[0]?.who, used[0]?.skill, used[0]?.tech, used[0]?.slow, used[0]?.intel],
              where,
            ).toEqual([path.who, path.skill, path.tech, path.slow, path.intel]);
          }
        }
      }
    }
    expect(alternatives).toBeGreaterThan(100);
  });

  it('shows the missing technique of a nature as a row of its own, with a link to the skill', async () => {
    const state = withSuiton(low ? [low.id] : []);
    booted = await bootApp([coreUi], state, '#/mission/core:fire');
    const way = qa('[data-stage="1"] [data-alt]').find((a) =>
      a.querySelector('[data-entity="skill:suiton"]'),
    );
    expect(way?.dataset.met).toBe('false');
    // The tree core gives names the condition: a known technique of the skill, none of which is known.
    const techniques = [
      ...(way?.querySelectorAll('[data-ui="req-row"][data-entity^="technique:"]') ?? []),
    ];
    expect(techniques.length).toBeGreaterThan(0);
    expect(techniques.every((row) => row.getAttribute('data-met') === 'false')).toBe(true);
    expect(way?.querySelector('a[href="#/skill/suiton"]')).not.toBeNull();
    expect(way?.querySelector('[data-tag="unmet"]')).not.toBeNull();
    expect(qa('[data-stage="1"] [data-used="true"]')).toHaveLength(0);
    expect(q('[data-stage="1"] [data-no-path]')).not.toBeNull();
  });
});

describe('authored stage labels come with structured links', () => {
  it('shows the skills a stage names as chips next to its label, on the page and in the Now bar', async () => {
    booted = await bootApp([coreUi], able(), '#/mission/core:fire');
    const chips = qa('[data-stage="1"] [data-stage-chip] a').map((a) => a.getAttribute('href'));
    expect(chips).toEqual(['#/skill/suiton', '#/skill/ath']);
    game.dispatch({ type: 'action.start', slot: 0, kind: 'mission', id: 'core:fire' });
    for (let i = 0; i < 400 && (game.state.slots[0]?.data as { s?: number })?.s !== 1; i++) {
      booted.advance(10_000);
    }
    const head = q('[data-now-head]');
    expect(head?.querySelector('a[href="#/skill/suiton"]')).not.toBeNull();
    expect(head?.querySelector('a[href="#/skill/ath"]')).not.toBeNull();
  });
});

describe('the forecast follows what changes without a command', () => {
  it('shows an item that arrived in the bank at the next update', async () => {
    booted = await bootApp([coreUi], able({ bank: { 'core:antidote': 0 } }), '#/mission/core:well');
    expect(q('[data-takes]')?.textContent).toContain('є 0 з 5');
    expect((q('[data-start]') as HTMLButtonElement).disabled).toBe(true);
    game.state.bank['core:antidote'] = 5;
    booted.advance(100);
    expect(q('[data-takes]')?.textContent).toContain('є 5 з 5');
    expect((q('[data-start]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a level that was gained at the next update, on a card too', async () => {
    booted = await bootApp([coreUi], player({ rankC: true }), '#/missions');
    expect(q('[data-mission="core:mail"]')?.dataset.state).toBe('blocked');
    for (const skill of content.skills) game.state.skills[skill.id]!.xp = 10_000_000;
    booted.advance(100);
    expect(q('[data-mission="core:mail"]')?.dataset.state).toBe('startable');
  });
});

describe('the phone tab', () => {
  it('lights «Журнал» on the board and on a mission page, not «Ще»', async () => {
    booted = await bootApp([coreUi], player(), '#/missions');
    const lit = () => qa('a[data-tab][aria-current="page"]').map((a) => a.dataset.tab);
    expect(lit()).toEqual(['quests']);
    await booted.go('#/mission/core:cat');
    expect(lit()).toEqual(['quests']);
    await booted.go('#/mission/core:v_clear');
    expect(lit()).toEqual(['quests']);
    await booted.go('#/bank');
    expect(lit()).toEqual(['more']);
  });

  it('lets any nav item name its tab', () => {
    expect(coreRegistry.navItems.find((n) => n.id === 'missions')?.tab).toBe('quests');
    expect(tabOf(coreRegistry, 'missions')).toBe('quests');
    expect(tabOf(coreRegistry, 'quests')).toBe('quests');
    expect(tabOf(coreRegistry, null)).toBeNull();
  });
});

describe('links into the mission page', () => {
  it('lands on the mission page from a village building that lacks a shinobi resource', async () => {
    const K = content.balance.K;
    const state = createState(1, content);
    state.player.rank = 'genin';
    state.player.name = 'Тест';
    syncVillage(state, content);
    const village = state.village!;
    village.treasury = 100_000;
    for (const key of Object.keys(village.res)) village.res[key] = 100_000;
    village.levels['core:grounds'] = 5;
    village.levels['core:library'] = 3;
    village.levels['core:academy'] = 5;
    village.levels['core:store'] = 6;
    state.currencies.rep = K.rep.stage2 ?? 0;
    booted = await bootApp([coreUi], state, '#/village');
    const card = q('[data-building="core:grounds"]');
    expect(card?.querySelector('[data-why]')?.getAttribute('data-why')).toBe(
      'error.notEnoughShinobi',
    );
    const link = card?.querySelector<HTMLAnchorElement>('a[href^="#/mission/"]');
    expect(link?.getAttribute('href')).toBe('#/mission/core:v_clear');
    await booted.go(link?.getAttribute('href') ?? '');
    expect(q('[data-ui="entity-page"]')?.getAttribute('data-entity')).toBe('mission:core:v_clear');
    expect(q('[data-ui="mission-stage"]')).not.toBeNull();
  });

  it('lands on the mission page from a quest step that counts a mission', () => {
    const synthetic = {
      id: 'x:synthetic',
      steps: [
        {
          textKey: 'quests.mission',
          objective: { t: 'counter', counter: 'missions.done.core:cat', n: 3 },
        },
      ],
    };
    game.replaceState(player());
    game.state.quests['x:synthetic'] = { step: 0, base: 0, done: false };
    settings.hints = false;
    const target = document.createElement('div');
    document.body.append(target);
    const app = mount(QuestObjective, {
      target,
      props: { quest: synthetic as never, index: 0 },
    });
    flushSync();
    expect(target.querySelector('a')?.getAttribute('href')).toBe('#/mission/core:cat');
    expect(target.textContent).toContain('0 / 3');
    unmount(app);
    target.remove();
    expect(objectiveTarget(game.state, synthetic.steps[0]!.objective as never, content)).toBe(
      '#/mission/core:cat',
    );
    expect(
      objectiveTarget(
        game.state,
        { t: 'counter', counter: 'missions.total', n: 3 } as never,
        content,
      ),
    ).toBe('#/missions');
  });
});
