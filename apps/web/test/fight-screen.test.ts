import { content, ukLocale } from '@shinobi/content';
import { createState, defaultRules, fightSlotIndex, xpAt, type GameState } from '@shinobi/core';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import AllyRow from '../src/components/AllyRow.svelte';
import CombatLog from '../src/components/CombatLog.svelte';
import type { LogEntry } from '../src/lib/game.svelte.ts';
import Fighter from '../src/components/Fighter.svelte';
import CombatPage from '../src/pages/CombatPage.svelte';
import {
  buildScene,
  castView,
  outcomesOf,
  targetedKey,
  type FighterView,
  type LastView,
  type Outcome,
  type Scene,
} from '../src/lib/fight-scene.ts';
import { game } from '../src/lib/store.ts';
import { MIN_SEAL_MS } from '../src/lib/timing.ts';

const html = <P extends Record<string, unknown>>(component: Component<P>, props: P): string =>
  render(component, { props }).body;

const name = (kind: string, id: string): string =>
  ukLocale[`${kind === 'status' ? 'state' : kind}.${id}.name`] ?? id;

const STILL = { fraction: 0.4, cycleMs: 1000, running: true, repeat: false };

/** A body of the arena with nothing going on; a test changes what it needs. */
function body(patch: Partial<FighterView> = {}): FighterView {
  return {
    key: 'enemy-1',
    side: 'enemy',
    entry: 'core:wolf',
    ally: null,
    nth: 1,
    of: 1,
    alive: true,
    hp: 30,
    maxHp: 40,
    chakra: 0,
    maxChakra: 0,
    stamina: 0,
    maxStamina: 0,
    phase: 'wait',
    heldBy: null,
    action: null,
    timing: STILL,
    seals: [],
    cast: null,
    statuses: [],
    last: null,
    ...patch,
  };
}

const player = (patch: Partial<FighterView> = {}): FighterView =>
  body({
    key: 'player',
    side: 'player',
    entry: null,
    hp: 100,
    maxHp: 120,
    chakra: 50,
    maxChakra: 60,
    stamina: 40,
    maxStamina: 50,
    ...patch,
  });

const last = (patch: Partial<LastView>): LastView => ({
  kind: 'basic',
  id: null,
  outcome: 'hit',
  damage: 0,
  statuses: [],
  combos: [],
  avoidedBy: null,
  atMs: 1000,
  ageMs: 200,
  ...patch,
});

const FIREBALL = 'core:great_fireball';
const sealsOf = (id: string) => content.techniques.find((t) => t.id === id)?.sealSeq ?? [];

describe('F1: every phase of a fighter reads in words', () => {
  it('a body waiting for the moment says so and shows its progress', () => {
    const out = html(Fighter, { f: player() });
    expect(out).toContain('data-ui="fighter"');
    expect(out).toContain('data-ui="fight-action"');
    expect(out).toContain('data-action="wait"');
    expect(out).toContain('Вичікує момент');
    expect(out).toContain('role="progressbar"');
  });

  it('a technique in the cast shows its emblem, its name as a link and its seals one by one', () => {
    const seals = sealsOf(FIREBALL);
    expect(seals.length).toBeGreaterThan(1);
    const timing = { fraction: 0.5, cycleMs: 1600, running: true, repeat: false };
    const f = player({
      phase: 'act',
      action: { kind: 'technique', id: FIREBALL, target: null },
      timing,
      seals,
      cast: castView(timing, seals.length),
    });
    const out = html(Fighter, { f });
    expect(out).toContain('data-action="cast"');
    expect(out).toContain('data-emblem-kind="technique"');
    expect(out).toMatch(
      new RegExp(`<a [^>]*href="#/technique/[^"]*"[^>]*>${name('technique', FIREBALL)}</a>`),
    );
    expect(out).toContain('data-seal-strip');
    expect(out).toContain('data-mode="steps"');
    expect(out.match(/data-seal-index=/g)?.length).toBe(seals.length);
  });

  it('seals that would show for under a quarter of a second light as one sweep', () => {
    const seals = sealsOf(FIREBALL);
    const view = castView(
      { fraction: 0.2, cycleMs: seals.length * (MIN_SEAL_MS - 50), running: true },
      seals.length,
    );
    expect(view.sweep).toBe(true);
    const slow = castView(
      { fraction: 0.2, cycleMs: seals.length * (MIN_SEAL_MS + 50), running: true },
      seals.length,
    );
    expect(slow.sweep).toBe(false);
    const f = player({
      phase: 'act',
      action: { kind: 'technique', id: FIREBALL, target: null },
      seals,
      cast: view,
    });
    expect(html(Fighter, { f })).toContain('data-mode="sweep"');
  });

  it('the basic strike, an item, a rest and a stun each have their words', () => {
    expect(
      html(Fighter, {
        f: player({ phase: 'act', action: { kind: 'basic', id: null, target: null } }),
      }),
    ).toContain("Б'є");
    const item = content.items.find((i) => i.id.includes('bandage')) ?? content.items[0]!;
    const used = html(Fighter, {
      f: player({ phase: 'act', action: { kind: 'item', id: item.id, target: null } }),
    });
    expect(used).toContain('Використовує:');
    expect(used).toContain(name('item', item.id));
    expect(
      html(Fighter, {
        f: player({ phase: 'rest', action: { kind: 'rest', id: null, target: null } }),
      }),
    ).toContain('Переводить подих');
    const stunned = html(Fighter, {
      f: player({
        phase: 'act',
        action: { kind: 'basic', id: null, target: null },
        heldBy: 'stun',
      }),
    });
    expect(stunned).toContain('Приголомшений');
    expect(stunned).toContain('data-held');
  });

  it('an enemy that attacks says it strikes', () => {
    const out = html(Fighter, {
      f: body({ phase: 'act', action: { kind: 'attack', id: null, target: 'player' } }),
    });
    expect(out).toContain("Б'є");
  });
});

