import { content, localeKey, ukLocale } from '@shinobi/content';
import {
  actionInfo,
  advance,
  createState,
  dispatch,
  evalReq,
  listSkillActions,
  type Req,
  rate,
  xpAt,
  type GameState,
} from '@shinobi/core';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import ActionTile from '../src/components/ActionTile.svelte';
import GoalPanel from '../src/components/GoalPanel.svelte';
import Hint from '../src/components/Hint.svelte';
import NowBar from '../src/components/NowBar.svelte';
import ReqTree from '../src/components/ReqTree.svelte';
import SkillList from '../src/components/SkillList.svelte';
import { techniqueGoal } from '../src/lib/goal.ts';
import { hrefFor, parseHash, type EntityRef } from '../src/lib/route.ts';
import { settings } from '../src/lib/settings.svelte.ts';
import { game } from '../src/lib/store.ts';
import EntityPage from '../src/pages/EntityPage.svelte';
import ItemPage from '../src/pages/ItemPage.svelte';
import SkillPage from '../src/pages/SkillPage.svelte';
import TechniquePage from '../src/pages/TechniquePage.svelte';

// The components are rendered to HTML on the server side of Svelte: no browser is needed, and the
// markup shows exactly which names are links and where they point.
const html = <P extends Record<string, unknown>>(component: Component<P>, props: P): string =>
  render(component, { props }).body;

const name = (ref: EntityRef) =>
  ukLocale[localeKey(ref.kind === 'status' ? 'state' : ref.kind, ref.id, 'name')] ?? ref.id;

/** `<a ... href="#/kind/id" ...>Name</a>` for an entity, whatever classes Svelte adds. */
const anchor = (ref: EntityRef) =>
  new RegExp(
    `<a [^>]*href="${hrefFor(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>${name(ref)}</a>`,
  );

/** How often `text` occurs in the HTML outside of an attribute. */
const count = (body: string, text: string) => body.split(text).length - 1;

/** Every occurrence of the entity name is the text of an entity link. */
function expectOnlyLinked(body: string, ref: EntityRef): void {
  const linked = [
    ...body.matchAll(new RegExp(`<a [^>]*href="#/[^"]*"[^>]*>${name(ref)}</a>`, 'g')),
  ];
  expect(linked.length).toBeGreaterThan(0);
  expect(count(body, name(ref)), `bare "${name(ref)}" outside a link`).toBe(linked.length);
}

function fresh(rank: GameState['player']['rank'] = 'genin'): GameState {
  const state = createState(1, content);
  state.player.rank = rank;
  return state;
}

beforeEach(() => {
  game.replaceState(fresh());
  settings.hideLocked = false;
  settings.hints = true;
  settings.resetHints();
});

describe('links navigate to #/<kind>/<id>', () => {
  it('builds hrefs that the router reads back', () => {
    const ref: EntityRef = { kind: 'technique', id: 'core:great_fireball' };
    expect(hrefFor(ref)).toBe('#/technique/core:great_fireball');
    expect(parseHash(hrefFor(ref))).toEqual({ page: 'entity', ref });
  });
});

describe('A5: requirement rows', () => {
  it('render the skill, technique and item names as entity links', () => {
    const state = fresh();
    const req: Req = {
      t: 'all',
      of: [
        { t: 'skill', skill: 'katon', level: 20 },
        { t: 'technique', id: 'core:great_fireball' },
        { t: 'item', id: 'core:mint', n: 3 },
        {
          t: 'any',
          of: [
            { t: 'nature', nature: 'futon' },
            { t: 'rank', rank: 'chunin' },
          ],
        },
      ],
    };
    const body = html(ReqTree, { node: evalReq(state, req, content) });
    for (const ref of [
      { kind: 'skill', id: 'katon' },
      { kind: 'technique', id: 'core:great_fireball' },
      { kind: 'item', id: 'core:mint' },
      { kind: 'skill', id: 'futon' },
    ] as const) {
      expect(body, `${ref.kind} ${ref.id}`).toMatch(anchor(ref));
      expectOnlyLinked(body, ref);
    }
  });

  it('shows progress and marks met rows', () => {
    const state = fresh();
    state.skills.tai.xp = xpAt(7);
    const body = html(ReqTree, {
      node: evalReq(state, { t: 'skill', skill: 'tai', level: 10 }, content),
    });
    expect(body).toContain('7/10');
    expect(body).toContain('data-met="false"');
    expect(body).toContain('рів. 10');
  });
});

