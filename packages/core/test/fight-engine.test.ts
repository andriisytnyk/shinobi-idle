/** A2, A3, A4, A8, A9 and the game integration of the fight engine. */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { content, type SkillId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  SHARE_FULL,
  STATE_VERSION,
  WORK_PER_MS,
  advance,
  createFight,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  fightAdvance,
  fightNextEventIn,
  fightOutcome,
  refreshUnlocks,
  serialize,
  simulateFights,
  snapshotPlayer,
  type GameState,
} from '../src/index.ts';
import { K, enemyAt, pacify, playerFor, rules, sec, withAi } from './fight-helpers.ts';
import { genin, setLevel } from './helpers.ts';

// ---------- A3: independence from the game state ----------

describe('A3: the fight engine does not know the game', () => {
  const dir = fileURLToPath(new URL('../src/combat/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.startsWith('fight') && f.endsWith('.ts'));
  const importsOf = (text: string): string[] =>
    [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');

  it('has fight files to check', () => {
    expect(files).toEqual(
      expect.arrayContaining(['fight.ts', 'fight-ai.ts', 'fight-effects.ts', 'fight-sim.ts']),
    );
  });

  it('imports only content, the rng, its own files and pure numbers', () => {
    const allowed =
      /^(@shinobi\/content|\.\.\/rng\.ts|\.\/fight[\w-]*\.ts|\.\/numbers\.ts|\.\/units\.ts)$/;
    for (const file of files) {
      for (const from of importsOf(readFileSync(dir + file, 'utf8'))) {
        expect(from, `${file} imports ${from}`).toMatch(allowed);
      }
    }
  });

  it('keeps the shared number files free of game state too', () => {
    for (const file of ['numbers.ts', 'units.ts']) {
      for (const from of importsOf(readFileSync(dir + file, 'utf8'))) {
        expect(from, `${file} imports ${from}`).toMatch(/^(@shinobi\/content|\.\.\/formulas\.ts)$/);
      }
    }
  });

  it('keeps the work-unit scale equal to the slot share scale', () => {
    expect(WORK_PER_MS).toBe(SHARE_FULL);
  });

  function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
  }

  it('simulates on frozen inputs, leaves them alone, and repeats exactly for one seed', () => {
    const frozenContent = deepFreeze(structuredClone(content));
    const snapshot = deepFreeze(playerFor(34, 'katon'));
    const before = JSON.stringify([snapshot, frozenContent]);
    const enemy = deepFreeze(enemyAt(34, ['evasive']));
    const a = simulateFights(snapshot, enemy, 60, 99, frozenContent, defaultRules);
    const b = simulateFights(snapshot, enemy, 60, 99, frozenContent, defaultRules);
    expect(b).toEqual(a);
    expect(JSON.stringify([snapshot, frozenContent])).toBe(before);
    const other = simulateFights(snapshot, enemy, 60, 100, frozenContent, defaultRules);
    expect(other).not.toEqual(a);
    expect(a.wins).toBeGreaterThan(0);
  });

  it('does not touch a game state that exists beside it', () => {
    const state = genin(5);
    const saved = serialize(state, 0);
    simulateFights(
      snapshotPlayer(state, content, defaultRules),
      enemyAt(10),
      20,
      3,
      content,
      defaultRules,
    );
    expect(serialize(state, 0)).toBe(saved);
  });
});

// ---------- A4: speed ----------

describe('A4: performance', () => {
  it('simulates 1000 at-level fights in under 1500 ms', () => {
    const snap = playerFor(30, 'katon');
    const enemy = enemyAt(30);
    simulateFights(snap, enemy, 50, 1, content, defaultRules);
    const start = performance.now();
    const summary = simulateFights(snap, enemy, 1000, 2, content, defaultRules);
    const ms = performance.now() - start;
    console.log(`A4: 1000 fights in ${ms.toFixed(0)} ms, win rate ${summary.winRate}`);
    expect(ms).toBeLessThan(1500);
  });
});

// ---------- A8: statistical sanity ----------

describe('A8: statistical sanity with simulateFights', () => {
  const N = 400;

  for (const level of [10, 20, 30, 40]) {
    it(`beats a plain level-${level} enemy at least 95% of the time in 10-45 s`, () => {
      const r = simulateFights(
        playerFor(level, 'katon'),
        enemyAt(level),
        N,
        7,
        content,
        defaultRules,
      );
      console.log(
        `A8 plain L${level}: win ${(r.winRate * 100).toFixed(1)}%, mean ${(r.timeMs.mean / 1000).toFixed(1)} s, hp lost ${(r.hpLost.share * 100).toFixed(0)}%`,
      );
      expect(r.winRate).toBeGreaterThanOrEqual(0.95);
      expect(r.timeMs.mean / 1000).toBeGreaterThanOrEqual(10);
      expect(r.timeMs.mean / 1000).toBeLessThanOrEqual(45);
    });
  }

  const cases = [
    { trait: 'evasive', nature: 'doton', answer: (t: readonly string[]) => t.includes('bind') },
    {
      trait: 'regen',
      nature: 'katon',
      answer: (t: readonly string[], s: string | null) => t.includes('dot') || s === 'burn',
    },
    { trait: 'hidden', nature: 'futon', answer: (t: readonly string[]) => t.includes('reveal') },
  ] as const;

  for (const { trait, nature, answer } of cases) {
    it(`wins a level-34 ${trait} fight at least 15% faster with the answer`, () => {
      const enemy = enemyAt(34, [trait]);
      const withAnswer = simulateFights(playerFor(34, nature), enemy, N, 7, content, defaultRules);
      const without = simulateFights(
        playerFor(34, nature, { without: answer }),
        enemy,
        N,
        7,
        content,
        defaultRules,
      );
      const line = (r: typeof withAnswer) =>
        `win ${(r.winRate * 100).toFixed(1)}%, mean ${(r.timeMs.mean / 1000).toFixed(1)} s, hp lost ${(r.hpLost.share * 100).toFixed(0)}%`;
      console.log(`A8 ${trait}: with answer ${line(withAnswer)}; without ${line(without)}`);
      expect(withAnswer.timeMs.mean).toBeLessThanOrEqual(without.timeMs.mean * 0.85);
    });
  }
});

// ---------- A9: plain JSON ----------

describe('A9: state is plain JSON and round-trips through a save', () => {
  function fighting(seed: number, enemy: string): GameState {
    const state = genin(seed);
    for (const skill of [
      'tai',
      'nin',
      'katon',
      'futon',
      'raiton',
      'vit',
      'eva',
      'med',
    ] as SkillId[]) {
      setLevel(state, skill, 36);
    }
    refreshUnlocks(state, content, true);
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id: enemy }, content);
    return state;
  }

  it('FightState survives JSON unchanged', () => {
    const fight = createFight(
      playerFor(34, 'katon'),
      enemyAt(34, ['caster', 'regen']),
      5,
      content,
      rules,
    );
    fightAdvance(fight, sec(20), content, rules);
    expect(JSON.parse(JSON.stringify(fight))).toEqual(fight);
    expect(fight.t).toBeGreaterThan(0);
  });

  for (const enemy of ['core:wolf', 'core:kumo', 'core:dummy']) {
    it(`state.combat survives a save against ${enemy}, in the middle of a fight and after a win`, () => {
      const state = fighting(8, enemy);
      for (const ms of [3333, 9000, 40_000]) {
        advance(state, ms, content);
        const combat = state.combat;
        expect(JSON.parse(JSON.stringify(combat))).toEqual(combat);
        const text = serialize(state, 0);
        const loaded = deserialize(text, content);
        expect(serialize(loaded, 0)).toBe(text);
        expect(loaded.combat).toEqual(state.combat);
      }
    });
  }

  it('a loaded fight goes on exactly as the original does', () => {
    const state = fighting(9, 'core:wolf');
    advance(state, 20_000, content);
    const loaded = deserialize(serialize(state, 0), content);
    advance(state, 60_000, content);
    advance(loaded, 60_000, content);
    expect(serialize(loaded, 0)).toBe(serialize(state, 0));
  });

  it('migrates a version 4 save: the fight in progress simply starts over', () => {
    const state = fighting(10, 'core:dummy');
    const raw = JSON.parse(serialize(state, 0)) as { v: number; state: Record<string, unknown> };
    raw.v = 4;
    raw.state.v = 4;
    raw.state.combat = {
      enemy: 'core:dummy',
      phase: 'fight',
      clock: 1000,
      enemyHp: 5,
      hp: 50,
      chakra: 5,
      stamina: 5,
      pPhase: 'ready',
      pAt: 0,
      cast: null,
      eAt: 100,
      respawnAt: 0,
      regenAt: 1000,
      cd: {},
      style: 'tai',
      lastActionAt: 0,
      fx: { player: [], enemy: [] },
    };
    expect(STATE_VERSION).toBe(7);
    expect(MIGRATIONS).toHaveLength(STATE_VERSION - 1);
    const loaded = deserialize(JSON.stringify(raw), content);
    expect(loaded.v).toBe(STATE_VERSION);
    expect(loaded.combat?.enemy).toBe('core:dummy');
    expect(loaded.combat?.fight.t).toBe(0);
    advance(loaded, 10_000, content);
    expect(loaded.combat?.fight.t).toBeGreaterThan(0);
  });
});

