import { content, ukLocale } from '@shinobi/content';
import { bump, createState, evalReq, updateQuests, xpAt, type GameState } from '@shinobi/core';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import CombatLog from '../src/components/CombatLog.svelte';
import GoalPanel from '../src/components/GoalPanel.svelte';
import HintHost from '../src/components/HintHost.svelte';
import NowBar from '../src/components/NowBar.svelte';
import MainNav from '../src/components/MainNav.svelte';
import TabBar from '../src/components/TabBar.svelte';
import DevPanel from '../src/dev/DevPanel.svelte';
import { isDevMode } from '../src/lib/dev.ts';
import { migrateLocalGoal } from '../src/lib/goal-migration.ts';
import { HINTS, nextStateHint } from '../src/lib/hints.ts';
import type { LogEntry } from '../src/lib/game.svelte.ts';
import { markerOf } from '../src/lib/nav.ts';
import { coreRegistry, inApp } from './helpers/core-registry.ts';
import { nextStep, objectiveTarget, withoutRankRows } from '../src/lib/next-step.ts';
import { hrefFor, type EntityRef } from '../src/lib/route.ts';
import { SETTINGS_KEY, settings, type TextStorage } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import BankPage from '../src/pages/BankPage.svelte';
import CombatPage from '../src/pages/CombatPage.svelte';
import HelpPage from '../src/pages/HelpPage.svelte';
import QuestsPage from '../src/pages/QuestsPage.svelte';
import RankPage from '../src/pages/RankPage.svelte';

const html = <P extends Record<string, unknown>>(component: Component<P>, props: P): string =>
  render(component, { props }).body;

const name = (ref: EntityRef) =>
  ukLocale[`${ref.kind === 'status' ? 'state' : ref.kind}.${ref.id}.name`] ?? ref.id;

const anchor = (ref: EntityRef) =>
  new RegExp(
    `<a [^>]*href="${hrefFor(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>${name(ref)}</a>`,
  );

const QUEST = 'core:graduation';
const SCROLL = 'core:graduate_scroll';

function setLevel(state: GameState, skill: 'tai' | 'nin' | 'cc' | 'ath' | 'med', level: number) {
  state.skills[skill]!.xp = xpAt(level);
}

/** A game at step 4 of the chain with three dummies down. */
function atStepFour(): GameState {
  const state = createState(3, content);
  setLevel(state, 'tai', 5);
  setLevel(state, 'ath', 5);
  setLevel(state, 'cc', 5);
  setLevel(state, 'med', 5);
  updateQuests(state, content);
  bump(state, 'kills.core:dummy', 3);
  return state;
}

beforeEach(() => {
  game.replaceState(createState(1, content));
  settings.hints = true;
  settings.resetHints();
});

describe('A4: quest journal', () => {
  it('renders objective rows as links and counter objectives as n / N', () => {
    game.replaceState(atStepFour());
    expect(game.state.quests[QUEST]?.step).toBe(3);
    const body = render(QuestsPage, { props: {} }).body;
    // Finished steps keep their requirement rows; the current step counts the dummies.
    expect(body).toMatch(anchor({ kind: 'skill', id: 'tai' }));
    expect(body).toMatch(anchor({ kind: 'skill', id: 'ath' }));
    expect(body).toMatch(anchor({ kind: 'technique', id: 'core:clone' }));
    expect(body).toMatch(anchor({ kind: 'enemy', id: 'core:dummy' }));
    expect(body).toContain('3 / 10');
    expect(body).toMatch(anchor({ kind: 'quest', id: QUEST }));
  });

  it('counts kills made during the step and highlights the current step', () => {
    const state = atStepFour();
    // The counter reads from the moment the step began: seven kills since then.
    bump(state, 'kills.core:dummy', 4);
    game.replaceState(state);
    const body = html(QuestsPage, {});
    expect(body).toContain('7 / 10');
    expect(body.match(/data-status="current"/g)).toHaveLength(1);
    expect(body.match(/data-status="done"/g)).toHaveLength(3);
    expect(body).toContain('aria-current="step"');
  });

  it('folds a finished chain', () => {
    const state = createState(1, content);
    state.quests[QUEST] = { step: 5, base: 0, done: true };
    game.replaceState(state);
    const body = html(QuestsPage, {});
    expect(body).toMatch(/<details[^>]*class="[^"]*folded/);
    expect(body).not.toMatch(/<details[^>]*open/);
  });
});

