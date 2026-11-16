/** S4-3: the nature test, extra natures, the native bonus, the non-native cast penalty, the team's natures, consequences. */
import { content, NATURE_IDS, type NatureId } from '@shinobi/content';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  ayaNatureFor,
  bossNature,
  createState,
  deserialize,
  dispatch,
  getMod,
  isSkillUnlocked,
  MIGRATIONS,
  natureConsequences,
  natureSetSummary,
  natureStatus,
  nonNativeCastMult,
  nonNativeLevel,
  practiceIntervalSeconds,
  rivalNature,
  rivalNatureFor,
  serialize,
  STATE_VERSION,
  techniqueCastSeconds,
  ayaNature,
  refreshUnlocks,
  type GameState,
} from '../src/index.ts';
import { genin, setLevel, start, withNatures } from './helpers.ts';

const K = content.balance.K;
const choose = (s: GameState, nature: NatureId | 'random') =>
  dispatch(s, { type: 'nature.choose', nature }, content);
const add = (s: GameState, nature: NatureId | 'random') =>
  dispatch(s, { type: 'nature.add', nature }, content);

describe('A2: nature.choose', () => {
  it('is refused for a student and changes nothing', () => {
    const s = createState(1, content);
    expect(choose(s, 'katon')).toEqual({ ok: false, reason: 'error.natureNotGenin' });
    expect(s.player.natures).toEqual([]);
    expect(s.team).toBeNull();
  });

  it('accepts each of the five natures once, then is refused', () => {
    for (const nature of NATURE_IDS) {
      const s = genin();
      expect(choose(s, nature)).toEqual({ ok: true });
      expect(s.player.natures).toEqual([nature]);
      expect(choose(s, nature)).toEqual({ ok: false, reason: 'error.natureChosen' });
      expect(choose(s, 'random')).toEqual({ ok: false, reason: 'error.natureChosen' });
      expect(s.player.natures).toEqual([nature]);
    }
  });

  it('refuses a name that is not a nature', () => {
    const s = genin();
    expect(choose(s, 'tai' as unknown as NatureId)).toEqual({
      ok: false,
      reason: 'error.invalidNature',
    });
  });

  it('random draws on the world stream: the same per seed, all five over seeds', () => {
    const draw = (seed: number) => {
      const s = genin(seed);
      expect(choose(s, 'random')).toEqual({ ok: true });
      return { nature: s.player.natures[0], world: s.rng.world, action: s.rng.action };
    };
    const fresh = genin(7);
    const seen = new Set<string | undefined>();
    for (let seed = 1; seed <= 60; seed++) {
      const a = draw(seed);
      expect(draw(seed)).toEqual(a);
      seen.add(a.nature);
      // Only the world stream moves.
      expect(a.action).toEqual(genin(seed).rng.action);
    }
    expect([...seen].sort()).toEqual([...NATURE_IDS].sort());
    expect(fresh.rng.world).toEqual(genin(7).rng.world);
  });

  it('emits a natureGained event and a quest step', () => {
    const s = genin();
    choose(s, 'doton');
    expect(s.events).toContainEqual(
      expect.objectContaining({ type: 'natureGained', nature: 'doton', first: true }),
    );
    // Choosing the nature is the first step of the chain; the rest of it is still to do.
    expect(s.quests['core:mission_board']?.step).toBe(1);
  });
});

describe('A2: nature.add', () => {
  it('needs the test first', () => {
    const s = genin();
    setLevel(s, 'cc', 50);
    expect(add(s, 'katon')).toEqual({ ok: false, reason: 'error.natureNeedsNative' });
  });

  it('is gated by Chakra Control 20 for the second and 40 for the third', () => {
    const s = genin();
    choose(s, 'katon');
    setLevel(s, 'cc', 19);
    expect(natureStatus(s, content)).toMatchObject({
      stage: 'second',
      canChoose: false,
      needCc: 20,
    });
    expect(add(s, 'futon')).toEqual({ ok: false, reason: 'error.natureControlLow' });
    setLevel(s, 'cc', 20);
    expect(natureStatus(s, content).canChoose).toBe(true);
    expect(add(s, 'futon')).toEqual({ ok: true });
    expect(s.player.natures).toEqual(['katon', 'futon']);
    setLevel(s, 'cc', 39);
    expect(natureStatus(s, content)).toMatchObject({
      stage: 'third',
      canChoose: false,
      needCc: 40,
    });
    expect(add(s, 'raiton')).toEqual({ ok: false, reason: 'error.natureControlLow' });
    setLevel(s, 'cc', 40);
    expect(add(s, 'raiton')).toEqual({ ok: true });
    expect(s.player.natures).toEqual(['katon', 'futon', 'raiton']);
  });

  it('refuses owned natures and a fourth', () => {
    const s = genin();
    choose(s, 'katon');
    setLevel(s, 'cc', 99);
    expect(add(s, 'katon')).toEqual({ ok: false, reason: 'error.natureOwned' });
    expect(add(s, 'futon')).toEqual({ ok: true });
    expect(add(s, 'futon')).toEqual({ ok: false, reason: 'error.natureOwned' });
    expect(add(s, 'random')).toEqual({ ok: true });
    expect(s.player.natures).toHaveLength(3);
    expect(new Set(s.player.natures).size).toBe(3);
    expect(add(s, 'doton')).toEqual({ ok: false, reason: 'error.natureMax' });
    expect(add(s, 'random')).toEqual({ ok: false, reason: 'error.natureMax' });
    expect(s.player.natures).toHaveLength(3);
  });

  it('random never picks an owned nature', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = genin(seed);
      choose(s, 'katon');
      setLevel(s, 'cc', 99);
      add(s, 'random');
      expect(new Set(s.player.natures).size).toBe(2);
    }
  });
});