// ---------- A2: determinism and split-invariance with fights running ----------

describe('A2: split invariance with fights running', () => {
  const total = 90_000;

  function run(enemy: string, slots: number, at: number, chunk: number, seed = 21): string {
    const state = genin(seed);
    for (const skill of [
      'tai',
      'nin',
      'katon',
      'futon',
      'raiton',
      'doton',
      'suiton',
      'vit',
      'eva',
      'med',
      'ath',
      'cc',
    ] as SkillId[]) {
      setLevel(state, skill, 38);
    }
    refreshUnlocks(state, content, true);
    while (state.slots.length < slots) {
      state.slots.push({ action: null, progress: 0, share: 0, data: null });
    }
    for (let i = 0; i < slots; i++) {
      const start =
        i === at
          ? ({ type: 'action.start', slot: i, kind: 'fight', id: enemy } as const)
          : ({ type: 'action.start', slot: i, kind: 'drill', id: 'core:lystok_na_lobi' } as const);
      expect(dispatch(state, start, content)).toEqual({ ok: true });
    }
    expect(state.slots[at]?.share).toBeGreaterThan(0);
    for (let t = 0; t < total; t += chunk) advance(state, Math.min(chunk, total - t), content);
    return serialize(state, 0);
  }

  for (const enemy of ['core:wolf', 'core:kumo']) {
    for (const [slots, at] of [
      [1, 0],
      [2, 0],
      [3, 1],
    ] as const) {
      it(`gives byte-identical saves for any chunking: ${enemy}, ${slots} slot(s)`, () => {
        const whole = run(enemy, slots, at, total);
        for (const chunk of [1, 7, 999, 3600]) expect(run(enemy, slots, at, chunk)).toBe(whole);
        const loaded = deserialize(whole, content);
        expect(loaded.combat?.fight.t).toBeGreaterThan(0);
        expect(loaded.counters[`kills.${enemy}`] ?? 0).toBeGreaterThanOrEqual(0);
      });
    }
  }

  it('shares: the fight gets a third of the speed in the third case', () => {
    const state = genin(1);
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
    state.slots.push({ action: null, progress: 0, share: 0, data: null });
    for (let i = 0; i < 3; i++) {
      dispatch(
        state,
        {
          type: 'action.start',
          slot: i,
          kind: i === 1 ? 'fight' : 'drill',
          id: i === 1 ? 'core:dummy' : 'core:lystok_na_lobi',
        },
        content,
      );
    }
    expect(state.slots[1]?.share).toBe(333);
  });

  it('is deterministic for a seed and differs for another', () => {
    expect(run('core:wolf', 1, 0, 1000, 21)).toBe(run('core:wolf', 1, 0, 1000, 21));
    expect(run('core:wolf', 1, 0, 1000, 21)).not.toBe(run('core:wolf', 1, 0, 1000, 22));
  });
});

