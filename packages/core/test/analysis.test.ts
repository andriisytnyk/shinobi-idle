/** A6, A7 and A10: battle analysis against 4 game hours of playing the same target. */
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

const HOURS = 4;
/** Units of every pouch good the player keeps in the bank. */
const RESTOCK = 1000;
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

/** Plays the target for `HOURS` game hours, restarting it after every defeat; returns wins and fights. */
function play(state: GameState, scene: Scene): { wins: number; fights: number; perHour: number } {
  const start = () => {
    const result =
      scene.target.kind === 'operation'
        ? startOperation(state, scene.target.id)
        : startFight(state, scene.target.id);
    if (!result.ok) throw new Error(`cannot start ${scene.target.id}: ${result.reason}`);
  };
  // The analysis plays the player as they are now, so the player is kept as they are: levels,
  // masteries and Wounds are put back after every step (they would otherwise drift over four hours).
  const frozen = JSON.stringify([state.skills, state.mastery, state.pools]);
  start();
  for (let t = 0; t < HOURS * 3_600_000; t += STEP) {
    advance(state, STEP, content);
    state.events = [];
    const [skills, mastery, pools] = JSON.parse(frozen) as [
      GameState['skills'],
      GameState['mastery'],
      GameState['pools'],
    ];
    state.skills = skills;
    state.mastery = mastery;
    state.pools = pools;
    state.wounds = { stacks: 0, left: 0 };
    // The bank is restocked, as a player who keeps buying would: the pouch is full at every start.
    for (const id of Object.keys(scene.bank)) state.bank[id] = RESTOCK;
    if (!state.slots[0]?.action) start();
  }
  const r = state.report[scene.key];
  const wins =
    scene.target.kind === 'operation'
      ? (state.counters[`ops.${scene.target.id}`] ?? 0)
      : (r?.wins ?? 0);
  const losses = r?.losses ?? 0;
  const timeouts = r?.timeouts ?? 0;
  const fights = scene.target.kind === 'operation' ? wins + losses : wins + losses + timeouts;
  return { wins, fights, perHour: wins / HOURS };
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
  {
    name: 'the hunter boss',
    target: { kind: 'boss', id: 'core:zone_boss_hunter' },
    key: 'core:zone_boss_hunter',
    level: 44,
    bank: { [ids.heal]: RESTOCK },
    knows: ['core:boss_hunter'],
    prepare: (s) => {
      unlockBoss(s, 'core:boss_hunter', content);
      run(s, { type: 'loadout.prepare', encounter: 'core:zone_boss_hunter' });
    },
  },
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

describe('A6: the analysis against four hours of play', () => {
  const rows: string[] = [];
  for (const [i, scene] of scenes.entries()) {
    it(`predicts ${scene.name}`, () => {
      const state = setup(scene, 20 + i);
      const before = serialize(state, 0);
      const a = analyze(state, scene.target);
      expect(serialize(state, 0), 'the analysis changes nothing').toBe(before);
      // Six games of four hours each, pooled: a single game of a rare outcome is too noisy to judge a rate.
      const games = [0, 1, 2, 3, 4, 5].map((g) => play(setup(scene, 20 + i + 10 * g), scene));
      const played = {
        wins: games.reduce((n, g) => n + g.wins, 0),
        fights: games.reduce((n, g) => n + g.fights, 0),
        perHour: games.reduce((n, g) => n + g.perHour, 0) / games.length,
      };
      const actual = played.fights === 0 ? 0 : played.wins / played.fights;
      rows.push(
        `| ${scene.name} | ${(100 * a.winRate).toFixed(1)}% / ${(100 * actual).toFixed(1)}% | ${a.winsPerHour.toFixed(0)} / ${played.perHour.toFixed(0)} |`,
      );
      console.log(
        `${scene.name}: predicted ${a.winRate.toFixed(3)} played ${actual.toFixed(3)}; wins/h ${a.winsPerHour.toFixed(1)} vs ${played.perHour.toFixed(1)}`,
      );
      expect(Math.abs(a.winRate - actual)).toBeLessThanOrEqual(0.05);
      expect(
        Math.abs(a.winsPerHour - played.perHour) / Math.max(1, played.perHour),
      ).toBeLessThanOrEqual(0.1);
    });
  }
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
    const a = analyze(state, scenes[0]?.target as AnalysisTarget);
    expect(a.xpPerHour.vit).toBeGreaterThan(0);
    expect(a.xpPerHour.eva).toBeGreaterThan(0);
    expect(Object.keys(a.masteryPerHour).length).toBeGreaterThan(0);
    expect(a.ryoPerHour).toBeGreaterThan(0);
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
    for (const scene of [scenes[0], scenes[3], scenes[4]] as Scene[]) {
      const state = setup(scene, 50);
      const t0 = performance.now();
      const a = analyze(state, scene.target);
      const ms = performance.now() - t0;
      console.log(
        `analysis of ${scene.name}: ${ms.toFixed(0)} ms for ${a.samples} samples (budget ${budget} ms)`,
      );
      expect(ms).toBeLessThan(budget);
      expect(a.samples).toBe(
        scene.target.kind === 'operation' ? K.analysis.opSamples : K.analysis.samples,
      );
    }
  });
});
