/** The side income of the fieldworks stays small, and a mod can add a work of any skill (rule 6). */
import { composeContent, content, corePack } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import {
  actionInfo,
  advance,
  composeRules,
  createState,
  defaultRules,
  deserialize,
  dispatch,
  listSkillActions,
  revealOf,
  sellPrice,
  serialize,
  touchWorld,
  xpAt,
  type GameState,
} from '../src/index.ts';
import { testmodPack } from '../src/testmod/index.ts';
import { genin, HOUR, setLevel, start } from './helpers.ts';

const K = content.balance.K as unknown as { partsPerScroll: number };
const SEARCH = 'core:search_war_fort_ruins';
const SULPHUR_WORK = 'core:gather_hell_valley_sulphur';
const SIFT = 'testmod:scrap_sifting';

/** What one performer at base speed earns in an hour of a work, from the data alone. */
function perHour(id: string) {
  const work = content.fieldworks.find((w) => w.id === id)!;
  const cycles = HOUR / 1000 / work.cycle;
  let ryo = 0;
  let intel = 0;
  let parts = 0;
  let sulphur = 0;
  for (const d of work.drops) {
    for (const i of d.payout.items ?? []) {
      const each = d.chance * i.n * cycles;
      ryo += each * (sellPrice(i.item, content) ?? 0);
      if (i.item.startsWith('core:scrollpart_')) parts += each;
      if (i.item === 'core:sulphur') sulphur += each;
    }
    intel += d.chance * (d.payout.currencies?.['intel'] ?? 0) * cycles;
  }
  return { ryo, intel, parts, sulphur, xp: work.xp * cycles };
}

describe('the yields stay a small optional side income', () => {
  const ruins = perHour(SEARCH);
  const valley = perHour(SULPHUR_WORK);

  it('ruin search sells for at most ~400 ryo an hour (missions pay 1.1-1.6k)', () => {
    expect(ruins.ryo).toBeGreaterThan(0);
    expect(ruins.ryo).toBeLessThanOrEqual(400);
  });

  it('ruin search gives at most ~4 Intel an hour', () => {
    expect(ruins.intel).toBeGreaterThan(0);
    expect(ruins.intel).toBeLessThanOrEqual(4);
  });

  it('a full scroll from the ruins takes at least 30 hours, not faster than the mission core:dig', () => {
    expect(ruins.parts).toBeGreaterThan(0);
    expect(K.partsPerScroll / ruins.parts).toBeGreaterThanOrEqual(30);
  });

  it('sulphur is a few bombs an hour at most', () => {
    const recipe = content.recipes.find((r) => r.id === 'core:iidka_dymova_bomba')!;
    const per = recipe.ingredients.find((i) => i.item === 'core:sulphur')!.n;
    expect(valley.sulphur).toBeGreaterThan(0.5);
    expect((valley.sulphur / per) * recipe.output.n).toBeLessThanOrEqual(10);
  });

  it('keeps XP per hour positive (the pace numbers were not touched)', () => {
    expect(ruins.xp).toBeGreaterThan(0);
    expect(valley.xp).toBeGreaterThan(0);
  });
});

describe('the smoke bomb is weaker than the level-30 tear gas bomb', () => {
  it('has a smaller effect and a shorter duration', () => {
    const fx = (id: string) =>
      content.items.find((i) => i.id === id)?.fx as unknown as {
        mult: number;
        durationMs: number;
        stat: string;
      };
    const smoke = fx('core:iidka_dymova_bomba');
    const tear = fx('core:slozohinna_bomba');
    expect(smoke.stat).toBe(tear.stat);
    expect(1 - smoke.mult).toBeLessThan(1 - tear.mult);
    expect(smoke.durationMs).toBeLessThan(tear.durationMs);
    expect((1 - smoke.mult) * smoke.durationMs).toBeLessThan((1 - tear.mult) * tear.durationMs);
  });
});

describe('a mod work of another skill', () => {
  const withMod = composeContent([corePack, testmodPack]);
  const rules = composeRules(defaultRules, [corePack, testmodPack], withMod);
  const modState = (): GameState => {
    const s = createState(1, withMod);
    s.player.rank = 'genin';
    return s;
  };

  it('is listed on the page of its own skill, and not on the scouting page', () => {
    const s = modState();
    s.skills['testmod:forge']!.xp = xpAt(2);
    const forge = listSkillActions(s, 'testmod:forge', withMod, rules).map((i) => i.id);
    expect(forge).toContain(SIFT);
    const scout = listSkillActions(s, 'scout', withMod, rules).map((i) => i.id);
    expect(scout).not.toContain(SIFT);
    expect(scout).toContain(SEARCH);
  });

  it('is hidden until its point is found (the default reveal of the kind)', () => {
    const s = modState();
    const ref = { kind: 'fieldwork', id: SIFT };
    expect(revealOf(s, ref, withMod, rules)).toBe('hidden');
    s.world.pois['core:war_fort_ruins'] = true;
    touchWorld(s);
    expect(revealOf(s, ref, withMod, rules)).toBe('full');
    expect(actionInfo(s, ref, withMod, rules)?.skill).toBe('testmod:forge');
  });

  it('is done by a clone: the yield goes into its bag and is handed over on dispel', () => {
    const s = modState();
    s.world.pois['core:war_fort_ruins'] = true;
    touchWorld(s);
    s.skills['testmod:forge']!.xp = xpAt(2);
    s.skills['nin']!.xp = xpAt(50);
    s.known['core:shadow_clone'] = true;
    expect(dispatch(s, { type: 'clone.create' }, withMod, rules)).toEqual({ ok: true });
    expect(dispatch(s, start('fieldwork', SIFT, 1), withMod, rules)).toEqual({ ok: true });
    advance(s, 20 * 60_000, withMod, rules);
    const bag = s.clones[1]?.bag['testmod:pellet'] ?? 0;
    expect(bag).toBeGreaterThan(0);
    const bank = s.bank['testmod:pellet'] ?? 0;
    dispatch(s, { type: 'clone.dispel', slot: 1 }, withMod, rules);
    expect(s.bank['testmod:pellet']).toBe(bank + bag);
  });
});

describe('split invariance of a work', () => {
  it('one long advance equals many short ones', () => {
    const run = (chunks: number[]): string => {
      const s = genin(3);
      setLevel(s, 'scout', 15);
      s.world.pois['core:war_fort_ruins'] = true;
      touchWorld(s);
      dispatch(s, start('fieldwork', SEARCH, 0), content);
      for (const ms of chunks) advance(s, ms, content);
      return JSON.stringify(serialize(deserialize(serialize(s), content)));
    };
    const whole = run([2 * HOUR]);
    expect(run(Array<number>(8).fill(HOUR / 4))).toBe(whole);
    expect(run([999, 7, HOUR - 1_006, HOUR])).toBe(whole);
  });
});
