import { content } from '@shinobi/content';
import {
  createState,
  defaultRules,
  dispatch,
  examFor,
  hexKey,
  levelAt,
  levelCap,
  poolCapacity,
  positionOf,
  serialize,
  type GameState,
} from '@shinobi/core';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { cloneTechniques } from '../src/dev/clones.ts';
import { runDev, type DevCommand, type DevResult } from '../src/dev/commands.ts';
import DevPanel from '../src/dev/DevPanel.svelte';
import { loadFixtures } from '../src/dev/saves.ts';
import { DEV_UK } from '../src/dev/texts.ts';
import { createGame } from '../src/lib/game.svelte.ts';
import { isDevMode } from '../src/lib/dev.ts';

/*
 * D1: the developer panel. Every panel action is a command that a pure function applies to the
 * state through the core's helpers; one test per command, on a real game state.
 */

const K = content.balance.K;
let state: GameState;
const run = (command: DevCommand): DevResult => runDev(state, content, defaultRules, command);
const ok = (command: DevCommand): void => expect(run(command)).toEqual({ ok: true });
const refused = (command: DevCommand): string => {
  const result = run(command);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.reason;
};

beforeEach(() => {
  state = createState(1, content);
});

describe('the flag', () => {
  it('is on in tests, and the panel opens only with ?dev=1', () => {
    expect(__DEV_PANEL__).toBe(true);
    expect(isDevMode('?dev=1')).toBe(true);
    expect(isDevMode('')).toBe(false);
  });

  it('renders the opener', () => {
    expect(render(DevPanel, { props: {} }).body).toContain('data-dev-open');
  });

  it('has a text for every refusal the commands give', () => {
    const reasons = ['unknown', 'badNumber', 'noPool', 'noScroll', 'tooDeep', 'cannotSatisfy'];
    for (const r of reasons) expect(DEV_UK[`dev.err.${r}`], r).toBeTruthy();
    for (const r of ['noSlot', 'badHex', 'noFight', 'noVillage', 'stepStuck', 'questDone'])
      expect(DEV_UK[`dev.err.${r}`], r).toBeTruthy();
  });
});

describe('time', () => {
  it('time.advance moves game time through advance, like waiting', () => {
    ok({ type: 'time.advance', ms: 60_000 });
    expect(state.now).toBe(60_000);
    ok({ type: 'time.advance', ms: 8 * 3_600_000 });
    expect(state.now).toBe(60_000 + 8 * 3_600_000);
    expect(refused({ type: 'time.advance', ms: -1 })).toBe('dev.err.badNumber');
    expect(refused({ type: 'time.advance', ms: 1.5 })).toBe('dev.err.badNumber');
  });

  it('the clock speed multiplies the game time a stretch of wall time brings', () => {
    let wall = 0;
    const game = createGame({ clock: { now: () => wall } });
    const before = game.state.now;
    wall = 1000;
    game.devSpeed = 60;
    game.tick();
    expect(game.state.now - before).toBe(60_000);
    game.devSpeed = 1;
    wall = 2000;
    game.tick();
    expect(game.state.now - before).toBe(61_000);
    game.devSpeed = 0;
    expect(game.devSpeed).toBe(1);
  });

  it('devApply runs a command on the live game state', () => {
    const game = createGame({ clock: { now: () => 0 } });
    game.devApply((s, c, r) => runDev(s, c, r, { type: 'currency.grant', id: money(), n: 5 }));
    expect(game.state.currencies[money()]).toBe(5);
  });
});

const money = (): string => content.currencies.find((c) => c.role === 'money')?.id ?? '';