describe('F1: what an action did stays under its fighter', () => {
  it('a hit shows the damage on the last line', () => {
    const out = html(Fighter, {
      f: player({ last: last({ kind: 'technique', id: FIREBALL, damage: 37 }) }),
    });
    expect(out).toContain('data-ui="fight-outcome"');
    expect(out).toContain('data-kind="last"');
    expect(out).toContain('−37');
    expect(out).toContain(name('technique', FIREBALL));
  });

  it('a dodge names the defensive technique that did it, in its own words', () => {
    const f = body({
      last: last({ kind: 'attack', outcome: 'miss', avoidedBy: 'core:body_replacement' }),
    });
    const out = html(Fighter, { f });
    expect(out).toContain('Ти ухилився');
    expect(out).toContain('підмінився колодою');
    const pop = html(Fighter, {
      f: player(),
      outcomes: [
        {
          key: 'a@1',
          kind: 'dodge',
          amount: 0,
          via: 'core:body_replacement',
          statuses: [],
          combos: [],
        },
      ] satisfies Outcome[],
    });
    expect(pop).toContain('data-kind="pop"');
    expect(pop).toContain('Ухилився');
    expect(pop).toContain('підмінився колодою');
  });

  it('an interrupted action, a status it applied and a combo are named', () => {
    const interrupted = html(Fighter, {
      f: player({ last: last({ kind: 'technique', id: FIREBALL, outcome: 'interrupted' }) }),
    });
    expect(interrupted).toContain('Перервано');
    const status = content.statuses[0]!;
    const combo = content.combos[0]!;
    const out = html(Fighter, {
      f: player({
        last: last({
          kind: 'technique',
          id: FIREBALL,
          damage: 9,
          statuses: [status.id],
          combos: [combo.id],
        }),
      }),
    });
    expect(out).toContain('Накладено:');
    expect(out).toContain(name('status', status.id));
    expect(out).toContain('Комбо:');
    expect(out).toContain(name('combo', combo.id));
  });

  it('statuses show how long they have left', () => {
    const status = content.statuses[0]!;
    const out = html(Fighter, {
      f: body({ statuses: [{ id: status.id, remainingMs: 3000, stacks: 1 }] }),
    });
    expect(out).toContain(`data-status="${status.id}"`);
    expect(out).toContain('3');
  });

  it('a downed body shows no bars and no action', () => {
    const out = html(Fighter, { f: body({ alive: false, hp: 0 }) });
    expect(out).toContain('Знешкоджено');
    expect(out).not.toContain('data-ui="fight-action"');
  });
});