// ---------- the game around the fight ----------

describe('the fight action wraps the fight engine', () => {
  function strong(seed: number): GameState {
    const state = genin(seed);
    for (const skill of ['tai', 'nin', 'katon', 'vit', 'eva', 'med', 'ath'] as SkillId[]) {
      setLevel(state, skill, 30);
    }
    refreshUnlocks(state, content, true);
    return state;
  }
  const start = (state: GameState, id: string) =>
    dispatch(state, { type: 'action.start', slot: 0, kind: 'fight', id }, content);

  it('counts one kill per won encounter, also against a pack', () => {
    const state = strong(2);
    start(state, 'core:wolf');
    advance(state, 5 * 60_000, content);
    const kills = state.counters['kills.core:wolf'] ?? 0;
    expect(kills).toBeGreaterThan(3);
    expect(state.events.filter((e) => e.type === 'enemyDefeated')).toHaveLength(kills);
  });

  it('restores health, chakra and stamina between fights and starts the next fight fresh', () => {
    const state = strong(3);
    start(state, 'core:dummy');
    let seen = 0;
    for (let i = 0; i < 4000 && seen < 3; i++) {
      advance(state, 250, content);
      const c = state.combat;
      if (c?.phase !== 'respawn') continue;
      seen++;
      const p = c.fight.player;
      expect(p.chakra).toBe(p.maxChakra);
      expect(p.stamina).toBe(p.maxStamina);
      expect(p.hp).toBeGreaterThan(0);
      // Wait the pause out: a new fight begins with nothing habituated and the carried health.
      const carried = p.hp;
      advance(state, Math.ceil(c.pause / SHARE_FULL) + 1, content);
      expect(state.combat?.phase).toBe('fight');
      expect(state.combat?.fight.uses).toEqual({});
      expect(state.combat?.fight.player.hp).toBeLessThanOrEqual(carried + 100);
    }
    expect(seen).toBe(3);
  });

  it('pays mastery for the techniques that were cast, and combat XP by the tick', () => {
    const state = strong(4);
    start(state, 'core:bandit');
    advance(state, 120_000, content);
    expect(Object.keys(state.mastery).length).toBeGreaterThan(0);
    expect(state.counters['actions.fight']).toBeGreaterThan(100);
  });

  it('uses the rule set AI: a rule set that only attacks casts nothing', () => {
    const state = strong(5);
    const basicOnly = withAi(() => ({ type: 'basic' }), defaultRules);
    dispatch(
      state,
      { type: 'action.start', slot: 0, kind: 'fight', id: 'core:dummy' },
      content,
      basicOnly,
    );
    advance(state, 40_000, content, basicOnly);
    expect(Object.keys(state.mastery)).toEqual([]);
    expect(state.combat?.fight.tally.basic ?? 0).toBeGreaterThan(0);
  });

  it('draws only from the combat stream and only when a fight begins', () => {
    const state = strong(6);
    const others = JSON.stringify([state.rng.action, state.rng.loot, state.rng.world]);
    start(state, 'core:dummy');
    advance(state, 60_000, content);
    expect(JSON.stringify([state.rng.action, state.rng.loot, state.rng.world])).toBe(others);
  });

  it('stops with a defeat when the player falls', () => {
    const state = createState(7, content);
    const boss = content.enemies.reduce((a, b) => (a.cl > b.cl ? a : b));
    start(state, boss.id);
    advance(state, 10 * 60_000, content);
    expect(state.events.some((e) => e.type === 'playerDefeated')).toBe(true);
    expect(state.combat).toBeNull();
    expect(state.slots[0]?.action).toBeNull();
  });
});