describe('A4: Academy page', () => {
  it('lists the checklist rows as links and keeps the exam button off until it is met', () => {
    const body = html(RankPage, {});
    for (const ref of [
      { kind: 'skill', id: 'tai' },
      { kind: 'skill', id: 'nin' },
      { kind: 'skill', id: 'cc' },
      { kind: 'technique', id: 'core:clone' },
      { kind: 'technique', id: 'core:transformation' },
      { kind: 'technique', id: 'core:body_replacement' },
    ] as const) {
      expect(body, ref.id).toMatch(anchor(ref));
    }
    expect(body).toMatch(/<button[^>]*class="take[^"]*"[^>]*disabled/);
  });

  it('enables the button once the checklist holds, and shows the test as a progress action', () => {
    const state = createState(1, content);
    setLevel(state, 'tai', 10);
    setLevel(state, 'nin', 10);
    setLevel(state, 'cc', 10);
    game.replaceState(state);
    const ready = html(RankPage, {});
    expect(ready).not.toMatch(/<button[^>]*class="take[^"]*"[^>]*disabled/);
    expect(ready).toContain('Скласти іспит');

    expect(game.dispatch({ type: 'exam.genin.start' }).ok).toBe(true);
    const running = html(RankPage, {});
    expect(running).toContain('data-test');
    expect(running).toContain('role="progressbar"');
    expect(running).not.toContain('class="take ');
  });

  it('shows the next exam to a Genin and the passed state at the last rank', () => {
    const next = createState(1, content);
    next.player.rank = 'genin';
    game.replaceState(next);
    expect(html(RankPage, {})).not.toContain('data-passed');
    expect(html(RankPage, {})).toContain('data-exam="core:chunin_exam"');
    const state = createState(1, content);
    state.player.rank = 'chunin';
    game.replaceState(state);
    expect(html(RankPage, {})).toContain('data-passed');
  });
});