describe('F1: the outcomes that fly off a body', () => {
  const scene = (p: FighterView, enemies: FighterView[], allies: FighterView[] = []): Scene => ({
    slot: 0,
    phase: 'fight',
    player: p,
    allies,
    enemies,
    nowMs: 2000,
  });

  it('puts an enemy hit on the ally it was aimed at, and an ally strike on the enemy it names', () => {
    const clone = (patch: Partial<FighterView> = {}) =>
      body({ key: 'ally#1', side: 'player', entry: null, ally: 1, ...patch });
    const out = outcomesOf(
      scene(
        player(),
        [
          body({
            key: 'e',
            action: { kind: 'attack', id: null, target: 'ally#1' },
            last: last({ kind: 'attack', damage: 7, atMs: 1900, ageMs: 100 }),
          }),
          body({ key: 'f' }),
        ],
        [
          clone({
            action: { kind: 'basic', id: null, target: 'f' },
            last: last({ kind: 'basic', damage: 4, atMs: 1900, ageMs: 100 }),
          }),
        ],
      ),
    );
    expect(out['ally#1']?.[0]?.amount).toBe(7);
    expect(out.f?.[0]?.amount).toBe(4);
    expect(out.player).toBeUndefined();
  });

  it('draws a combat clone as a small row with its name, its bars and what it does, and a fallen one as down', () => {
    const f = body({
      key: 'ally#2',
      side: 'player',
      entry: null,
      ally: 2,
      maxChakra: 20,
      chakra: 12,
      phase: 'act',
      action: { kind: 'technique', id: FIREBALL, target: null },
    });
    const out = html(AllyRow, { f });
    expect(out).toContain('Клон №2');
    expect(out).toContain('data-ally="2"');
    expect(out).toContain('data-ui="fight-action"');
    expect(out).toContain(name('technique', FIREBALL));
    const down = html(AllyRow, { f: { ...f, alive: false, hp: 0 } });
    expect(down).toContain('Знешкоджено');
    expect(down).not.toContain('data-ui="fight-action"');
  });

  it('puts the player damage on the first enemy standing and an enemy hit on the player', () => {
    const hit = outcomesOf(
      scene(player({ last: last({ damage: 12, atMs: 1900, ageMs: 100 }) }), [
        body({ key: 'a', alive: false, hp: 0 }),
        body({ key: 'b', last: last({ kind: 'attack', damage: 5, atMs: 1800, ageMs: 200 }) }),
      ]),
    );
    expect(hit.b?.[0]?.kind).toBe('damage');
    expect(hit.b?.[0]?.amount).toBe(12);
    expect(hit.player?.[0]?.amount).toBe(5);
  });

  it('shows a miss on the one who avoided it, an interruption on the one interrupted, and nothing once old', () => {
    const out = outcomesOf(
      scene(
        player({
          last: last({ kind: 'technique', id: FIREBALL, outcome: 'interrupted', ageMs: 300 }),
        }),
        [
          body({
            key: 'b',
            last: last({ kind: 'attack', outcome: 'miss', avoidedBy: 'core:clone', ageMs: 300 }),
          }),
        ],
      ),
    );
    expect(out.player?.map((o) => o.kind).sort()).toEqual(['dodge', 'interrupted']);
    expect(out.player?.find((o) => o.kind === 'dodge')?.via).toBe('core:clone');
    const old = outcomesOf(scene(player({ last: last({ damage: 3, ageMs: 5000 }) }), [body()]));
    expect(old).toEqual({});
  });
});

describe('the battle log names the body acting', () => {
  it('writes the number of a combat clone on its lines and on the enemy hits aimed at it', () => {
    const line = (id: number, patch: Record<string, unknown>): LogEntry => ({
      id,
      event: {
        type: 'combatLog',
        at: id,
        side: 'player',
        act: 'cast',
        tech: 'core:leaf_whirlwind',
        enemy: 'core:wolf',
        dmg: 0,
        ...patch,
      } as LogEntry['event'],
    });
    const out = html(CombatLog, {
      entries: [
        line(1, { ally: 2, by: 'ally#2' }),
        line(2, { ally: 2, act: 'hit', dmg: 6 }),
        line(3, { ally: 1, act: 'hit', tech: null, dmg: 3 }),
        line(4, { side: 'enemy', act: 'hit', tech: null, ally: 1, dmg: 5 }),
        line(5, { side: 'enemy', act: 'miss', tech: null }),
      ],
    });
    expect(out).toContain('Клон №2');
    expect(out).toContain('Клон №1');
    expect(out).toContain('влучає по клону №1');
    expect(out).toContain('промахується');
    expect(out).not.toContain('Ти готуєш');
  });
});

