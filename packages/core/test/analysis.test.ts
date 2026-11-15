/** A6, A7 and A10: battle analysis, the first fight and the session forecast against the game itself. */
import { content } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  advance,
  analyzeFight,
  compareLoadouts,
  defaultRules,
  serialize,
  unlockBoss,
  type Analysis,
  type AnalysisTarget,
  type GameState,
} from '../src/index.ts';
import { K } from './fight-helpers.ts';
import { setLevel } from './helpers.ts';
import { wellStocked } from './prep-helpers.ts';
import {
  fighter,
  ids,
  know,
  run,
  startFight,
  startOperation,
  stock,
  unlock,
} from './prep-state.ts';

/** Units of every pouch good the player keeps in the bank. */
const RESTOCK = 5000;
/** A zone analysis must stay well under a second. */
const ZONE_BUDGET_MS = 1000;
const STEP = 1000;

interface Scene {
  name: string;
  target: AnalysisTarget;
  /** The key of the battle report, and the counter that counts a win. */
  key: string;
  level: number;
  /** The goods the player keeps in stock. */
  bank: Record<string, number>;
  /** Enemy whose Bingo entry is made known. */
  knows?: string[];
  prepare: (state: GameState) => void;
}

const analyze = (state: GameState, target: AnalysisTarget, opts = {}): Analysis => {
  const result = analyzeFight(state, target, opts, content, defaultRules);
  if (!result) throw new Error('no analysis');
  return result;
};

function setup(scene: Scene, seed: number): GameState {
  const state = fighter(seed, scene.level, 'katon');
  setLevel(state, 'futon', scene.level);
  setLevel(state, 'raiton', scene.level);
  for (const id of scene.knows ?? []) know(state, id);
  stock(state, scene.bank);
  scene.prepare(state);
  return state;
}

/**
 * Plays the target the way the analysis does, but as the real game: for the session length of the
 * balance object, restarting it after every defeat, with Wounds, the pouch and the levels as they
 * come. Nothing is held fixed or restocked.
 */
function play(state: GameState, scene: Scene): { wins: number; fights: number; perHour: number } {
  const start = () => {
    const result =
      scene.target.kind === 'operation'
        ? startOperation(state, scene.target.id)
        : startFight(state, scene.target.id);
    if (!result.ok) throw new Error(`cannot start ${scene.target.id}: ${result.reason}`);
  };
  start();
  const win = scene.target.kind === 'operation' ? 'operationCleared' : 'enemyDefeated';
  let wins = 0;
  let fights = 0;
  for (let t = 0; t < K.analysis.sessionMinutes * 60_000; t += STEP) {
    advance(state, STEP, content);
    for (const e of state.events) {
      if (e.type === win) {
        wins++;
        fights++;
      } else if (e.type === 'playerDefeated') fights++;
    }
    state.events = [];
    if (!state.slots[0]?.action) start();
  }
  if (scene.target.kind !== 'operation') fights += state.report[scene.key]?.timeouts ?? 0;
  return { wins, fights, perHour: (wins * 60) / K.analysis.sessionMinutes };
}

const scenes: Scene[] = [
  {
    name: 'a plain zone (masked wolf)',
    target: { kind: 'zone', id: 'core:zone_wolfmask' },
    key: 'core:zone_wolfmask',
    level: 2,
    bank: { [ids.heal]: RESTOCK },
    prepare: (s) => run(s, { type: 'loadout.prepare', encounter: 'core:zone_wolfmask' }),
  },
  {
    name: 'an Evasive zone (marauder)',
    target: { kind: 'zone', id: 'core:zone_marauder' },
    key: 'core:zone_marauder',
    level: 9,
    bank: { [ids.heal]: RESTOCK },
    knows: ['core:marauder'],
    prepare: (s) => run(s, { type: 'loadout.prepare', encounter: 'core:zone_marauder' }),
  },
  {
    name: 'a hidden-trait zone (Mist hunter)',
    target: { kind: 'zone', id: 'core:zone_kiri_hunter' },
    key: 'core:zone_kiri_hunter',
    level: 17,
    bank: { [ids.heal]: RESTOCK },
    knows: ['core:kiri_hunter'],
    prepare: (s) => run(s, { type: 'loadout.prepare', encounter: 'core:zone_kiri_hunter' }),
  },
  ...[44, 50].map((level): Scene => ({
    name: `the hunter boss at level ${level}`,
    target: { kind: 'boss', id: 'core:zone_boss_hunter' },
    key: 'core:zone_boss_hunter',
    level,
    bank: { [ids.heal]: RESTOCK },
    knows: ['core:boss_hunter'],
    prepare: (s) => {
      unlockBoss(s, 'core:boss_hunter', content);
      run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_hunter' });
    },
  })),
  {
    name: 'the hideout operation',
    target: { kind: 'operation', id: 'core:op_hideout' },
    key: 'core:op_hideout',
    level: 50,
    bank: Object.fromEntries(Object.keys(wellStocked(50)).map((id) => [id, RESTOCK])),
    knows: ['core:guard_pack', 'core:boss_twins', 'core:boss_mist'],
    prepare: (s) => {
      unlock(s, 'op.hideout.unlocked');
      run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_twins' });
    },
  },
];