describe('A3: locks, the native bonus and the non-native cast', () => {
  it('keeps the nature skills shut until the nature is owned', () => {
    const s = genin();
    for (const n of NATURE_IDS) expect(isSkillUnlocked(s, n, content)).toBe(false);
    choose(s, 'suiton');
    for (const n of NATURE_IDS) expect(isSkillUnlocked(s, n, content)).toBe(n === 'suiton');
    expect(
      dispatch(s, start('practice', 'core:nature_transformation_burn_a_leaf'), content),
    ).toEqual({
      ok: false,
      reason: 'error.skillLocked',
    });
  });

  it('the first drill of the native skill can be practised once the nature is owned', () => {
    const s = genin();
    choose(s, 'katon');
    refreshUnlocks(s, content, true);
    const drill = content.techniques.find((t) => t.skill === 'katon' && t.level === 1);
    expect(drill).toBeDefined();
    expect(dispatch(s, start('practice', drill!.id), content)).toEqual({ ok: true });
    advance(s, 60_000, content);
    expect(s.skills.katon!.xp).toBeGreaterThan(0);
  });

  it('gives the native skill exactly x1.25 XP, with its source listed', () => {
    const s = genin();
    choose(s, 'raiton');
    const mod = getMod(s, 'xp.skill.raiton', content);
    expect(mod.total).toBe(K.nativeXp);
    expect(mod.total).toBe(1.25);
    expect(mod.parts).toHaveLength(1);
    expect(mod.parts[0]?.source).toBe('mod.source.nativeNature');
    // Other natures and skills are untouched, and an extra nature earns no bonus.
    expect(getMod(s, 'xp.skill.tai', content).total).toBe(1);
    setLevel(s, 'cc', 20);
    add(s, 'doton');
    expect(getMod(s, 'xp.skill.doton', content).total).toBe(1);
  });

  it('pays native XP x1.25 per cycle', () => {
    const run = (natures: NatureId[]) => {
      const s = withNatures(genin(), ...natures);
      s.known['core:nature_transformation_burn_a_leaf'] = true;
      dispatch(s, start('practice', 'core:nature_transformation_burn_a_leaf'), content);
      advance(s, 60_000, content);
      return s.skills.katon!.xp;
    };
    // Same technique, same cast, same cycles: only the native bonus differs.
    const native = run(['katon']);
    const foreign = run(['futon', 'katon']);
    expect(foreign).toBeGreaterThan(0);
    expect(native / foreign).toBeCloseTo(K.nativeXp, 9);
  });

  it('stretches the cast of a non-native technique 1.30 at level 1, 1.15 at 25 and 1.00 at 50', () => {
    expect(nonNativeCastMult(1, content)).toBeCloseTo(1.3, 12);
    expect(nonNativeCastMult(25, content)).toBeCloseTo(1.15, 2);
    expect(nonNativeCastMult(50, content)).toBe(1);
    expect(nonNativeCastMult(80, content)).toBe(1);
    const fb = content.techniques.find((t) => t.id === 'core:great_fireball')!;
    const base = techniqueCastSeconds(fb.sealSeq.length, 1, content);
    expect(techniqueCastSeconds(fb.sealSeq.length, 1, content, 1)).toBeCloseTo(base * 1.3, 12);
    expect(techniqueCastSeconds(fb.sealSeq.length, 1, content, 50)).toBeCloseTo(base, 12);
  });

  it('only a nature skill that is not the first nature is foreign', () => {
    expect(nonNativeLevel('katon', ['katon', 'futon'], 9)).toBeUndefined();
    expect(nonNativeLevel('futon', ['katon', 'futon'], 9)).toBe(9);
    expect(nonNativeLevel('tai', ['katon'], 9)).toBeUndefined();
    expect(nonNativeLevel('nin', ['katon'], 9)).toBeUndefined();
    expect(nonNativeLevel('katon', [], 9)).toBeUndefined();
  });

  it('applies to the practice interval at levels 1, 25 and 50', () => {
    const id = 'core:great_fireball';
    const t = content.techniques.find((x) => x.id === id)!;
    const cast = techniqueCastSeconds(t.sealSeq.length, 1, content);
    const intervalAt = (natures: NatureId[], level: number) => {
      const s = withNatures(genin(), ...natures);
      setLevel(s, 'katon', level);
      s.known[id] = true;
      return actionInfo(s, { kind: 'practice', id }, content)!.intervalMs;
    };
    for (const [level, mult] of [
      [1, 1.3],
      [25, 1 + K.nonNativeCast * (25 / 49)],
      [50, 1],
    ] as const) {
      const expected = Math.round(practiceIntervalSeconds(cast * mult, content) * 1000);
      expect(intervalAt(['futon', 'katon'], level)).toBe(expected);
      // The native player never pays it.
      expect(intervalAt(['katon', 'futon'], level)).toBe(
        Math.round(practiceIntervalSeconds(cast, content) * 1000),
      );
    }
  });

  // Needs `techniqueFigures` (combat/numbers.ts, not touched by this task) to pass `snap.natures` on:
  //   techniqueCastSeconds(seals, mastery, content, nonNativeLevel(tech.skill, snap.natures ?? [], skillLvl))

  it('runs a non-native practice slower in play too', () => {
    const cycles = (natures: NatureId[]) => {
      const s = withNatures(genin(), ...natures);
      setLevel(s, 'katon', 30);
      s.known['core:great_fireball'] = true;
      dispatch(s, start('practice', 'core:great_fireball'), content);
      advance(s, 120_000, content);
      return s.stats.completed;
    };
    expect(cycles(['katon'])).toBeGreaterThan(cycles(['futon', 'katon']));
  });
});