describe('F1-fix1: the body the player is aiming at', () => {
  const scene = (p: FighterView, enemies: FighterView[]): Scene => ({
    slot: 0,
    phase: 'fight',
    player: p,
    allies: [],
    enemies,
    nowMs: 2000,
  });

  it('is the one the action names while it stands, else the first one standing', () => {
    const dead = body({ key: 'a', alive: false, hp: 0 });
    const b = body({ key: 'b' });
    const c = body({ key: 'c' });
    const aimed = (target: string | null, enemies: FighterView[]) =>
      targetedKey(scene(player({ action: { kind: 'basic', id: null, target } }), enemies));
    expect(aimed('c', [dead, b, c])).toBe('c');
    expect(aimed(null, [dead, b, c])).toBe('b');
    // The named body is down: the engine's pick.
    expect(aimed('a', [dead, b, c])).toBe('b');
    expect(aimed(null, [dead])).toBe('a');
    expect(aimed(null, [])).toBeNull();
  });

  it('marks the target on its card and keeps the pop out of the name (a flex item of the head)', () => {
    const f = body({ key: 'b' });
    const marked = html(Fighter, { f, targeted: true });
    expect(marked).toContain('data-targeted="true"');
    expect(html(Fighter, { f, targeted: false })).toContain('data-targeted="false"');
    // The player and a body that is down carry no mark.
    expect(html(Fighter, { f: player() })).not.toContain('data-targeted');
    const pop = html(Fighter, {
      f,
      outcomes: [
        { key: 'k', kind: 'damage' as const, amount: 7, via: null, statuses: [], combos: [] },
      ],
    });
    const head = pop.slice(pop.indexOf('<header'), pop.indexOf('</header>'));
    expect(head).toContain('data-kind="pop"');
  });
});

/** A genin with the skills and techniques to fight the pack of wolves from the start. */
function fighter(): GameState {
  const state = createState(9, content);
  state.player.name = 'Тест';
  state.player.rank = 'genin';
  for (const skill of Object.keys(state.skills)) {
    const s = state.skills[skill as keyof typeof state.skills];
    if (s) s.xp = xpAt(12);
  }
  for (const t of content.techniques) if (t.rank === 'D') state.known[t.id] = true;
  state.known['core:body_replacement'] = true;
  for (const cell of content.cells) state.world.explores[cell.id] = 9999;
  state.flags['region.forest.unlocked'] = true;
  return state;
}

describe('F1: the scene of a real fight', () => {
  beforeEach(() => {
    game.replaceState(fighter());
  });

  it('is null when nothing is fought', () => {
    expect(buildScene(game.state, game.content, defaultRules)).toBeNull();
  });

  it('shows waiting, casting with seals, a strike and the outcomes as the fight goes on', () => {
    const started = game.dispatch({
      type: 'action.start',
      slot: 0,
      kind: 'fight',
      id: 'core:zone_wolf',
    });
    expect(started).toEqual({ ok: true });
    const seen = new Set<string>();
    let bodies = 0;
    let figures = 0;
    for (let i = 0; i < 400; i++) {
      game.devAdvance(100);
      const scene = buildScene(game.state, game.content, defaultRules);
      if (!scene) break;
      bodies = Math.max(bodies, scene.enemies.length);
      for (const f of [scene.player, ...scene.enemies]) {
        const label = f.heldBy ? 'held' : f.phase === 'act' ? (f.action?.kind ?? 'act') : f.phase;
        seen.add(`${f.side}:${label}`);
        if (f.cast) {
          expect(f.seals.length).toBe(f.cast.phases.count);
          expect(f.timing.fraction).toBeGreaterThanOrEqual(0);
          expect(f.timing.fraction).toBeLessThanOrEqual(1);
        }
      }
      figures += Object.values(outcomesOf(scene)).flat().length;
    }
    expect(bodies).toBeGreaterThan(1);
    expect(seen.has('player:wait')).toBe(true);
    expect(seen.has('player:technique')).toBe(true);
    expect(seen.has('enemy:attack')).toBe(true);
    expect(figures).toBeGreaterThan(0);
  });

  it('renders the arena with the parts a pack can find, and keeps the log collapsed', () => {
    game.dispatch({ type: 'action.start', slot: 0, kind: 'fight', id: 'core:zone_wolf' });
    game.devAdvance(1500);
    expect(fightSlotIndex(game.state)).toBe(0);
    const out = html(CombatPage, {});
    expect(out).toContain('data-ui="fight-arena"');
    expect(out).toContain('data-side="player"');
    expect((out.match(/data-ui="fighter"/g) ?? []).length).toBeGreaterThan(2);
    expect(out).toContain('Зупинити бій');
    expect(out).toMatch(/<details[^>]*data-fight-log/);
    expect(out).not.toMatch(/<details[^>]*open/);
  });
});