describe('A5: action tiles', () => {
  it('link the action name and show level, interval, XP/h and a start button', () => {
    const info = listSkillActions(game.state, 'tai', content)[0];
    if (!info) throw new Error('no tai action');
    const ref = { kind: 'technique', id: info.id } as const;
    const body = html(ActionTile, { info });
    expect(body).toMatch(anchor(ref));
    expectOnlyLinked(body, ref);
    expect(body).toContain('Почати');
    expect(body).toContain('дос./год');
    expect(body).toContain(`>${info.level}<`);
  });

  it('A9: the tile shows rate(level) as XP per hour', () => {
    const info = listSkillActions(game.state, 'tai', content)[0];
    if (!info) throw new Error('no tai action');
    const shown = new Intl.NumberFormat('uk', {
      maximumFractionDigits: info.xpPerHour >= 100 ? 0 : 1,
    }).format(rate(info.level, content));
    expect(html(ActionTile, { info })).toContain(shown);
  });

  it('locked tiles show the requirement tree with links instead of a start button', () => {
    const katon = listSkillActions(game.state, 'katon', content).find((a) => !a.available);
    if (!katon) throw new Error('no locked katon action');
    const body = html(ActionTile, { info: katon });
    expect(body).toContain('Поки закрито');
    expect(body).not.toContain('Почати');
    expect(body).toMatch(anchor({ kind: 'technique', id: katon.id }));
    expect(body).toMatch(anchor({ kind: 'skill', id: 'katon' }));
  });

  it('a running tile offers to stop', () => {
    const info = listSkillActions(game.state, 'tai', content)[0];
    if (!info) throw new Error('no tai action');
    expect(game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id }).ok).toBe(
      true,
    );
    const body = html(ActionTile, { info: actionInfo(game.state, info, content) ?? info });
    expect(body).toContain('Зупинити');
  });
});

describe('skill page', () => {
  it('lists the tiles, the pool with its four checkpoints and the first-visit hint', () => {
    const body = html(SkillPage, { id: 'tai' });
    const taiTechniques = content.techniques.filter((t) => t.skill === 'tai');
    expect(count(body, 'data-action=')).toBe(taiTechniques.length);
    expect(count(body, 'data-checkpoint=')).toBe(4);
    for (const cp of content.pools.filter((p) => p.skill === 'tai')) {
      expect(body).toContain(ukLocale[localeKey('pool', cp.id, 'desc')]);
    }
    expect(body).toContain('data-hint="skillPage"');
  });

  it('shows the lock and its condition for a shut skill', () => {
    game.replaceState(fresh('student'));
    const body = html(SkillPage, { id: 'katon' });
    expect(body).toContain('data-locked');
    expect(body).toContain('Природа чакри:');
  });
});

describe('technique page', () => {
  const id = 'core:great_fireball';

  it('A8: shows the seal strip with glyphs and Ukrainian names in order', () => {
    const body = html(TechniquePage, { id });
    const glyphs = [...body.matchAll(/class="glyph[^"]*" lang="ja">([^<]+)</g)].map((m) => m[1]);
    expect(glyphs).toEqual(['巳', '未', '申', '亥', '午', '寅']);
    const names = ['Змія', 'Баран', 'Мавпа', 'Кабан', 'Кінь', 'Тигр'];
    const seals = content.techniques.find((t) => t.id === id)?.sealSeq ?? [];
    expect(seals).toHaveLength(6);
    seals.forEach((seal, i) => {
      expect(name({ kind: 'seal', id: seal })).toBe(names[i]);
      expect(body).toMatch(anchor({ kind: 'seal', id: seal }));
    });
  });

  it('links the mission that asks for it and prints no mission name as plain text', () => {
    const body = html(TechniquePage, { id });
    const mission = { kind: 'mission', id: 'core:v_sanit' } as const;
    expect(name(mission)).toBe('Санітарна варта');
    expect(body).toMatch(anchor(mission));
    expectOnlyLinked(body, mission);
    expect(body).not.toContain('Місія села');
  });

  it('links the status it applies and the traits its tags answer', () => {
    const body = html(TechniquePage, { id });
    expect(body).toContain('href="#/status/burn"');
    expect(body).toContain('href="#/trait/');
  });

  it('links its source building', () => {
    const body = html(TechniquePage, { id: 'core:leaf_whirlwind' });
    expect(body).toMatch(anchor({ kind: 'building', id: 'core:academy' }));
  });

  it('shows name, rank stamp, role, status, requirements and the pin button', () => {
    const body = html(TechniquePage, { id });
    expect(body).toContain('Техніка великої вогняної кулі');
    expect(body).toContain('Ранг техніки');
    expect(body).toContain(
      ukLocale['role.' + (content.techniques.find((t) => t.id === id)?.role ?? '') + '.name'],
    );
    expect(body).toContain('Ще не відкрита');
    expect(body).toMatch(anchor({ kind: 'skill', id: 'katon' }));
    expect(body).toContain('Закріпити як мету');
  });
});

describe('item page', () => {
  it('links the skill that grows it and the recipes that use it', () => {
    const body = html(ItemPage, { id: 'core:mint' });
    expect(body).toMatch(anchor({ kind: 'skill', id: 'herb' }));
    const used = content.recipes.find((r) => r.ingredients.some((i) => i.item === 'core:mint'));
    if (!used) throw new Error('no recipe uses mint');
    expect(body).toMatch(anchor({ kind: 'recipe', id: used.id }));
    expect(body).toContain('Де використовується');
  });
});

describe('generic entity page', () => {
  it('shows name and description for any other kind', () => {
    const ref = { kind: 'building', id: content.buildings[0]?.id ?? '' } as const;
    const body = html(EntityPage, { entity: ref });
    expect(body).toContain(name(ref));
    expect(body).toContain(ukLocale[localeKey('building', ref.id, 'desc')]);
  });
});

describe('A5: goal panel', () => {
  it('renders the pinned goal as a tree of links', () => {
    expect(techniqueGoal('core:great_fireball', content)).not.toBeNull();
    game.dispatch({ type: 'goal.set', ref: { kind: 'technique', id: 'core:great_fireball' } });
    const body = html(GoalPanel, { onClose: () => {} });
    expect(body).toMatch(anchor({ kind: 'technique', id: 'core:great_fireball' }));
    expect(body).toMatch(anchor({ kind: 'skill', id: 'katon' }));
    expect(body).toContain('Відкріпити мету');
    expect(body).toContain('data-hint="goalPanel"');
  });

  it('suggests the current quest step, with a way to where it is done, when nothing is pinned', () => {
    const body = html(GoalPanel, { onClose: () => {} });
    expect(body).toContain('data-suggestion="quest"');
    expect(body).toMatch(anchor({ kind: 'quest', id: 'core:graduation' }));
    expect(body).toMatch(anchor({ kind: 'skill', id: 'tai' }));
    expect(body).toMatch(/<a [^>]*href="#\/skill\/tai"[^>]*data-go/);
  });

  it('suggests the nearest technique gated only by level once every chain is done', () => {
    const done = fresh();
    done.quests['core:graduation'] = { step: 5, base: 0, done: true };
    game.replaceState(done);
    const body = html(GoalPanel, { onClose: () => {} });
    expect(body).toContain('Закріпленої мети ще немає');
    const match = /data-suggestion[\s\S]*?href="#\/technique\/([^"]+)"/.exec(body);
    expect(match).not.toBeNull();
    const tech = content.techniques.find((t) => t.id === decodeURIComponent(match?.[1] ?? ''));
    expect(tech?.src).toBe('N');
    expect(game.state.known[tech?.id ?? '']).toBeUndefined();
  });
});

