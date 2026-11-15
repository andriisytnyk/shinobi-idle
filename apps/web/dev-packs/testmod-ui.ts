import type { GameState } from '@shinobi/core';
import type { UiApi, UiPack } from '../src/lib/ext/types.ts';

/**
 * A UI pack that exercises every kind of extension point. It reads the game only through `UiApi`.
 * It is the UI pack of the content pack `testmod` (`ui: 'testmod'`): the dev build loads both with `?packs=testmod`.
 */

const SHARE_FULL = 1000;
const MS_PER_HOUR = 3_600_000;

export const TESTMOD_UK: Record<string, string> = {
  'x.testmod.theme': 'Тестова тема',
  'x.testmod.xph': 'Досвід за годину',
  'x.testmod.toNext': 'До наступного рівня',
  'x.testmod.toMax': 'До максимального рівня',
  'x.testmod.nav': 'Таблиця навичок',
  'x.testmod.page': 'Усі навички',
  'x.testmod.skill': 'Навичка',
  'x.testmod.started': 'Розпочато дій: {n}',
  'x.testmod.link': 'Відкрити таблицю навичок',
  'x.testmod.hideMax': 'Не показувати «До максимального рівня»',
  'x.testmod.cancelStop': 'Забороняти зупинку дій',
  'x.testmod.hideHelp': 'Ховати «Довідку» з меню',
  'x.testmod.cancelled': 'Розширення не дозволило зупинити дію.',
  'x.testmod.banner': 'Налаштування доповнено розширенням.',
  'x.testmod.masteryLine': 'До наступного рівня Майстерності: {n} досвіду',
  'x.testmod.none': '—',
};

export interface Figures {
  /** XP per hour of the action the skill is running, at its share of the speed. */
  xph: number;
  /** Milliseconds until the next level at that rate; 0 at the cap. */
  toNextMs: number;
  /** Milliseconds until the maximum level at that rate; 0 at the cap. */
  toMaxMs: number;
}

