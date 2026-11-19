// @vitest-environment happy-dom
import { content } from '@shinobi/content';
import { defaultRules, summonSpecOf } from '@shinobi/core';
import { flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AllyRow from '../src/components/AllyRow.svelte';
import { setActiveContent } from '../src/lib/active.ts';
import { allyName } from '../src/lib/ally-name.ts';
import { buildScene, type FighterView } from '../src/lib/fight-scene.ts';
import { coreUi } from '../src/lib/ext/core-ui.ts';
import { t } from '../src/lib/i18n.ts';
import { game } from '../src/lib/store.ts';
import { bootApp, genin, type BootedApp } from './helpers/boot-app.ts';
import { createState, xpAt, type GameState } from '@shinobi/core';

vi.mock('../src/lib/store.ts', async () => {
  const { createGame } = await import('../src/lib/game.svelte.ts');
  return { game: createGame({ clock: { now: () => 0 } }) };
});

const CLONE = 'core:shadow_clone';

/** What a component draws, as markup (the app's own client build, in the test's DOM). */
function html<P extends Record<string, unknown>>(component: Component<P>, props: P): string {
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(component, { target, props });
  flushSync();
  const out = target.innerHTML;
  unmount(app);
  target.remove();
  return out;
}

/** A body of the character's side as the scene reads it. */
function ally(patch: Partial<FighterView> = {}): FighterView {
  return {
    key: 'ally#1',
    side: 'player',
    entry: null,
    ally: 1,
    allyKind: CLONE,
    out: null,
    nth: 1,
    of: 1,
    alive: true,
    hp: 10,
    maxHp: 30,
    chakra: 5,
    maxChakra: 20,
    stamina: 0,
    maxStamina: 0,
    phase: 'wait',
    heldBy: null,
    action: null,
    timing: { fraction: 0, cycleMs: 0, running: false, repeat: false },
    seals: [],
    cast: null,
    statuses: [],
    last: null,
    ...patch,
  };
}

/** The content with the summon of the core clone technique replaced by `effect`. */
function summonedAs(effect: Record<string, unknown>): typeof content {
  return {
    ...content,
    techniques: content.techniques.map((x) =>
      x.id === CLONE && x.combat ? { ...x, combat: { ...x.combat, effect } } : x,
    ),
  } as typeof content;
}

/** A genin with the skills and techniques to fight the pack of wolves from the start. */
function fighter(): GameState {
  const state = createState(9, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const k = state.skills[skill as keyof typeof state.skills];
    if (k) k.xp = xpAt(12);
  }
  for (const x of content.techniques) if (x.rank === 'D') state.known[x.id] = true;
  for (const cell of content.cells) state.world.explores[cell.id] = 9999;
  state.flags['region.forest.unlocked'] = true;
  return state;
}

beforeAll(async () => {
  await game.start();
});

describe('the name of an ally comes from what summoned it', () => {
  afterEach(() => setActiveContent(game.content));

  it('names the core clone «Клон №n» by the key its summon names', () => {
    expect(allyName(CLONE, 3)).toBe('Клон №3');
  });

  it("names a mod's summon by its own key, and one with no key by the technique and the number", () => {
    const fx = (content.techniques.find((x) => x.id === CLONE)?.combat?.effect as { fx: string })
      .fx;
    setActiveContent(summonedAs({ kind: 'summon', fx, allyName: 'squad.clone' }));
    expect(allyName(CLONE, 2)).toBe(t('squad.clone', { n: 2 }));
    setActiveContent(summonedAs({ kind: 'summon', fx }));
    const out = allyName(CLONE, 2);
    expect(out).toContain('№2');
    expect(out).not.toBe('Клон №2');
    // A key the texts do not have is no name: the technique and the number stand in.
    setActiveContent(summonedAs({ kind: 'summon', fx, allyName: 'mod.nothing' }));
    expect(allyName(CLONE, 2)).toBe(out);
  });

  it('shows the name on the row of the ally', () => {
    expect(html(AllyRow, { f: ally({ ally: 2 }) })).toContain('Клон №2');
    setActiveContent(summonedAs({ kind: 'summon', fx: 'combatClone' }));
    const row = html(AllyRow, { f: ally({ ally: 2 }) });
    expect(row).not.toContain('Клон №2');
    expect(row).toContain('№2');
    setActiveContent(game.content);
  });
});

describe('how an ally left the fight reads on its row', () => {
  it('says «Розвіяно» for a body that ran dry, «Знешкоджено» for one struck down or unrecorded', () => {
    const down = { alive: false, hp: 0 };
    expect(html(AllyRow, { f: ally({ ...down, out: 'dispelled' }) })).toContain('Розвіяно');
    expect(html(AllyRow, { f: ally({ ...down, out: 'dispelled' }) })).not.toContain('Знешкоджено');
    expect(html(AllyRow, { f: ally({ ...down, out: 'struck' }) })).toContain('Знешкоджено');
    expect(html(AllyRow, { f: ally({ ...down, out: null }) })).toContain('Знешкоджено');
    expect(html(AllyRow, { f: ally() })).not.toContain('Розвіяно');
  });
});

describe('the role the rows name', () => {
  it("is the one saved in the fight's kit, not the default's, when its pack is gone", () => {
    const state = fighter();
    state.known[CLONE] = true;
    game.replaceState(state);
    expect(
      game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_wolf' }),
    ).toEqual({ ok: true });
    game.devAdvance(1000);
    const fight = game.state.combat?.fight;
    if (!fight) throw new Error('no fight');
    const own = buildScene(game.state, game.content, defaultRules);
    // A fight begun with a role names it; one that saved none was begun with the default role.
    expect(own?.cloneRole).toBe(
      fight.kit.cloneRole ?? content.cloneRoles.find((r) => r.default)?.id,
    );
    fight.kit.cloneRole = 'mod:gone';
    expect(buildScene(game.state, game.content, defaultRules)?.cloneRole).toBe('mod:gone');
    // The row of that role names no role at all rather than the default's.
    const row = html(AllyRow, { f: ally(), role: 'mod:gone' });
    expect(row).not.toContain('data-ally-role');
  });
});

describe('the technique page of a summon', () => {
  let booted: BootedApp | null = null;
  afterEach(() => {
    booted?.destroy();
    booted = null;
  });

  it('shows the bodies, their health, damage and threat from the summon numbers instead of «no damage»', async () => {
    const state = genin();
    state.known[CLONE] = true;
    booted = await bootApp([coreUi], state, `#/technique/${CLONE}`);
    const at = (name: string) =>
      booted?.target.querySelector<HTMLElement>(`[data-figure="${name}"]`)?.textContent?.trim();
    const spec = summonSpecOf(content, 'combatClone', 1);
    expect(at('summon-count')).toContain(String(spec.count));
    expect(at('summon-hp')).toBe(`${Math.round(spec.hp * 100)}%`);
    expect(at('summon-dmg')).toBe(`${Math.round(spec.dmg * 100)}%`);
    expect(at('summon-threat')).toBeTruthy();
    expect(at('summon-share')).toBe(`${Math.round(spec.share * 100)}%`);
    expect(at('damage')).toBeUndefined();
    expect(booted.target.textContent).not.toContain(t('technique.noDamage'));
  });

  it('still shows the damage of an ordinary technique', async () => {
    const state = genin();
    booted = await bootApp([coreUi], state, '#/technique/core:great_fireball');
    expect(booted.target.querySelector('[data-figure="damage"]')).not.toBeNull();
    expect(booted.target.querySelector('[data-figure="summon-count"]')).toBeNull();
  });
});