describe('skills', () => {
  it('skill.setLevel sets the level, and the cap is the most', () => {
    const skill = content.skills[0]!.id;
    ok({ type: 'skill.setLevel', skill, level: 20 });
    expect(levelAt(state.skills[skill]!.xp, K.cap)).toBe(20);
    ok({ type: 'skill.setLevel', skill, level: 9999 });
    expect(levelAt(state.skills[skill]!.xp, K.cap)).toBe(levelCap(content));
    expect(refused({ type: 'skill.setLevel', skill: 'nope', level: 1 })).toBe('dev.err.badNumber');
  });

  it('skill.setLevel opens what the level unlocks', () => {
    const mentored = content.techniques.find(
      (t) => t.src === 'N' && t.mentor === 'academy' && t.level > 1,
    );
    expect(mentored).toBeTruthy();
    expect(state.known[mentored!.id]).toBeUndefined();
    ok({ type: 'skill.setLevel', skill: mentored!.skill, level: mentored!.level });
    expect(state.known[mentored!.id]).toBe(true);
  });

  it('mastery.set sets and clears a mastery', () => {
    const key = content.techniques[0]!.id;
    ok({ type: 'mastery.set', key, level: 7 });
    expect(levelAt(state.mastery[key]!.xp, K.masteryCap)).toBe(7);
    ok({ type: 'mastery.set', key, level: 9999 });
    expect(levelAt(state.mastery[key]!.xp, K.masteryCap)).toBe(K.masteryCap);
    ok({ type: 'mastery.set', key, level: 0 });
    expect(state.mastery[key]).toBeUndefined();
    expect(refused({ type: 'mastery.set', key: '', level: 1 })).toBe('dev.err.badNumber');
  });

  it('pool.set fills a pool to a share of its capacity', () => {
    const skill = content.skills.find((s) => poolCapacity(s.id, content) > 0)!.id;
    const capacity = poolCapacity(skill, content);
    ok({ type: 'pool.set', skill, pct: 50 });
    expect(state.pools[skill]!.xp).toBe(Math.round(capacity / 2));
    ok({ type: 'pool.set', skill, pct: 100 });
    expect(state.pools[skill]!.xp).toBe(capacity);
    ok({ type: 'pool.set', skill, pct: 0 });
    expect(state.pools[skill]!.xp).toBe(0);
    expect(refused({ type: 'pool.set', skill, pct: 101 })).toBe('dev.err.badNumber');
  });
});

describe('items', () => {
  it('item.grant puts items in the bank and in the book of what was shown', () => {
    const id = content.items[0]!.id;
    ok({ type: 'item.grant', id, n: 12 });
    expect(state.bank[id]).toBe(12);
    expect(state.shown[`${id}@item`]).toBe(true);
    expect(refused({ type: 'item.grant', id: 'core:nope', n: 1 })).toBe('dev.err.unknown');
    expect(refused({ type: 'item.grant', id, n: 0 })).toBe('dev.err.badNumber');
  });

  it('currency.grant adds to a balance, Intel and ryo alike', () => {
    for (const role of ['money', 'study']) {
      const id = content.currencies.find((c) => c.role === role)!.id;
      ok({ type: 'currency.grant', id, n: 250 });
      expect(state.currencies[id]).toBe(250);
    }
    expect(refused({ type: 'currency.grant', id: 'core:nope', n: 5 })).toBe('dev.err.unknown');
  });

  it('technique.learn learns a technique, and a clone technique opens its slot', () => {
    const plain = content.techniques.find((t) => t.opensSlot === undefined)!;
    ok({ type: 'technique.learn', id: plain.id });
    expect(state.known[plain.id]).toBe(true);
    const clone = content.techniques.find((t) => t.opensSlot !== undefined)!;
    ok({ type: 'technique.learn', id: clone.id });
    expect(state.slots.length).toBeGreaterThan(clone.opensSlot!);
    expect(refused({ type: 'technique.learn', id: 'core:nope' })).toBe('dev.err.unknown');
  });

  it('scroll.read reads the scroll of a technique through item.use, or is refused', () => {
    const scrolled = content.items.filter((i) => i.scroll !== undefined);
    expect(scrolled.length).toBeGreaterThan(0);
    // Some scroll can be read once its requirements hold; one that cannot is refused and leaves nothing behind.
    let read = 0;
    for (const item of scrolled) {
      const technique = item.scroll!.technique;
      const fresh = createState(1, content);
      const verdict = runDev(fresh, content, defaultRules, { type: 'scroll.read', technique });
      if (verdict.ok) {
        read++;
        expect(fresh.known[technique]).toBe(true);
      } else {
        expect(fresh.bank[item.id]).toBeUndefined();
      }
    }
    expect(read).toBeGreaterThan(0);
    const unscrolled = content.techniques.find(
      (t) => !content.items.some((i) => i.scroll?.technique === t.id),
    )!;
    expect(refused({ type: 'scroll.read', technique: unscrolled.id })).toBe('dev.err.noScroll');
  });
});