describe('A6: the session forecast against the same session played', () => {
  /** Games played per scene and pooled: one session of a rare outcome is too noisy to judge a rate. */
  const GAMES = 8;
  for (const [i, scene] of scenes.entries()) {
    it(`forecasts ${scene.name}, Wounds and all`, () => {
      const state = setup(scene, 20 + i);
      const before = serialize(state, 0);
      const a = analyze(state, scene.target);
      expect(serialize(state, 0), 'the analysis changes nothing').toBe(before);
      const session = a.session;
      if (!session) throw new Error('no session');
      const games = Array.from({ length: GAMES }, (_, g) =>
        play(setup(scene, 100 + 10 * i + g), scene),
      );
      const wins = games.reduce((n, g) => n + g.wins, 0);
      const fights = games.reduce((n, g) => n + g.fights, 0);
      const perHour = games.reduce((n, g) => n + g.perHour, 0) / GAMES;
      const actual = fights === 0 ? 0 : wins / fights;
      console.log(
        `${scene.name}: first fight ${(100 * a.winRate).toFixed(1)}%, session ${(100 * session.winRate).toFixed(1)}% / played ${(100 * actual).toFixed(1)}%; wins/h ${session.winsPerHour.toFixed(1)} / ${perHour.toFixed(1)}; wounds mean ${session.woundStacks.mean.toFixed(2)}, max ${session.woundStacks.max}`,
      );
      // The tolerance of the card (5 points, 10%) plus two standard errors of the difference: a target
      // that sits on the edge of the Wounds spiral ends one way or the other in each session, and the
      // spread of the sessions (the forecast's own, and that of the games played here) is the noise.
      const sd = (values: number[]): number => {
        const mean = values.reduce((x, y) => x + y, 0) / values.length;
        return Math.sqrt(values.reduce((x, y) => x + (y - mean) ** 2, 0) / (values.length - 1));
      };
      const playedRates = games.map((g) => (g.fights === 0 ? 0 : g.wins / g.fights));
      const noise = (own: number, played: number[], runs: number): number =>
        2 * Math.sqrt((own * own) / runs + (sd(played) * sd(played)) / played.length);
      const rateTol = 0.05 + noise(session.spread.winRate, playedRates, session.runs);
      const perHourTol =
        0.1 * Math.max(1, perHour) +
        noise(
          session.spread.winsPerHour,
          games.map((g) => g.perHour),
          session.runs,
        );
      console.log(
        `  tolerance: ${(100 * rateTol).toFixed(1)} points, ${perHourTol.toFixed(1)} wins/h`,
      );
      expect(Math.abs(session.winRate - actual)).toBeLessThanOrEqual(rateTol);
      expect(Math.abs(session.winsPerHour - perHour)).toBeLessThanOrEqual(perHourTol);
    });
  }

  it('shows the Wounds snowball: a marginal boss wins far less over a session than in a fresh first fight', () => {
    const scene = scenes.find((s) => s.name.endsWith('level 44')) as Scene;
    const a = analyze(setup(scene, 77), scene.target);
    expect(a.session?.winRate ?? 1).toBeLessThan(a.winRate - 0.1);
    expect(a.session?.woundStacks.max ?? 0).toBeGreaterThanOrEqual(K.wound.max);
  });

  it('repeats exactly for the same seed', () => {
    const scene = scenes[2] as Scene;
    const state = setup(scene, 78);
    const first = JSON.stringify(
      analyze(state, scene.target, { sessionRuns: 1, sessionMinutes: 10 }),
    );
    expect(
      JSON.stringify(analyze(state, scene.target, { sessionRuns: 1, sessionMinutes: 10 })),
    ).toBe(first);
  });
});