describe('fight engine basics', () => {
  it('reports its next event, and none once decided', () => {
    const fight = createFight(playerFor(34, 'katon'), enemyAt(34), 1, content, rules);
    expect(fightNextEventIn(fight, content, rules)).toBe(0);
    fightAdvance(fight, 0, content, rules);
    expect(fightNextEventIn(fight, content, rules)).toBeGreaterThan(0);
    fightAdvance(fight, sec(K.combat.fightCapMs / 1000), content, rules);
    expect(fightOutcome(fight)).not.toBe('ongoing');
    expect(fightNextEventIn(fight, content, rules)).toBeNull();
    const left = fightAdvance(fight, 12345, content, rules);
    expect(left).toBe(12345);
  });

  it('wakes for an effect to end and for a periodic effect to tick', () => {
    const fight = createFight(playerFor(34, 'katon'), enemyAt(34), 1, content, rules);
    pacify(fight);
    fightAdvance(fight, 0, content, rules);
    const quietNext = fightNextEventIn(fight, content, rules) ?? 0;
    expect(quietNext).toBeGreaterThanOrEqual(sec(0.4));
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    enemy.effects.push({
      kind: 'modifier',
      id: 'm',
      src: 'test',
      until: fight.t + sec(0.37),
      stat: 'evasion',
      op: 'mul',
      value: 2,
    });
    expect(fightNextEventIn(fight, content, rules)).toBe(sec(0.37));
    enemy.effects.push({
      kind: 'periodic',
      id: 'p',
      src: 'test',
      until: null,
      mode: 'heal',
      amount: 1,
      every: sec(1),
      next: fight.t + sec(0.21),
    });
    expect(fightNextEventIn(fight, content, rules)).toBe(sec(0.21));
    fightAdvance(fight, sec(0.37), content, rules);
    expect(enemy.effects.some((e) => e.id === 'm')).toBe(false);
    expect(enemy.effects.some((e) => e.id === 'p')).toBe(true);
  });

  it('gives the same fight for any split of the same work', () => {
    const run = (chunk: number) => {
      const fight = createFight(
        playerFor(34, 'doton'),
        enemyAt(34, ['evasive', 'pack']),
        4,
        content,
        rules,
      );
      for (let done = 0; done < sec(40); done += chunk)
        fightAdvance(fight, Math.min(chunk, sec(40) - done), content, rules);
      return JSON.stringify(fight);
    };
    const whole = run(sec(40));
    for (const chunk of [777, 123_457, sec(1)]) expect(run(chunk)).toBe(whole);
  });
});