/** The three numbers for a skill, or null when none of the running actions trains it. Only `UiApi` is used. */
export function figuresFor(api: UiApi, skill: string): Figures | null {
  const { actionInfo, levelAt, levelCap, xpAt } = api.core;
  const state = api.read();
  for (const slot of state.slots) {
    if (!slot.action) continue;
    const info = actionInfo(state, slot.action, api.content);
    if (!info || info.skill !== skill) continue;
    const xph = (info.xpPerHour * slot.share) / SHARE_FULL;
    if (xph <= 0) return null;
    const cap = levelCap(api.content);
    const xp = state.skills[skill as keyof GameState['skills']]?.xp ?? 0;
    const level = levelAt(xp, cap);
    const hours = (target: number) => Math.max(0, target - xp) / xph;
    return {
      xph,
      toNextMs: level >= cap ? 0 : Math.round(hours(xpAt(level + 1)) * MS_PER_HOUR),
      toMaxMs: level >= cap ? 0 : Math.round(hours(xpAt(cap)) * MS_PER_HOUR),
    };
  }
  return null;
}

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} год ${minutes % 60} хв` : `${minutes} хв`;
}

const NONE = '—';

function row(label: string, value: string, part: string): HTMLElement {
  const div = document.createElement('div');
  div.dataset.testmod = part;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  div.append(dt, dd);
  return div;
}

type Figure = [part: string, label: string, value: string];

function skillFigures(api: UiApi, skill: string, withMax: boolean): Figure[] {
  const f = figuresFor(api, skill);
  const rows: Figure[] = [
    ['xph', api.t('x.testmod.xph'), f ? String(Math.round(f.xph)) : NONE],
    ['to-next', api.t('x.testmod.toNext'), f ? duration(f.toNextMs) : NONE],
  ];
  if (withMax) rows.push(['to-max', api.t('x.testmod.toMax'), f ? duration(f.toMaxMs) : NONE]);
  return rows;
}

const STARTED = 'started';

export const testmodUi: UiPack = {
  id: 'testmod',
  theme: {
    id: 'bright',
    name: 'x.testmod.theme',
    tokens: {
      '--accent': '#ff4fa3',
      '--space-1': '0.4rem',
      '--control-xs': '2.25rem',
      '--control-sm': '2.5rem',
      '--control-md': '3rem',
    },
    css: '[data-ui="page"] { outline: 0; }',
  },
  setup(ui) {
    ui.addLocale('uk', TESTMOD_UK);

    ui.addSetting({ id: 'hideMax', title: 'x.testmod.hideMax', kind: 'toggle', default: false });
    ui.addSetting({
      id: 'cancelStop',
      title: 'x.testmod.cancelStop',
      kind: 'toggle',
      default: false,
    });
    ui.addSetting({ id: 'hideHelp', title: 'x.testmod.hideHelp', kind: 'toggle', default: false });

    ui.addWidget(
      'skill.header',
      (el, api, ctx) => {
        const box = document.createElement('dl');
        box.dataset.testmod = 'figures';
        el.append(box);
        let shown = '';
        let inputs = '';
        const draw = () => {
          // What the figures depend on: the running actions and the skill's XP. Nothing else needs a recount.
          const key = [
            api.read((s) =>
              s.slots.map((sl) =>
                sl.action ? `${sl.action.kind}:${sl.action.id}:${sl.share}` : '-',
              ),
            ),
            api.read((s) => s.skills[ctx.skill as keyof typeof s.skills]?.xp),
            api.setting('hideMax'),
          ].join('#');
          if (key === inputs) return;
          inputs = key;
          const rows = skillFigures(api, ctx.skill, api.setting('hideMax') !== true);
          const text = rows.map((r) => r.join('=')).join('|');
          if (text === shown) return;
          shown = text;
          box.replaceChildren(...rows.map(([part, label, value]) => row(label, value, part)));
        };
        const off = api.subscribe(draw);
        draw();
        return () => {
          off();
          box.remove();
        };
      },
      { id: 'figures' },
    );

    ui.addPage({
      id: 'skills',
      route: '#/x/testmod/skills',
      title: 'x.testmod.page',
      nav: 'skills',
      mount(el, api) {
        const root = document.createElement('div');
        root.dataset.testmod = 'page';
        el.append(root);
        const draw = () => {
          const table = document.createElement('table');
          const head = table.createTHead().insertRow();
          const body = table.createTBody();
          for (const label of [
            api.t('x.testmod.skill'),
            api.t('x.testmod.xph'),
            api.t('x.testmod.toNext'),
            api.t('x.testmod.toMax'),
          ]) {
            head.insertCell().textContent = label;
          }
          for (const skill of api.content.skills) {
            const f = figuresFor(api, skill.id);
            const tr = body.insertRow();
            tr.dataset.skill = skill.id;
            tr.insertCell().textContent = api.t(`skill.${skill.id}.name`);
            tr.insertCell().textContent = f ? String(Math.round(f.xph)) : NONE;
            tr.insertCell().textContent = f ? duration(f.toNextMs) : NONE;
            tr.insertCell().textContent = f ? duration(f.toMaxMs) : NONE;
          }
          const started = document.createElement('p');
          started.dataset.testmod = 'started';
          started.textContent = api.t('x.testmod.started', {
            n: api.storage.get<number>(STARTED) ?? 0,
          });
          root.replaceChildren(table, started);
        };
        const off = api.subscribe(draw);
        draw();
        return () => {
          off();
          root.remove();
        };
      },
    });

    ui.addNavItem({
      id: 'skills',
      group: 'side',
      title: 'x.testmod.nav',
      icon: 'lucide:map',
      route: '#/x/testmod/skills',
      order: 90,
    });

    ui.addEntityLink({
      kind: 'technique',
      title: 'x.testmod.link',
      href: () => '#/x/testmod/skills',
    });

    ui.wrapPage('core:settings', (el, api, inner) => {
      const banner = document.createElement('p');
      banner.dataset.testmod = 'banner';
      banner.textContent = api.t('x.testmod.banner');
      const host = document.createElement('div');
      el.append(banner, host);
      const stop = inner(host);
      return () => {
        stop();
        banner.remove();
        host.remove();
      };
    });

    ui.removeNavItem('core:help', { when: (api) => api.setting('hideHelp') === true });
  },

  start(api) {
    // Counts the actions started, whichever page or bot started them.
    api.on('command:after', (command, result) => {
      if (command.type === 'action.start' && result.ok) {
        api.storage.set(STARTED, (api.storage.get<number>(STARTED) ?? 0) + 1);
      }
    });
    // Refuses to stop an action while the setting is on, and says so.
    api.on('command:before', (command) => {
      if (command.type === 'action.stop' && api.setting('cancelStop') === true) {
        api.toast(api.t('x.testmod.cancelled'));
        return false;
      }
    });
    // A line in every action tile, whether it is there now or appears later. One subscription serves
    // all the lines, so that the cost of an update does not grow with the number of tiles.
    const lines = new Map<HTMLElement, () => void>();
    const offUpdates = api.subscribe(() => {
      for (const draw of lines.values()) draw();
    });
    const offObserve = api.dom.observe({ part: 'action-tile' }, (el, tileApi) => {
      const line = document.createElement('p');
      line.dataset.testmod = 'mastery-line';
      el.append(line);
      const id = (el.getAttribute('data-entity') ?? '').split(':').slice(1).join(':');
      let seen = -1;
      const draw = () => {
        const xp = tileApi.read((s) => s.mastery[id]?.xp ?? 0);
        // The line depends on nothing but the Mastery XP.
        if (xp === seen) return;
        seen = xp;
        const { levelAt, xpAt } = tileApi.core;
        const cap = tileApi.content.balance.K.masteryCap;
        const level = levelAt(xp, cap);
        const left = level >= cap ? 0 : xpAt(level + 1) - xp;
        line.textContent = tileApi.t('x.testmod.masteryLine', { n: Math.round(left) });
      };
      lines.set(el, draw);
      draw();
      return () => {
        lines.delete(el);
        line.remove();
      };
    });
    return () => {
      offUpdates();
      offObserve();
    };
  },
};