describe('A6: coverage, hints and secrecy', () => {
  const marauder: AnalysisTarget = { kind: 'zone', id: 'core:zone_marauder' };
  const kiri: AnalysisTarget = { kind: 'zone', id: 'core:zone_kiri_hunter' };

  /** A player with no answer to Evasive or to Hidden in the loadout or the pouch. */
  function bare(seed: number, level: number): GameState {
    const state = fighter(seed, level, 'katon');
    for (const id of Object.keys(state.known)) {
      const t = content.techniques.find((x) => x.id === id);
      if (t?.tags.includes('bind') || t?.tags.includes('reveal')) delete state.known[id];
    }
    run(state, { type: 'loadout.auto', on: true });
    return state;
  }

  it('lists exactly the known traits, and says nothing of the hidden ones', () => {
    const state = bare(1, 30);
    const unknown = analyze(state, kiri);
    expect(unknown.coverage).toEqual([]);
    expect(unknown.hiddenTraits).toBe(1);
    expect(unknown.hints).toEqual([]);
    const text = JSON.stringify(unknown);
    expect(text).not.toContain('"trait":"hidden"');
    expect(text).not.toContain('sensing');
    know(state, 'core:kiri_hunter');
    const known = analyze(state, kiri);
    expect(known.coverage.map((c) => c.trait)).toEqual(['hidden']);
    expect(known.hiddenTraits).toBe(0);
    // A pack and its armour show on sight: the guard pack is seen from the first encounter.
    const seen = bare(2, 40);
    seen.bingo['core:guard_pack'] = {
      seen: 1,
      wins: 0,
      losses: 0,
      timeouts: 0,
      bought: 0,
      bounty: 0,
    };
    const guards = analyze(seen, { kind: 'zone', id: 'core:zone_guard_pack' });
    expect(guards.coverage.map((c) => c.trait).sort()).toEqual(['armor', 'pack']);
  });

  it('names what answers a known trait: the technique or the item', () => {
    const state = fighter(3, 30, 'katon');
    setLevel(state, 'futon', 30);
    know(state, 'core:marauder');
    const bind = content.techniques.find((t) => t.tags.includes('bind') && t.src === 'N');
    if (!bind) throw new Error('no bind technique');
    state.known[bind.id] = true;
    run(state, { type: 'loadout.set', techniques: [bind.id, 'core:leaf_whirlwind'] });
    const a = analyze(state, marauder);
    const evasive = a.coverage.find((c) => c.trait === 'evasive');
    expect(evasive).toMatchObject({ answered: true, by: [{ kind: 'technique', id: bind.id }] });
    // A tool in the pouch answers it as well.
    const wire = content.items.find((i) => i.tags.includes('bind') && i.pouch === true);
    if (!wire) throw new Error('no bind tool');
    stock(state, { [wire.id]: 4 });
    run(state, { type: 'loadout.set', techniques: ['core:leaf_whirlwind'] });
    run(state, { type: 'pouch.set', slot: 0, item: wire.id });
    const b = analyze(state, marauder);
    expect(b.coverage.find((c) => c.trait === 'evasive')?.by).toEqual([
      { kind: 'item', id: wire.id },
    ]);
  });

  it('hints, for each uncovered known trait, at techniques and tools that exist and can be had', () => {
    const state = bare(4, 24);
    know(state, 'core:marauder');
    know(state, 'core:kiri_hunter');
    for (const target of [marauder, kiri]) {
      const a = analyze(state, target);
      const open = a.coverage.filter((c) => !c.answered);
      expect(open.length).toBeGreaterThan(0);
      expect(a.hints.map((h) => h.trait)).toEqual(open.map((c) => c.trait));
      for (const hint of a.hints) {
        expect(hint.options.length, hint.trait).toBeGreaterThan(0);
        expect(hint.options.length).toBeLessThanOrEqual(K.analysis.hintOptions);
        for (const o of hint.options) {
          if (o.kind === 'technique') {
            const t = content.techniques.find((x) => x.id === o.id);
            expect(t, o.id).toBeDefined();
            expect(state.known[o.id]).toBeUndefined();
            expect([t?.skill, t?.level]).toEqual([o.skill, o.level]);
            if (o.source === 'carrier') {
              expect(o.carriers.length).toBeGreaterThan(0);
              for (const c of o.carriers) {
                expect([...content.enemies, ...content.bosses].some((e) => e.id === c)).toBe(true);
              }
            }
          } else {
            expect(
              content.items.some((i) => i.id === o.id),
              o.id,
            ).toBe(true);
            if (o.source === 'shop') expect(content.shop.some((s) => s.item === o.id)).toBe(true);
            if (o.source === 'craft') {
              expect(content.recipes.some((r) => r.output.item === o.id)).toBe(true);
            }
          }
        }
        // The cheapest first.
        const prices = hint.options.map((o) => o.ryo ?? Infinity);
        expect([...prices].sort((x, y) => x - y)).toEqual(prices);
      }
    }
  });

  it('leaves the state and every random stream byte for byte as it was, and repeats exactly', () => {
    const state = setup(scenes[2] as Scene, 40);
    const before = serialize(state, 0);
    const rng = JSON.stringify(state.rng);
    const first = analyze(state, kiri);
    const second = analyze(state, kiri);
    expect(serialize(state, 0)).toBe(before);
    expect(JSON.stringify(state.rng)).toBe(rng);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // Another seed gives another sample, the same seed the same one.
    expect(JSON.stringify(analyze(state, kiri, { seed: 99 }))).not.toBe(JSON.stringify(first));
    expect(JSON.stringify(analyze(state, kiri, { seed: 99 }))).toBe(
      JSON.stringify(analyze(state, kiri, { seed: 99 })),
    );
  });

  it('reports xp, ryo, wounds and mastery per hour, and nothing for a target that does not exist', () => {
    const state = setup(scenes[0] as Scene, 41);
    know(state, 'core:wolfmask');
    const a = analyze(state, scenes[0]?.target as AnalysisTarget);
    const session = a.session;
    expect(session?.xpPerHour.vit).toBeGreaterThan(0);
    expect(session?.xpPerHour.eva).toBeGreaterThan(0);
    expect(Object.keys(session?.masteryPerHour ?? {}).length).toBeGreaterThan(0);
    expect(session?.ryoPerHour).toBeGreaterThan(0);
    expect(a.woundsPerHour).toBeGreaterThanOrEqual(0);
    expect(
      analyzeFight(state, { kind: 'zone', id: 'core:nothing' }, {}, content, defaultRules),
    ).toBeNull();
  });
});

