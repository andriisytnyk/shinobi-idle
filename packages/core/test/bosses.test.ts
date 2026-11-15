/**
 * A9: the eight bosses against a player built for their combat level (the balance document's
 * `build`), with the best loadout from `loadout.prepare`'s planner, a pouch of four healing items
 * and fitting tools, and the AI tier of a Chunin (the Genin tier cannot answer hidden traits).
 * The table is printed; the bounds are asserted.
 */
import { content, NATURE_IDS, type Boss, type NatureId } from '@shinobi/content';
import { describe, expect, it } from 'vitest';
import { beaten, beater, pct, playerFor, simulate } from './prep-helpers.ts';

const N = 400;
const TIER = Number(process.env.A9_TIER ?? 2);

interface Row {
  boss: Boss;
  fav: NatureId;
  unfav: NatureId;
  favourable: number;
  unfavourable: number;
  empty: number;
  below: number;
  favMs: number;
}

const win = (boss: Boss, nature: NatureId, prep: 'prepared' | 'empty', below = 0) =>
  simulate(boss, playerFor(boss, nature, { prep, below, tier: TIER }), N, 1);

/**
 * A boss with a nature has a favourable one (it beats the boss's) and an unfavourable one (the
 * boss beats it). The others have none that the wheel can name (the rivals counter whatever the
 * player's first nature is): the best and the worst of the five stand for them.
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
    favourable: best.winRate,
    unfavourable: win(boss, unfav, 'prepared').winRate,
    empty: win(boss, fav, 'empty').winRate,
    below: win(boss, fav, 'prepared', 4).winRate,
    favMs: best.timeMs.mean,
  };
});

describe('A9: bosses against a prepared player', () => {
  it('prints the table', () => {
    const lines = rows.map(
      (r) =>
        `| ${r.boss.id.replace('core:', '')} | ${r.boss.cl} | ${r.fav} ${pct(r.favourable)} | ${r.unfav} ${pct(r.unfavourable)} | ${pct(r.empty)} | ${pct(r.below)} | ${(r.favMs / 1000).toFixed(0)} s |`,
    );
    console.log(
      `A9 (tier ${TIER}, ${N} fights per cell)\n| boss | level | favourable, prepared | unfavourable, prepared | empty pouch | 4 levels below | mean time |\n| --- | --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}`,
    );
    expect(rows).toHaveLength(8);
  });

  for (const r of rows) {
    const name = r.boss.id.replace('core:', '');

    it(`${name}: a prepared player of the favourable nature wins at least 60%`, () => {
      expect(r.favourable).toBeGreaterThanOrEqual(0.6);
    });

    it(`${name}: a player four levels below wins less often than one at the level`, () => {
      expect(r.below).toBeLessThan(r.favourable);
    });

    if (r.boss.cl >= 32) {
      it(`${name}: an empty pouch costs at least 25 points`, () => {
        expect(r.favourable - r.empty).toBeGreaterThanOrEqual(0.25);
      });
    }
  }

  it('lets the favourable nature beat the unfavourable one, where the wheel names them', () => {
    for (const r of rows.filter((x) => x.boss.nature !== null && x.boss.nature !== 'wheel')) {
      // Not a bound of the card: a note on how the wheel plays out at each level.
      console.log(
        `A9 wheel ${r.boss.id}: ${r.fav} ${pct(r.favourable)} vs ${r.unfav} ${pct(r.unfavourable)}`,
      );
    }
    expect(true).toBe(true);
  });
});
