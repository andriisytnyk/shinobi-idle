/**
 * A9: the eight bosses against a Genin built for their combat level (the balance document's
 * `build`) with the best loadout from the planner and a pouch of four healing items and fitting
 * tools. Rank decides what the tactics can do and knowledge what they know, so the table has a
 * column for a player who knows the boss and one for a first attempt. The table is printed; the
 * bounds are asserted.
 */
import { content, NATURE_IDS, type Boss, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { beaten, beater, pct, playerFor, simulate } from './prep-helpers.ts';

const N = 400;
const TIER = Number(process.env.A9_TIER ?? 1);

interface Row {
  boss: Boss;
  fav: NatureId;
  unfav: NatureId;
  full: number;
  none: number;
  unfavourable: number;
  empty: number;
  below: number;
  ms: number;
}

const win = (
  boss: Boss,
  nature: NatureId,
  prep: 'prepared' | 'empty',
  knowledge: 'full' | 'none' = 'full',
  below = 0,
) => simulate(boss, playerFor(boss, nature, { prep, below, tier: TIER, knowledge }), N, 1);

/**
 * A boss with a nature has a favourable one (it beats the boss's) and an unfavourable one (the
 * boss beats it). The others have none the wheel can name (the rivals counter whatever the first
 * nature is): the best and the worst of the five stand for them.
 */
function pick(boss: Boss): { fav: NatureId; unfav: NatureId } {
  if (boss.nature !== null && boss.nature !== 'wheel') {
    return { fav: beater(boss.nature), unfav: beaten(boss.nature) };
  }
  const rates = NATURE_IDS.map((n) => ({ n, w: win(boss, n, 'prepared').winRate }));
  rates.sort((a, b) => b.w - a.w);
  return { fav: rates[0]?.n ?? 'katon', unfav: rates[rates.length - 1]?.n ?? 'suiton' };
}

const rows: Row[] = content.bosses.map((boss) => {
  const { fav, unfav } = pick(boss);
  const best = win(boss, fav, 'prepared');
  return {
    boss,
    fav,
    unfav,
    full: best.winRate,
    none: win(boss, fav, 'prepared', 'none').winRate,
    unfavourable: win(boss, unfav, 'prepared').winRate,
    empty: win(boss, fav, 'empty').winRate,
    below: win(boss, fav, 'prepared', 'full', 4).winRate,
    ms: best.timeMs.mean,
  };
});

/** Bosses with a hidden trait or a mechanic that knowledge reveals. */
const SECRET = ['core:boss_hunter', 'core:boss_twins', 'core:boss_mist', 'core:boss_nameless'];

describe('A9: bosses against a prepared player', () => {
  it('prints the table', () => {
    const lines = rows.map(
      (r) =>
        `| ${r.boss.id.replace('core:', '')} | ${r.boss.cl} | ${r.fav} ${pct(r.full)} | ${pct(r.none)} | ${r.unfav} ${pct(r.unfavourable)} | ${pct(r.empty)} | ${pct(r.below)} | ${(r.ms / 1000).toFixed(0)} s |`,
    );
    console.log(
      `A9 (genin tier ${TIER}, ${N} fights per cell)\n| boss | level | full knowledge | no knowledge | unfavourable nature | empty pouch | 4 levels below | mean time |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}`,
    );
    expect(rows).toHaveLength(8);
  });

  for (const r of rows) {
    const name = r.boss.id.replace('core:', '');

    it(`${name}: a prepared player of the favourable nature who knows the boss wins at least 60%`, () => {
      expect(r.full).toBeGreaterThanOrEqual(0.6);
    });

    it(`${name}: four levels below wins less often than at the level, and under 50%`, () => {
      expect(r.below).toBeLessThan(r.full);
      expect(r.below).toBeLessThan(0.5);
    });

    if (r.boss.cl >= 32) {
      it(`${name}: an empty pouch costs at least 25 points`, () => {
        expect(r.full - r.empty).toBeGreaterThanOrEqual(0.25);
      });
    }

    if (SECRET.includes(r.boss.id)) {
      it(`${name}: a first attempt wins at least 20 points less than one with knowledge`, () => {
        expect(r.full - r.none).toBeGreaterThanOrEqual(0.2);
      });
    }
  }

  it('makes the Nameless the hardest fight, and no easier than the mist fugitive', () => {
    const by = (id: string) => rows.find((r) => r.boss.id === id)?.full ?? 1;
    const nameless = by('core:boss_nameless');
    expect(nameless).toBeLessThanOrEqual(by('core:boss_mist'));
    for (const r of rows) expect(nameless, r.boss.id).toBeLessThanOrEqual(r.full);
  });

  it('lets the favourable nature beat the unfavourable one by a margin, or states a verified reason', () => {
    const elemental = (boss: Boss, nature: NatureId) =>
      (playerFor(boss, nature, { prep: 'prepared', tier: TIER }).loadout ?? []).filter((id) =>
        NATURE_IDS.includes(content.techniques.find((t) => t.id === id)?.skill as NatureId),
      );
    for (const r of rows.filter((x) => x.boss.nature !== null && x.boss.nature !== 'wheel')) {
      const id = r.boss.id;
      if (id === 'core:boss_wolf') {
        // Exempt: at level 22 neither nature has a technique yet, so the wheel has nothing to act on.
        expect(elemental(r.boss, r.fav), id).toEqual([]);
        expect(elemental(r.boss, r.unfav), id).toEqual([]);
      } else if (id === 'core:boss_mist') {
        // Exempt: the unfavourable Katon loadout carries a burning technique (damage over time) that
        // the favourable Doton one lacks, which is worth more than the wheel here.
        const dot = (nature: NatureId) =>
          (playerFor(r.boss, nature, { prep: 'prepared', tier: TIER }).loadout ?? []).filter(
            (tid) => content.techniques.find((t) => t.id === tid)?.tags.includes('dot'),
          );
        expect(dot(r.unfav).length, id).toBeGreaterThan(0);
        expect(dot(r.fav), id).toEqual([]);
        expect(r.full, id).toBeGreaterThanOrEqual(r.unfavourable - 0.15);
      } else {
        expect(r.full - r.unfavourable, id).toBeGreaterThanOrEqual(0.2);
      }
    }
  });
});