describe('A4: the team natures', () => {
  const rules: [NatureId, NatureId, NatureId][] = [
    // native, rival (beats the native on the wheel), Aya
    ['katon', 'suiton', 'raiton'],
    ['futon', 'katon', 'raiton'],
    ['raiton', 'futon', 'suiton'],
    ['doton', 'raiton', 'suiton'],
    ['suiton', 'doton', 'raiton'],
  ];
  for (const [native, rival, aya] of rules) {
    it(`for a native ${native}: rival ${rival}, Aya ${aya}`, () => {
      expect(rivalNatureFor(content, native)).toBe(rival);
      expect(ayaNatureFor(content, native)).toBe(aya);
      const s = genin();
      expect(rivalNature(s)).toBeNull();
      expect(ayaNature(s)).toBeNull();
      choose(s, native);
      expect(s.team).toEqual({ rival, aya });
      expect(rivalNature(s)).toBe(rival);
      expect(ayaNature(s)).toBe(aya);
      // The rival boss rule resolves through the state.
      const ren = content.bosses.find((b) => b.special.kind === 'rival')!;
      expect(ren.special).toMatchObject({ nature: 'beatsPlayerFirst' });
      expect(bossNature(s, ren)).toBe(rival);
    });
  }

  it('does not change when extra natures are added', () => {
    const s = genin();
    choose(s, 'katon');
    setLevel(s, 'cc', 99);
    add(s, 'doton');
    expect(s.team).toEqual({ rival: 'suiton', aya: 'raiton' });
  });
});

/** The ten rows of the trio table in the slice-fixes document. */
function docRows(): { natures: NatureId[]; missions: number; buildings: number; cells: number }[] {
  const text = readFileSync(
    new URL('../../../docs/Shinobi Idle — MVP — правки зрізу.md', import.meta.url),
    'utf8',
  );
  const names: Record<string, NatureId> = {
    Катон: 'katon',
    Футон: 'futon',
    Райтон: 'raiton',
    Дотон: 'doton',
    Суйтон: 'suiton',
  };
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /^\|\s*(\S+) \+ (\S+) \+ (\S+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/.exec(
      line,
    );
    if (!m) continue;
    const natures = [m[1], m[2], m[3]].map((n) => names[n ?? '']);
    if (natures.some((n) => n === undefined)) continue;
    rows.push({
      natures: natures as NatureId[],
      missions: Number(m[4]),
      buildings: Number(m[5]),
      cells: Number(m[6]),
    });
  }
  return rows;
}