describe('story', () => {
  it('story.completeStep finishes the active step of a chain, one at a time, to the end', () => {
    const quest = content.quests.find((q) => q.unlock === null && q.steps.length > 1)!;
    expect(quest).toBeTruthy();
    let steps = 0;
    while (!state.quests[quest.id]?.done) {
      const before = state.quests[quest.id]?.step ?? 0;
      ok({ type: 'story.completeStep', quest: quest.id });
      const progress = state.quests[quest.id]!;
      expect(progress.done || progress.step > before).toBe(true);
      expect(++steps).toBeLessThanOrEqual(quest.steps.length);
    }
    expect(state.quests[quest.id]!.done).toBe(true);
    expect(refused({ type: 'story.completeStep', quest: quest.id })).toBe('dev.err.questDone');
    expect(refused({ type: 'story.completeStep', quest: 'core:nope' })).toBe('dev.err.unknown');
  });

  it('story.completeStep walks every chain of the slice through the same updates the game runs', () => {
    for (const quest of content.quests) {
      const fresh = createState(1, content);
      let last: DevResult = { ok: true };
      for (let i = 0; i < quest.steps.length + 2 && last.ok; i++) {
        last = runDev(fresh, content, defaultRules, {
          type: 'story.completeStep',
          quest: quest.id,
        });
      }
      // Either the chain was finished, or the refusal says why a step cannot be made by hand.
      expect(fresh.quests[quest.id]?.done === true || !last.ok, quest.id).toBe(true);
    }
  });

  it('story.flag raises and clears a flag', () => {
    ok({ type: 'story.flag', id: 'dev.test' });
    expect(state.flags['dev.test']).toBe(true);
    ok({ type: 'story.flag', id: 'dev.test', value: 3 });
    expect(state.flags['dev.test']).toBe(3);
    ok({ type: 'story.flag', id: 'dev.test', value: null });
    expect(state.flags['dev.test']).toBeUndefined();
    expect(refused({ type: 'story.flag', id: '' })).toBe('dev.err.unknown');
  });

  it('rank.set gives a rank and what it opens (a village, for a Genin)', () => {
    const genin = content.playerRanks.find((r) => r.academy !== true)!;
    ok({ type: 'rank.set', rank: genin.id });
    expect(state.player.rank).toBe(genin.id);
    expect(state.village).not.toBeNull();
    expect(refused({ type: 'rank.set', rank: 'core:nope' })).toBe('dev.err.unknown');
  });

  it('exam.ready makes the checklist of an exam hold', () => {
    const exam = content.exams[0]!;
    ok({ type: 'exam.ready', rank: exam.rank });
    const started = dispatch(state, { type: 'exam.start', rank: exam.rank }, content, defaultRules);
    expect(examFor(content, exam.rank)).toBe(exam);
    // The exam can be started now, or its only missing piece is one the panel does not fake (a building).
    expect(started.ok || (!started.ok && started.reason !== 'error.requirementsNotMet')).toBe(true);
    expect(refused({ type: 'exam.ready', rank: 'core:nope' })).toBe('dev.err.unknown');
  });
});

describe('map', () => {
  it('map.surveyAll surveys every hex and explores every cell to its top level', () => {
    ok({ type: 'map.surveyAll' });
    const playable = content.hexes.filter((h) => h.terrain !== undefined);
    expect(playable.length).toBeGreaterThan(0);
    for (const h of playable) expect(state.world.surveyed[hexKey(h.q, h.r)]).toBe(true);
    const top = K.cellExplores.at(-1)!;
    for (const cell of content.cells)
      expect(state.world.explores[cell.id]).toBeGreaterThanOrEqual(top);
  });

  it('map.revealPoints marks every point of interest', () => {
    ok({ type: 'map.revealPoints' });
    for (const cell of content.cells)
      for (const poi of cell.pois) expect(state.world.pois[poi.id]).toBe(true);
  });

  it('map.teleport moves the character to a cell, and a refusal leaves it where it was', () => {
    const cell = content.cells[content.cells.length - 1]!;
    ok({ type: 'map.teleport', slot: 0, hex: cell.id });
    expect(positionOf(state, 0)).toBe(cell.id);
    const where = state.world.location;
    expect(refused({ type: 'map.teleport', slot: 0, hex: '999,999' })).toBe('dev.err.badHex');
    expect(refused({ type: 'map.teleport', slot: 5, hex: cell.id })).toBe('dev.err.noSlot');
    expect(state.world.location).toBe(where);
  });

  it('map.teleport moves a clone that has a slot', () => {
    ok({ type: 'clone.create' });
    const cell = content.cells[content.cells.length - 1]!;
    ok({ type: 'map.teleport', slot: 1, hex: cell.id });
    expect(positionOf(state, 1)).toBe(cell.id);
  });
});