describe('A4: combat screen', () => {
  it('lists the training dummy as a card with a link, its level and a start button', () => {
    const body = html(CombatPage, {});
    expect(body).toMatch(anchor({ kind: 'enemy', id: 'core:dummy' }));
    expect(body).toContain('data-enemy="core:dummy"');
    expect(body).toContain('Бойовий рівень');
    expect(body).toContain('Почати бій');
    // Nothing undiscovered: no region zone, no boss zone, no raw id of a boss.
    expect(body).not.toContain('data-enemy="core:bandit"');
    expect(body).not.toContain('data-zone=');
    expect(body).not.toContain('core:boss_');
  });

  it('shows the arena with bars and what each side does while fighting', () => {
    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_dummy' }).ok,
    ).toBe(true);
    game.devAdvance(30_000);
    const body = html(CombatPage, {});
    expect(body).toContain('data-ui="fight-arena"');
    expect((body.match(/data-ui="fighter"/g) ?? []).length).toBe(2);
    expect((body.match(/data-ui="fight-action"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(body).toContain('Зупинити бій');
    expect((body.match(/role="progressbar"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('writes technique names in the battle log as links', () => {
    const entries: LogEntry[] = [
      {
        id: 1,
        event: {
          type: 'combatLog',
          at: 0,
          side: 'player',
          act: 'cast',
          tech: 'core:leaf_whirlwind',
          enemy: 'core:dummy',
          dmg: 0,
        },
      },
      {
        id: 2,
        event: {
          type: 'combatLog',
          at: 1,
          side: 'player',
          act: 'hit',
          tech: 'core:leaf_whirlwind',
          enemy: 'core:dummy',
          dmg: 9,
        },
      },
      {
        id: 3,
        event: { type: 'enemyDefeated', at: 2, enemy: 'core:dummy' },
      },
    ];
    const body = html(CombatLog, { entries });
    const ref = { kind: 'technique', id: 'core:leaf_whirlwind' } as const;
    expect(body.match(anchor(ref))).not.toBeNull();
    expect(body.split(name(ref)).length - 1).toBe(2);
    expect(body).toMatch(anchor({ kind: 'enemy', id: 'core:dummy' }));
  });

  it('feeds the log from the core events of a real fight', () => {
    game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_dummy' });
    game.devAdvance(30_000);
    expect(game.combatLog.length).toBeGreaterThan(0);
    const body = html(CombatLog, { entries: game.combatLog });
    expect(body).toMatch(/<a [^>]*href="#\/technique\/[^"]+"/);
  });
});

describe('A4: bank', () => {
  it('shows item names as links with their quantity, and a use button for the scroll', () => {
    const state = createState(1, content);
    state.bank[SCROLL] = 2;
    game.replaceState(state);
    const body = html(BankPage, {});
    expect(body).toMatch(anchor({ kind: 'item', id: SCROLL }));
    expect(body).toContain('×2');
    expect(body).toContain('Використати');
  });

  it('says so when the bank is empty', () => {
    expect(html(BankPage, {})).toContain('У банку поки порожньо');
  });
});

describe('suggested next step', () => {
  it('follows the active quest step to the page where it is done', () => {
    const state = createState(1, content);
    expect(nextStep(state, content)?.target).toBe('#/skill/tai');
    const four = atStepFour();
    expect(nextStep(four, content)?.target).toBe('#/combat');
    four.quests[QUEST] = { step: 4, base: 0, done: false };
    // Step 5 is the exam: the first missing requirement of its checklist, then the Academy page.
    expect(nextStep(four, content)?.target).toBe('#/skill/tai');
    setLevel(four, 'tai', 10);
    expect(nextStep(four, content)?.target).toBe('#/skill/nin');
    setLevel(four, 'nin', 10);
    setLevel(four, 'cc', 10);
    expect(nextStep(four, content)?.target).toBe('#/rank');
    four.quests[QUEST] = { step: 5, base: 0, done: true };
    expect(nextStep(four, content)).toBeNull();
  });

  it('marks the destination in the tab bar, the sidebar menu and nowhere else', () => {
    expect(markerOf('#/skill/tai', coreRegistry)).toEqual({ nav: 'skills', skill: 'tai' });
    expect(markerOf('#/combat', coreRegistry).nav).toBe('combat');
    expect(markerOf(null, coreRegistry)).toEqual({ nav: null, skill: null });

    game.replaceState(atStepFour());
    const tabs = inApp(TabBar);
    expect(tabs.match(/data-marker/g)).toHaveLength(1);
    expect(tabs).toMatch(/data-tab="combat"[\s\S]*?data-marker/);
    const nav = inApp(MainNav);
    expect(nav.match(/data-marker/g)).toHaveLength(1);
    expect(nav).toMatch(/data-nav="combat"[\s\S]*?data-marker/);
  });

  it('has the journal, the map and the fight on the tabs, and the bank in the side menu', () => {
    for (const body of [inApp(TabBar), inApp(MainNav)]) {
      expect(body).toContain('href="#/quests"');
      expect(body).toContain('href="#/combat"');
      expect(body).toContain('href="#/world"');
    }
    // On a phone the bank is reached from «Ще» and the top bar.
    expect(inApp(MainNav)).toContain('href="#/bank"');
    expect(inApp(TabBar)).not.toContain('href="#/bank"');
  });
});

describe('A5: hints', () => {
  it('has a ukrainian title and a text of two or three sentences for every hint', () => {
    for (const hint of HINTS) {
      const text = ukLocale[`hint.${hint.id}`];
      expect(ukLocale[`hint.title.${hint.id}`], hint.id).toBeTruthy();
      expect(text, hint.id).toBeTruthy();
      const sentences = (text ?? '').split(/[.!?]\s/).length;
      expect(sentences, hint.id).toBeGreaterThanOrEqual(2);
      expect(sentences, hint.id).toBeLessThanOrEqual(3);
    }
  });

  it('shows each state hint once its moment has come, then never again once dismissed', () => {
    const state = createState(1, content);
    const visible = (id: string) => settings.hintVisible(id);
    expect(nextStateHint(state, content, visible)).toBeNull();

    setLevel(state, 'tai', 2);
    game.replaceState(state);
    expect(html(HintHost, {})).toContain('data-hint="levelUp"');
    settings.dismissHint('levelUp');
    expect(html(HintHost, {})).not.toContain('data-hint');
  });

  it('knows the exam is available and that the player has graduated', () => {
    const state = createState(1, content);
    setLevel(state, 'tai', 10);
    setLevel(state, 'nin', 10);
    setLevel(state, 'cc', 10);
    // The levels also earn the first-level hint, which goes first; once it is read the exam hint follows.
    expect(nextStateHint(state, content, () => true)?.id).toBe('levelUp');
    expect(nextStateHint(state, content, (id) => id !== 'levelUp')?.id).toBe('examReady');
    state.player.rank = 'genin';
    expect(nextStateHint(state, content, (id) => id === 'graduation')?.id).toBe('graduation');
    const mastered = createState(1, content);
    mastered.mastery['core:clone'] = { xp: xpAt(3) };
    expect(nextStateHint(mastered, content, (id) => id === 'mastery')?.id).toBe('mastery');
  });

  it('shows nothing when hints are switched off', () => {
    const state = createState(1, content);
    setLevel(state, 'tai', 2);
    game.replaceState(state);
    settings.hints = false;
    expect(html(HintHost, {})).not.toContain('data-hint');
    expect(html(CombatPage, {})).not.toContain('data-hint');
    expect(html(QuestsPage, {})).not.toContain('data-hint');
    expect(html(RankPage, {})).not.toContain('data-hint');
    expect(html(BankPage, {})).not.toContain('data-hint');
  });

  it('puts the page hints on their pages, once', () => {
    expect(html(CombatPage, {})).toContain('data-hint="combat"');
    expect(html(QuestsPage, {})).toContain('data-hint="quests"');
    expect(html(RankPage, {})).toContain('data-hint="rank"');
    expect(html(BankPage, {})).toContain('data-hint="bank"');
    expect(html(GoalPanel, { onClose: () => {} })).toContain('data-hint="goalPanel"');
    for (const id of ['combat', 'quests', 'rank', 'bank']) settings.dismissHint(id);
    expect(html(CombatPage, {})).not.toContain('data-hint');
    expect(html(BankPage, {})).not.toContain('data-hint');
  });

  it('lists every hint on the help page, even a dismissed one or with hints off', () => {
    settings.dismissHint('combat');
    settings.hints = false;
    const body = html(HelpPage, {});
    for (const hint of HINTS) {
      expect(body, hint.id).toContain(`data-help="${hint.id}"`);
      expect(body, hint.id).toContain(ukLocale[`hint.title.${hint.id}`]);
    }
  });
});

describe('A6: developer tools', () => {
  it('are switched on by ?dev=1 only', () => {
    for (const search of ['', '?dev=0', '?dev', '?x=1', '?dev=true']) {
      expect(isDevMode(search), search).toBe(false);
    }
    expect(isDevMode('?dev=1')).toBe(true);
    expect(isDevMode('?foo=2&dev=1')).toBe(true);
  });

  it('show the panel opener', () => {
    const body = html(DevPanel, {});
    expect(body).toContain('data-dev-open');
  });

  it('advance game time through the core, not by editing the state', () => {
    const before = game.state.now;
    game.dispatch({ type: 'action.start', slot: 0, kind: 'practice', id: 'core:leaf_whirlwind' });
    game.devAdvance(60_000);
    expect(game.state.now).toBe(before + 60_000);
    expect(game.state.skills.tai!.xp).toBeGreaterThan(0);
  });
});

describe('A3: the pinned goal moves from local settings into the game', () => {
  const storageWith = (value: unknown): TextStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    if (value !== undefined) data.set(SETTINGS_KEY, JSON.stringify(value));
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, v) => void data.set(key, v),
    };
  };
  const legacy = {
    hideLocked: true,
    hints: false,
    dismissedHints: ['skillPage'],
    goal: {
      t: 'all',
      of: [
        { t: 'technique', id: 'core:great_fireball' },
        { t: 'skill', skill: 'katon', level: 20 },
      ],
    },
  };

  it('migrates an old local goal once and keeps the other settings', () => {
    const storage = storageWith(legacy);
    expect(migrateLocalGoal(storage, game)).toBe(true);
    expect(game.state.goal).toEqual({ kind: 'technique', id: 'core:great_fireball' });
    const stored = JSON.parse(storage.data.get(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
    expect('goal' in stored).toBe(false);
    expect(stored).toMatchObject({ hideLocked: true, hints: false, dismissedHints: ['skillPage'] });
    // A second run finds nothing to move.
    game.dispatch({ type: 'goal.clear' });
    expect(migrateLocalGoal(storage, game)).toBe(false);
    expect(game.state.goal).toBeNull();
  });

  it('lets a goal already in the game win and still drops the local copy', () => {
    game.dispatch({ type: 'goal.set', ref: { kind: 'technique', id: 'core:clone' } });
    const storage = storageWith(legacy);
    expect(migrateLocalGoal(storage, game)).toBe(false);
    expect(game.state.goal).toEqual({ kind: 'technique', id: 'core:clone' });
    expect(storage.data.get(SETTINGS_KEY)).not.toContain('goal');
  });

  it('ignores missing, broken or unusable local values', () => {
    expect(migrateLocalGoal(null, game)).toBe(false);
    expect(migrateLocalGoal(storageWith(undefined), game)).toBe(false);
    const broken = storageWith(undefined);
    broken.data.set(SETTINGS_KEY, '{nope');
    expect(migrateLocalGoal(broken, game)).toBe(false);
    expect(migrateLocalGoal(storageWith({ goal: { t: 'rank', rank: 'genin' } }), game)).toBe(false);
    expect(game.state.goal).toBeNull();
  });
});

describe('graduation', () => {
  it('turns the exam rank-up event into the graduation modal flag', () => {
    const state = createState(1, content);
    setLevel(state, 'tai', 10);
    setLevel(state, 'nin', 10);
    setLevel(state, 'cc', 10);
    game.replaceState(state);
    expect(game.graduation).toBe(false);
    expect(game.dispatch({ type: 'exam.genin.start' }).ok).toBe(true);
    game.devAdvance(3_600_000);
    expect(game.state.player.rank).toBe('genin');
    expect(game.graduation).toBe(true);
    expect(game.state.goal).toEqual({ kind: 'technique', id: 'core:shadow_clone' });
    expect(game.state.bank[SCROLL]).toBe(1);
    game.dismissGraduation();
    expect(game.graduation).toBe(false);
  });
});

describe('where an objective is done', () => {
  const state = createState(1, content);
  const go = (objective: Parameters<typeof objectiveTarget>[1]) =>
    objectiveTarget(state, objective, content);

  it('maps each objective type to the page of the action', () => {
    expect(go({ t: 'counter', counter: 'kills.core:dummy', n: 10 })).toBe('#/combat');
    expect(go({ t: 'counter', counter: 'actions.drill', n: 3 })).toBe('#/quests');
    expect(go({ t: 'req', req: { t: 'skill', skill: 'ath', level: 5 } })).toBe('#/skill/ath');
    expect(go({ t: 'req', req: { t: 'technique', id: 'core:rope_escape' } })).toBe('#/skill/nin');
    expect(go({ t: 'req', req: { t: 'item', id: SCROLL, n: 1 } })).toBe('#/bank');
    expect(go({ t: 'req', req: { t: 'flag', id: 'firstFight' } })).toBe('#/combat');
    expect(go({ t: 'req', req: { t: 'quest', id: QUEST } })).toBe('#/quests');
    // The exam: the first thing its checklist still lacks, else the Academy page.
    expect(go({ t: 'req', req: { t: 'rank', rank: 'genin' } })).toBe('#/skill/tai');
    const ready = createState(1, content);
    for (const skill of ['tai', 'nin', 'cc'] as const) setLevel(ready, skill, 10);
    expect(objectiveTarget(ready, { t: 'req', req: { t: 'rank', rank: 'genin' } }, content)).toBe(
      '#/rank',
    );
  });

  it('hides an unmet rank row that sits beside the real objectives', () => {
    const tree = evalReq(
      state,
      {
        t: 'all',
        of: [
          { t: 'rank', rank: 'genin' },
          { t: 'skill', skill: 'tai', level: 10 },
        ],
      },
      content,
    );
    expect(withoutRankRows(tree).children.map((c) => c.req.t)).toEqual(['skill']);
    const five = atStepFour();
    five.quests[QUEST] = { step: 4, base: 0, done: false };
    game.replaceState(five);
    expect(html(QuestsPage, {})).not.toContain('Ранг: Генін');
  });
});

describe('waiting for the sensei test', () => {
  it('shows the remaining time in the Now bar and the Goal panel from any page', () => {
    const state = createState(1, content);
    for (const skill of ['tai', 'nin', 'cc'] as const) setLevel(state, skill, 10);
    game.replaceState(state);
    expect(html(GoalPanel, { onClose: () => {} })).not.toContain('data-exam-wait');
    expect(game.dispatch({ type: 'exam.genin.start' }).ok).toBe(true);
    expect(html(GoalPanel, { onClose: () => {} })).toContain('data-exam-wait');
    expect(html(NowBar, {})).toContain('data-exam-wait');
  });
});

describe('navigation and the log', () => {
  it('has five tabs, and the missions only in the sidebar', () => {
    const body = inApp(TabBar);
    expect(body.match(/data-tab=/g)).toHaveLength(5);
    // The missions are a section of the journal on a phone, a menu item beside the quests elsewhere.
    expect(body).not.toContain('#/missions');
    expect(inApp(MainNav)).toContain('#/missions');
    // The village is a page of its own: in the sidebar menu, inside «Ще» on a phone, never a tab.
    expect(body).not.toContain('#/village');
    expect(inApp(MainNav)).toContain('#/village');
  });

  it('says the fight continues when the log is empty mid-fight', () => {
    expect(html(CombatLog, { entries: [], fighting: true })).toContain('Бій триває');
    expect(html(CombatLog, { entries: [], fighting: false })).toContain('Журнал заповниться');
  });

  it('keeps hint texts free of words for a sidebar that phones do not have', () => {
    const keys = Object.keys(ukLocale).filter((k) => k.startsWith('hint.') || k === 'home.hint');
    for (const key of keys) expect(ukLocale[key], key).not.toMatch(/ліворуч|бічн/i);
  });
});