describe('A5: natureSetSummary reproduces the trio table', () => {
  const rows = docRows();
  it('finds all ten rows in the document', () => {
    expect(rows).toHaveLength(10);
  });
  for (const row of rows) {
    it(row.natures.join(' + '), () => {
      const sum = natureSetSummary(row.natures, content);
      expect(sum.missions.total).toBe(9);
      expect(sum.buildings.total).toBe(6);
      expect(sum.cells.total).toBe(5);
      expect(sum.missions.ids).toHaveLength(row.missions);
      expect(sum.buildings.ids).toHaveLength(row.buildings);
      expect(sum.cells.ids).toHaveLength(row.cells);
    });
  }

  it('counts no natures as the base: only the nature-free missions', () => {
    const sum = natureSetSummary([], content);
    expect(sum.missions.ids.length).toBeLessThan(7);
    expect(sum.cells.ids).toEqual([]);
  });
});

describe('natureConsequences', () => {
  const state = genin();
  it('lists what each nature opens, from the content', () => {
    const suiton = natureConsequences('suiton', state, content);
    expect(suiton.missions).toContain('core:v_water');
    expect(suiton.buildings).toContain('core:farms');
    expect(suiton.cells).toEqual([]);
    expect(suiton.strongAgainst).toBe('katon');
    expect(suiton.weakAgainst).toBe('doton');
    expect(suiton.rival).toBe('doton');
    expect(suiton.aya).toBe('raiton');
    expect(suiton.combos.length).toBeGreaterThan(0);

    const doton = natureConsequences('doton', state, content);
    expect(doton.cells.sort()).toEqual(['core:skhovyshche_fortetsi', 'core:zavalena_pechera']);
    expect(doton.missions).toContain('core:v_walls');

    const futon = natureConsequences('futon', state, content);
    expect(futon.cells).toContain('core:tumannyi_iar');
    for (const n of NATURE_IDS) {
      const c = natureConsequences(n, state, content);
      expect(c.owned).toBe(false);
      expect(c.native).toBe(false);
      // Village missions that stay open without any nature are never "enabled" by one.
      expect(c.missions).not.toContain('core:v_spar');
    }
  });

  it('reports owned and native from the state', () => {
    const s = genin();
    choose(s, 'raiton');
    expect(natureConsequences('raiton', s, content)).toMatchObject({ owned: true, native: true });
  });
});

describe('A8: save and determinism', () => {
  it('migrates a version 7 save: no nature means no team, a nature gets the team', () => {
    expect(STATE_VERSION).toBeGreaterThanOrEqual(8);
    expect(MIGRATIONS).toHaveLength(STATE_VERSION - 1);
    const s = genin(3);
    const text = JSON.parse(serialize(s, 9));
    text.v = 7;
    text.state.v = 7;
    delete text.state.team;
    const old = deserialize(JSON.stringify(text), content);
    expect(old.v).toBe(STATE_VERSION);
    expect(old.player.natures).toEqual([]);
    expect(old.team).toBeNull();
    // The genin without a nature is led to the test by the quest chain.
    expect(old.quests['core:mission_board']).toEqual({ step: 0, base: 0, done: false });

    text.state.player.natures = ['doton'];
    const withNature = deserialize(JSON.stringify(text), content);
    expect(withNature.team).toEqual({ rival: 'raiton', aya: 'suiton' });
    expect(withNature.quests['core:mission_board']?.step).toBe(1);
  });

  it('round-trips the team', () => {
    const s = genin(4);
    choose(s, 'futon');
    const back = deserialize(serialize(s, 1), content);
    expect(back.team).toEqual({ rival: 'katon', aya: 'raiton' });
    expect(back.player.natures).toEqual(['futon']);
  });

  it('recomputes a missing or doctored team from the native nature, and drops a fourth nature', () => {
    const s = genin(4);
    choose(s, 'futon');
    const parsed = JSON.parse(serialize(s, 1));
    parsed.state.team = { rival: 'nope', aya: 3 };
    parsed.state.player.natures = ['katon', 'futon', 'raiton', 'doton', 'suiton'];
    const back = deserialize(JSON.stringify(parsed), content);
    expect(back.team).toEqual({ rival: 'suiton', aya: 'raiton' });
    expect(back.player.natures).toEqual(['katon', 'futon', 'raiton']);
    delete parsed.state.team;
    expect(deserialize(JSON.stringify(parsed), content).team).toEqual(back.team);
  });

  it('is deterministic with a random nature choice, however time is chunked', () => {
    const run = (chunks: number) => {
      const s = genin(11);
      dispatch(s, { type: 'nature.choose', nature: 'random' }, content);
      const native = s.player.natures[0]!;
      const drill = content.techniques.find((t) => t.skill === native && t.level === 1)!;
      dispatch(s, start('practice', drill.id), content);
      for (let i = 0; i < chunks; i++) advance(s, 180_000 / chunks, content);
      return serialize(s, 0);
    };
    expect(run(1)).toBe(run(1));
    expect(run(1)).toBe(run(6));
  });
});