describe('A7: comparing loadouts', () => {
  it('shows a better win rate when the second loadout adds the answer to a known trait', () => {
    const state = fighter(6, 16, 'katon');
    know(state, 'core:marauder');
    const bind = content.techniques.find((t) => t.id === 'core:temporary_paralysis');
    if (!bind) throw new Error('no bind');
    state.known[bind.id] = true;
    const attacks = ['core:leaf_whirlwind', 'core:great_fireball', 'core:dynamic_entry'].filter(
      (id) => state.known[id],
    );
    const before = serialize(state, 0);
    const result = compareLoadouts(
      state,
      { kind: 'zone', id: 'core:zone_marauder' },
      attacks,
      [...attacks, bind.id],
      {},
      content,
      defaultRules,
    );
    expect(serialize(state, 0)).toBe(before);
    expect(result).not.toBeNull();
    expect(result?.winRate).toBeGreaterThan(0);
    expect(result?.b.coverage.find((c) => c.trait === 'evasive')?.answered).toBe(true);
    expect(result?.a.coverage.find((c) => c.trait === 'evasive')?.answered).toBe(false);
    console.log(
      `compareLoadouts: win rate ${(100 * (result?.a.winRate ?? 0)).toFixed(1)}% -> ${(100 * (result?.b.winRate ?? 0)).toFixed(1)}%`,
    );
  });
});

describe('A10: speed', () => {
  it('finishes an analysis with the default sample size within the budget, for a zone and a boss', () => {
    const budget = K.analysis.budgetMs;
    for (const scene of [scenes[0], scenes[3], scenes[5]] as Scene[]) {
      const state = setup(scene, 50);
      const t0 = performance.now();
      const a = analyze(state, scene.target);
      const ms = performance.now() - t0;
      console.log(
        `analysis of ${scene.name}: ${ms.toFixed(0)} ms for ${a.samples} samples (budget ${budget} ms)`,
      );
      expect(ms).toBeLessThan(scene.target.kind === 'zone' ? ZONE_BUDGET_MS : budget);
      expect(a.samples).toBe(
        scene.target.kind === 'operation' ? K.analysis.opSamples : K.analysis.samples,
      );
    }
  });
});