describe('now bar', () => {
  it('shows the idle line, then the running action as a link with a stop button', () => {
    expect(html(NowBar, {})).toContain('Жодної дії не виконується');
    const info = listSkillActions(game.state, 'tai', content)[0];
    if (!info) throw new Error('no tai action');
    game.dispatch({ type: 'action.start', slot: 0, kind: info.kind, id: info.id });
    const body = html(NowBar, {});
    expect(body).toMatch(anchor({ kind: 'technique', id: info.id }));
    expect(body).toContain('Зупинити');
    expect(body).toContain('role="progressbar"');
  });
});

describe('A6: locked skills in the sidebar', () => {
  it('show a lock and the condition; the setting hides them', () => {
    game.replaceState(fresh('student'));
    let body = html(SkillList, {});
    const katon = new RegExp('data-skill="katon"[\\s\\S]*?</li>').exec(body)?.[0] ?? '';
    expect(katon).toContain('Навичка закрита');
    expect(katon).toContain('Природа чакри:');
    expect(body).toContain('data-skill="tai"');

    settings.hideLocked = true;
    body = html(SkillList, {});
    expect(body).not.toContain('data-skill="katon"');
    expect(body).not.toContain('data-skill="vit"');
    expect(body).toContain('data-skill="tai"');
  });

  it('keep the nature skills shut at genin until the nature is owned, and mark the native one', () => {
    const row = (body: string, skill: string) =>
      new RegExp(`data-skill="${skill}"[\\s\\S]*?</li>`).exec(body)?.[0] ?? '';
    game.replaceState(fresh('genin'));
    let body = html(SkillList, {});
    expect(row(body, 'katon')).toContain('data-lock');
    expect(body).not.toContain('data-native');

    const state = fresh('genin');
    dispatch(state, { type: 'nature.choose', nature: 'katon' }, content);
    game.replaceState(state);
    body = html(SkillList, {});
    expect(row(body, 'katon')).not.toContain('data-lock');
    expect(row(body, 'katon')).toContain('data-native');
    expect(row(body, 'futon')).toContain('data-lock');
  });
});

describe('real state in the views', () => {
  it('levels and bars follow the game', () => {
    const state = fresh();
    const info = listSkillActions(state, 'tai', content)[0];
    if (!info) throw new Error('no tai action');
    dispatch(state, { type: 'action.start', slot: 0, kind: info.kind, id: info.id }, content);
    advance(state, 3_600_000, content);
    game.replaceState(state);
    expect(html(SkillList, {})).toMatch(/Рів\. [2-9]/);
  });
});

describe('hints', () => {
  it('are shown once and not again after dismissal, and not at all when switched off', () => {
    expect(html(Hint, { id: 'combat' })).toContain('data-hint="combat"');
    settings.dismissHint('combat');
    expect(html(Hint, { id: 'combat' })).not.toContain('data-hint');
    settings.resetHints();
    settings.hints = false;
    expect(html(Hint, { id: 'combat' })).not.toContain('data-hint');
  });
});