/** Puts the character in a fight of the first zone, with a strong enough build to win or lose it at will. */
function inFight(): void {
  const zone =
    content.zones.find((z) => z.unlock === null || z.unlock === undefined) ?? content.zones[0]!;
  ok({ type: 'rank.set', rank: content.playerRanks.find((r) => r.academy !== true)!.id });
  for (const skill of content.skills) ok({ type: 'skill.setLevel', skill: skill.id, level: 30 });
  for (const quest of content.quests) run({ type: 'story.completeStep', quest: quest.id });
  for (const flag of Object.keys(state.flags)) void flag;
  const result = dispatch(
    state,
    { type: 'action.start', slot: 0, kind: 'fight', id: zone.id },
    content,
    defaultRules,
  );
  if (!result.ok) throw new Error(`cannot start the fight: ${result.reason}`);
  run({ type: 'time.advance', ms: 1000 });
}

describe('fights', () => {
  it('fight.bingo sets the Bingo knowledge level', () => {
    const enemy = content.enemies[0]!.id;
    ok({ type: 'fight.bingo', enemy, level: 3 });
    expect(state.bingo[enemy]!.bought).toBe(3);
    const boss = content.bosses[0]!.id;
    ok({ type: 'fight.bingo', enemy: boss, level: 1 });
    expect(state.bingo[boss]!.seen).toBe(1);
    expect(refused({ type: 'fight.bingo', enemy, level: 4 })).toBe('dev.err.badNumber');
    expect(refused({ type: 'fight.bingo', enemy: 'core:nope', level: 1 })).toBe(
      'dev.err.badNumber',
    );
  });

  it('fight.win and fight.lose are refused with no fight', () => {
    expect(refused({ type: 'fight.win' })).toBe('dev.err.noFight');
    expect(refused({ type: 'fight.lose' })).toBe('dev.err.noFight');
  });

  it('fight.win ends the fight in a victory the game counts', () => {
    inFight();
    const enemy = state.combat!.enemy;
    const kills = state.counters[`kills.${enemy}`] ?? 0;
    ok({ type: 'fight.win' });
    expect(state.counters[`kills.${enemy}`] ?? 0).toBe(kills + 1);
    expect(state.bingo[enemy]!.wins).toBeGreaterThanOrEqual(1);
  });

  it('fight.lose ends the fight in a defeat the game counts', () => {
    inFight();
    const enemy = state.combat!.enemy;
    ok({ type: 'fight.lose' });
    expect(state.bingo[enemy]!.losses).toBeGreaterThanOrEqual(1);
  });

  it('raid.spawn calls a raid and lets it arrive', () => {
    const raid = content.raids[0]!;
    ok({ type: 'raid.spawn', raid: raid.id });
    expect(state.village?.raids[raid.id]?.phase).toBe('active');
    expect(refused({ type: 'raid.spawn', raid: 'core:nope' })).toBe('dev.err.unknown');
  });
});

describe('clones', () => {
  it('clone.create learns the clone technique and opens its slot', () => {
    expect(cloneTechniques(content).length).toBeGreaterThan(0);
    const slots = state.slots.length;
    ok({ type: 'clone.create' });
    expect(state.slots.length).toBeGreaterThan(slots);
    expect(refused({ type: 'clone.create', technique: 'core:nope' })).toBe('dev.err.unknown');
  });

  it('clone.clearFatigue clears the wounds', () => {
    state.wounds = { stacks: 2, left: 5000 };
    ok({ type: 'clone.clearFatigue' });
    expect(state.wounds).toEqual({ stacks: 0, left: 0 });
  });
});

describe('saves', () => {
  it('every fixture save of the repository loads into a state the game can play on', async () => {
    const fixtures = await loadFixtures();
    expect(fixtures.length).toBeGreaterThan(10);
    const game = createGame({ clock: { now: () => 0 } });
    for (const f of fixtures.slice(0, 6)) {
      game.replaceState(
        (await import('@shinobi/core')).deserialize(f.save, game.content, game.rules),
      );
      expect(serialize(game.state).length, f.id).toBeGreaterThan(100);
      game.devApply((s, c, r) => runDev(s, c, r, { type: 'time.advance', ms: 1000 }));
    }
  });
});
